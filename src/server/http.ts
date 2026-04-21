import fs from 'fs';
import os from 'os';
import path from 'path';
import { timingSafeEqual } from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import { MIME_TYPES } from '../shared/constants.js';
import type { ServerConfig } from '../shared/types.js';
import { isAllowed } from './allowlist.js';
import { isOriginAllowed, logOriginReject } from './origin.js';
import { embeddedAssets } from './assets-embedded.js';
import {
  listColours,
  listFonts,
  listPacks,
  listThemes,
  readPackFile,
  type PackInfo,
} from './themes.js';
import { applyPatch, deleteSession, loadConfig, type SessionsConfigPatch } from './sessions-store.js';
import {
  writeDrop,
  listDrops,
  deleteDrop,
  type DropStorage,
} from './file-drop.js';
import { getForegroundProcess } from './foreground-process.js';
import { sendBytesToPane } from './tmux-inject.js';
import { formatBracketedPasteForDrop } from './drop-paste.js';
import { sanitizeSession } from './pty.js';
import { execFileAsync } from './exec.js';
import pkg from '../../package.json' with { type: 'json' };

export interface HttpHandlerOptions {
  config: ServerConfig;
  htmlTemplate: string;
  distDir: string;
  themesUserDir: string;
  themesBundledDir: string;
  projectRoot: string;
  isCompiled?: boolean;
  sessionsStorePath: string;
  dropStorage: DropStorage;
}

/** Per-session upload cap. 50 MiB — comfortably larger than typical
 *  screenshots and small docs, small enough to not starve memory when
 *  buffered in the HTTP handler before being written to disk. */
const MAX_DROP_BYTES = 50 * 1024 * 1024;

/** Session-settings body cap. 1 MiB is generous for a JSON schema of
 *  per-session UI preferences but still finite. */
const MAX_SESSION_SETTINGS_BYTES = 1 * 1024 * 1024;

/** Thin wrapper that resolves the foreground process (so we know
 *  whether to shell-quote) and hands off to the pure formatter. */
async function formatDropPasteBytes(
  config: ServerConfig,
  session: string,
  absolutePath: string,
): Promise<string> {
  let exePath: string | null = null;
  if (!config.testMode) {
    try {
      const fg = await getForegroundProcess(config.tmuxBin, session);
      exePath = fg.exePath;
    } catch { /* foreground lookup failed — raw path */ }
  }
  return formatBracketedPasteForDrop(exePath, absolutePath);
}

function debug(config: ServerConfig, ...args: unknown[]): void {
  if (config.debug) process.stderr.write(`[debug] ${args.join(' ')}\n`);
}

function getAssetPath(key: string): string | null {
  return embeddedAssets[key] || null;
}

async function materializeBundledThemes(): Promise<string | null> {
  const keys = Object.keys(embeddedAssets).filter(key => key.startsWith('themes/'));
  if (keys.length === 0) return null;

  const root = path.join(os.tmpdir(), `tmux-web-themes-${process.pid}`);
  for (const key of keys) {
    const src = embeddedAssets[key]!;
    const dest = path.join(root, key.slice('themes/'.length));
    fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
    const bytes = new Uint8Array(await Bun.file(src).arrayBuffer());
    fs.writeFileSync(dest, bytes);
  }
  process.on('exit', () => {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {}
  });
  return root;
}

async function readFile(filePath: string, assetKey?: string): Promise<{ data: Buffer | Uint8Array; contentType: string } | null> {
  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  // Try embedded asset first
  if (assetKey) {
    const embeddedPath = getAssetPath(assetKey);
    if (embeddedPath) {
      try {
        const file = Bun.file(embeddedPath);
        if (await file.exists()) {
          return { data: new Uint8Array(await file.arrayBuffer()), contentType };
        }
      } catch {}
    }
  }

  // Fallback to filesystem
  try {
    if (fs.existsSync(filePath)) {
      return { data: fs.readFileSync(filePath), contentType };
    }
  } catch {}

  return null;
}

function serveFile(res: ServerResponse, data: Buffer | Uint8Array, contentType: string): void {
  res.writeHead(200, { 'Content-Type': contentType });
  res.end(data);
}

function serve404(res: ServerResponse): void {
  res.writeHead(404);
  res.end('Not Found');
}

function getTerminalVersions(projectRoot: string): Record<string, string> {
  const versions: Record<string, string> = {};
  const xtermAssetPath = embeddedAssets['dist/client/xterm.js']
    ?? path.join(projectRoot, 'dist/client/xterm.js');
  try {
    const bundle = fs.readFileSync(xtermAssetPath, 'utf-8');
    const m = bundle.match(/tmux-web: vendor xterm\.js rev ([0-9a-f]{40})/);
    versions['xterm'] = m ? `xterm.js (HEAD, ${m[1].slice(0, 7)})` : 'xterm.js (unknown)';
  } catch {
    versions['xterm'] = 'xterm.js (unknown)';
  }
  return versions;
}

/** Constant-time string compare. Pads the shorter buffer to the longer
 *  one's length before `timingSafeEqual` so mismatched lengths don't
 *  short-circuit and leak "your password is the wrong length" via wall
 *  time. Length-mismatch is still reported as `false` via the residual
 *  equality check. */
function safeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');
  const len = Math.max(bufA.length, bufB.length, 1);
  const padA = Buffer.alloc(len);
  const padB = Buffer.alloc(len);
  bufA.copy(padA);
  bufB.copy(padB);
  const eq = timingSafeEqual(padA, padB);
  return eq && bufA.length === bufB.length;
}

export function isAuthorized(req: IncomingMessage, config: ServerConfig): boolean {
  if (!config.auth.enabled) return true;

  const authHeader = req.headers.authorization;
  if (!authHeader) return false;

  const match = authHeader.match(/^Basic (.+)$/i);
  if (!match) return false;

  const credentials = Buffer.from(match[1]!, 'base64').toString('utf8');
  const index = credentials.indexOf(':');
  if (index < 0) return false;

  const user = credentials.slice(0, index);
  const pass = credentials.slice(index + 1);

  // Compute both comparisons independently before ANDing so we don't
  // short-circuit on the username side and reveal timing information.
  const userMatch = safeStringEqual(user, config.auth.username || '');
  const passMatch = safeStringEqual(pass, config.auth.password || '');
  return userMatch && passMatch;
}

export async function createHttpHandler(opts: HttpHandlerOptions) {
  const { config, distDir } = opts;
  let bundledDir: string | null = opts.themesBundledDir;
  if (opts.isCompiled) {
    bundledDir = await materializeBundledThemes();
  }
  const packs: PackInfo[] = listPacks(opts.themesUserDir, bundledDir);
  const colourInfos = listColours(packs);
  // Themes / fonts / terminal-versions are frozen at startup — `packs` is
  // immutable for the process lifetime and the xterm bundle can't change
  // without a rebuild. Cache once so the handlers don't re-run the
  // multi-pass theme resolver + localeCompare sort + fs.readFileSync on
  // every GET.
  const themesCache = listThemes(packs);
  const fontsCache = listFonts(packs);
  const terminalVersionsCache = getTerminalVersions(opts.projectRoot);

  const makeHtml = () => {
    const clientConfig = { version: pkg.version, ...(config.testMode ? { testMode: true } : {}) };
    return opts.htmlTemplate
      .replace('<!-- __CONFIG__ -->', `<script>window.__TMUX_WEB_CONFIG = ${JSON.stringify(clientConfig)}</script>`)
      .replace('__BUNDLE__', `/dist/client/xterm.js`);
  };

  return async (req: IncomingMessage, res: ServerResponse) => {
    const remoteIp = req.socket.remoteAddress || '';
    if (!config.testMode && !isAllowed(remoteIp, config.allowedIps)) {
      debug(config, `HTTP ${req.method} ${req.url} from ${remoteIp} - rejected (IP)`);
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    if (!config.testMode && !isOriginAllowed(req, {
      allowedIps: config.allowedIps,
      allowedOrigins: config.allowedOrigins,
      serverScheme: config.tls ? 'https' : 'http',
      serverPort: config.port,
    })) {
      const origin = req.headers.origin ?? '<none>';
      debug(config, `HTTP ${req.method} ${req.url} from ${remoteIp} - rejected (Origin: ${origin})`);
      logOriginReject(origin, remoteIp);
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    if (!isAuthorized(req, config)) {
      debug(config, `HTTP ${req.method} ${req.url} from ${remoteIp} - unauthorized`);
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="tmux-web"' });
      res.end('Unauthorized');
      return;
    }

    debug(config, `HTTP ${req.method} ${req.url} from ${remoteIp}`);

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    if (pathname === '/api/fonts') {
      if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(fontsCache));
      return;
    }

    if (pathname === '/api/themes') {
      if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(themesCache));
      return;
    }

    if (pathname === '/api/colours') {
      if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(colourInfos.map(c => ({
        name: c.name, variant: c.variant, theme: c.theme,
      }))));
      return;
    }

    if (pathname.startsWith('/themes/')) {
      const rest = pathname.slice('/themes/'.length);
      const slash = rest.indexOf('/');
      if (slash < 0) {
        res.writeHead(404);
        res.end();
        return;
      }
      let packDir: string;
      let fileName: string;
      try {
        packDir = decodeURIComponent(rest.slice(0, slash));
        fileName = decodeURIComponent(rest.slice(slash + 1));
      } catch {
        res.writeHead(400);
        res.end();
        return;
      }
      const found = readPackFile(packDir, fileName, packs);
      if (!found) {
        res.writeHead(404);
        res.end();
        return;
      }
      const ext = path.extname(fileName);
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const data = new Uint8Array(await Bun.file(found.fullPath).arrayBuffer());
      return serveFile(res, data, contentType);
    }

    if (pathname.startsWith('/dist/')) {
      const relative = pathname.slice(6);
      const filePath = path.join(distDir, relative);
      const asset = await readFile(filePath, `dist/${relative}`);

      if (asset) return serveFile(res, asset.data, asset.contentType);
      return serve404(res);
    }

    if (pathname === '/api/sessions') {
      if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
      try {
        // tmux's #{session_id} is the `$N` internal id — monotonic
        // across the tmux server's lifetime, not 1-indexed per list.
        // Strip the `$` so the client can render it like window ids.
        const { stdout } = await execFileAsync(config.tmuxBin, ['list-sessions', '-F', '#{session_id}:#{session_name}']);
        const sessions = stdout.trim().split('\n').filter(Boolean).map((line) => {
          const [rawId, ...rest] = line.split(':');
          const name = rest.join(':');
          return { id: rawId.replace(/^\$/, ''), name };
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(sessions));
      } catch {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('[]');
      }
      return;
    }

    if (pathname === '/api/windows') {
      if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
      const sess = url.searchParams.get('session') || 'main';
      try {
        // Tab-separated — see matching comment in ws.ts sendWindowState.
        const { stdout } = await execFileAsync(config.tmuxBin, [
          'list-windows', '-t', sess, '-F', '#{window_index}\t#{window_name}\t#{window_active}',
        ]);
        const windows = stdout.trim().split('\n').filter(Boolean).map(line => {
          const [index, name, active] = line.split('\t');
          return { index, name, active: active === '1' };
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(windows));
      } catch {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('[]');
      }
      return;
    }

    if (pathname === '/api/drops/paste') {
      if (req.method !== 'POST') {
        res.writeHead(405);
        res.end();
        return;
      }
      const session = sanitizeSession(url.searchParams.get('session') || 'main');
      const id = url.searchParams.get('id');
      if (!id) {
        res.writeHead(400);
        res.end('Missing id');
        return;
      }
      // Re-resolve the drop from the store rather than trusting any path
      // on the query — guarantees we only paste paths that still exist
      // and are inside the drop store root.
      const drops = listDrops(opts.dropStorage);
      const hit = drops.find(d => d.dropId === id);
      if (!hit) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ pasted: false, id }));
        return;
      }
      if (!config.testMode) {
        try {
          await sendBytesToPane({
            tmuxBin: config.tmuxBin,
            target: session,
            bytes: await formatDropPasteBytes(config, session, hit.absolutePath),
          });
        } catch (err) {
          debug(config, `drop re-paste send-keys failed: ${err}`);
          res.writeHead(500);
          res.end('Inject failed');
          return;
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ pasted: true, id, path: hit.absolutePath, filename: hit.filename }));
      return;
    }

    if (pathname === '/api/drops') {
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ drops: listDrops(opts.dropStorage) }));
        return;
      }
      if (req.method === 'DELETE') {
        const id = url.searchParams.get('id');
        if (id) {
          // Single-drop revoke. deleteDrop rejects anything with path
          // separators or that resolves outside the storage root.
          const ok = deleteDrop(opts.dropStorage, id);
          res.writeHead(ok ? 200 : 404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ deleted: ok, id }));
          return;
        }
        // Purge-all: list first, then remove by id so the watcher map
        // stays consistent.
        const before = listDrops(opts.dropStorage);
        let count = 0;
        for (const d of before) {
          if (deleteDrop(opts.dropStorage, d.dropId)) count++;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ purged: count }));
        return;
      }
      res.writeHead(405);
      res.end();
      return;
    }

    if (pathname === '/api/drop') {
      if (req.method !== 'POST') {
        res.writeHead(405);
        res.end();
        return;
      }
      const session = sanitizeSession(url.searchParams.get('session') || 'main');
      // Browser encodes the original filename so arbitrary UTF-8 / special
      // chars survive HTTP headers (which are latin-1 by default).
      const rawNameHeader = req.headers['x-filename'];
      let rawName = 'file';
      if (typeof rawNameHeader === 'string' && rawNameHeader) {
        try { rawName = decodeURIComponent(rawNameHeader); } catch { rawName = rawNameHeader; }
      }

      const chunks: Buffer[] = [];
      let total = 0;
      let tooBig = false;
      try {
        for await (const chunk of req) {
          const buf = chunk as Buffer;
          total += buf.length;
          if (total > MAX_DROP_BYTES) { tooBig = true; break; }
          chunks.push(buf);
        }
      } catch {
        res.writeHead(400);
        res.end('Read error');
        return;
      }
      if (tooBig) {
        res.writeHead(413);
        res.end('Too large');
        return;
      }
      const data = Buffer.concat(chunks);

      let absolutePath: string;
      let filename: string;
      try {
        const wrote = writeDrop(opts.dropStorage, rawName, data);
        absolutePath = wrote.absolutePath;
        filename = wrote.filename;
      } catch (err) {
        debug(config, `drop write failed: ${err}`);
        res.writeHead(500);
        res.end('Write failed');
        return;
      }

      if (!config.testMode) {
        try {
          await sendBytesToPane({
            tmuxBin: config.tmuxBin,
            target: session,
            bytes: await formatDropPasteBytes(config, session, absolutePath),
          });
        } catch (err) {
          debug(config, `drop send-keys failed: ${err}`);
          // File is already on disk; surface a 500 so the client can warn
          // the user. The orphaned file will be TTL-swept.
          res.writeHead(500);
          res.end('Inject failed');
          return;
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ path: absolutePath, filename, size: data.length }));
      return;
    }

    if (pathname === '/api/session-settings') {
      if (req.method === 'GET') {
        const cfg = loadConfig(opts.sessionsStorePath);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(cfg));
        return;
      }
      if (req.method === 'PUT') {
        const contentLength = Number(req.headers['content-length'] ?? 0);
        if (contentLength > MAX_SESSION_SETTINGS_BYTES) {
          res.writeHead(413);
          res.end('Payload Too Large');
          return;
        }
        let body: string;
        try {
          const chunks: Buffer[] = [];
          let total = 0;
          for await (const chunk of req) {
            total += (chunk as Buffer).length;
            if (total > MAX_SESSION_SETTINGS_BYTES) {
              res.writeHead(413);
              res.end('Payload Too Large');
              return;
            }
            chunks.push(chunk as Buffer);
          }
          body = Buffer.concat(chunks).toString('utf-8');
        } catch (err) {
          debug(config, `session-settings PUT error: ${(err as Error).message}`);
          res.writeHead(400);
          res.end('Bad Request');
          return;
        }
        let patch: SessionsConfigPatch;
        try {
          patch = JSON.parse(body);
        } catch {
          res.writeHead(400);
          res.end('Bad JSON');
          return;
        }
        if (!patch || typeof patch !== 'object') {
          res.writeHead(400);
          res.end('Bad payload');
          return;
        }
        try {
          const next = applyPatch(opts.sessionsStorePath, patch);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(next));
        } catch (err) {
          res.writeHead(500);
          res.end('Save failed');
        }
        return;
      }
      if (req.method === 'DELETE') {
        const name = url.searchParams.get('name');
        if (!name) {
          res.writeHead(400);
          res.end('Missing name');
          return;
        }
        try {
          const next = deleteSession(opts.sessionsStorePath, name);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(next));
        } catch {
          res.writeHead(500);
          res.end('Delete failed');
        }
        return;
      }
      res.writeHead(405);
      res.end();
      return;
    }

    if (pathname === '/api/terminal-versions') {
      if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(terminalVersionsCache));
      return;
    }

    if (pathname === '/api/exit' && req.method === 'POST') {
      const action = url.searchParams.get('action') ?? 'quit';
      const code = action === 'restart' ? 2 : 0;
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(action === 'restart' ? 'restarting' : 'quitting');
      setTimeout(() => process.exit(code), 100);
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(makeHtml());
  };
}
