import fs from 'fs';
import os from 'os';
import path from 'path';
import { timingSafeEqual } from 'crypto';
import type { Server as BunServer } from 'bun';
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
import { type TmuxControl } from './tmux-control.js';
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
  tmuxControl: TmuxControl;
}

/** Per-session upload cap. 50 MiB — comfortably larger than typical
 *  screenshots and small docs, small enough to not starve memory when
 *  buffered in the HTTP handler before being written to disk. */
const MAX_DROP_BYTES = 50 * 1024 * 1024;

/** Session-settings body cap. 1 MiB is generous for a JSON schema of
 *  per-session UI preferences but still finite. */
const MAX_SESSION_SETTINGS_BYTES = 1 * 1024 * 1024;

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** Detect whether a `PUT /api/session-settings` patch tries to write a
 *  `clipboard` entry on any session. Clipboard grants are consent-only
 *  (recorded via `recordGrant` from `clipboard-policy.ts`); any PUT
 *  that carries one must be rejected. */
function hasClipboardField(patch: unknown): boolean {
  if (!patch || typeof patch !== 'object') return false;
  const sessions = (patch as { sessions?: unknown }).sessions;
  if (!sessions || typeof sessions !== 'object') return false;
  for (const sessionPatch of Object.values(sessions)) {
    if (sessionPatch && typeof sessionPatch === 'object'
        && 'clipboard' in (sessionPatch as object)) {
      return true;
    }
  }
  return false;
}

/** Thin wrapper that resolves the foreground process (so we know
 *  whether to shell-quote) and hands off to the pure formatter. */
async function formatDropPasteBytes(
  opts: HttpHandlerOptions,
  session: string,
  absolutePath: string,
): Promise<string> {
  const config = opts.config;
  let exePath: string | null = null;
  if (!config.testMode) {
    try {
      const fg = await getForegroundProcess(opts.tmuxControl.run, session);
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

function fileResponse(data: Buffer | Uint8Array, contentType: string): Response {
  return new Response(data, { status: 200, headers: { 'Content-Type': contentType } });
}

function notFound(): Response {
  return new Response('Not Found', { status: 404 });
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

export function isAuthorized(authHeader: string | null | undefined, config: ServerConfig): boolean {
  if (!config.auth.enabled) return true;

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

export type HttpHandler = (req: Request, server: BunServer<unknown>) => Response | Promise<Response>;

/** Read the request body into a Buffer, enforcing a byte cap mid-stream
 *  so a malicious client can't OOM the process. Returns `null` when the
 *  cap is exceeded. */
async function readBodyCapped(req: Request, max: number): Promise<Buffer | null> {
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        try { await reader.cancel(); } catch {}
        return null;
      }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  return Buffer.concat(chunks);
}

export async function createHttpHandler(opts: HttpHandlerOptions): Promise<HttpHandler> {
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

  return async (req, server) => {
    const remoteIp = server.requestIP(req)?.address || '';
    const method = req.method;
    if (!config.testMode && !isAllowed(remoteIp, config.allowedIps)) {
      debug(config, `HTTP ${method} ${req.url} from ${remoteIp} - rejected (IP)`);
      return new Response('Forbidden', { status: 403 });
    }

    const originHeader = req.headers.get('origin') ?? undefined;
    if (!config.testMode && !isOriginAllowed(originHeader, {
      allowedIps: config.allowedIps,
      allowedOrigins: config.allowedOrigins,
      serverScheme: config.tls ? 'https' : 'http',
      serverPort: config.port,
    })) {
      const origin = originHeader ?? '<none>';
      debug(config, `HTTP ${method} ${req.url} from ${remoteIp} - rejected (Origin: ${origin})`);
      logOriginReject(origin, remoteIp);
      return new Response('Forbidden', { status: 403 });
    }

    const authHeader = req.headers.get('authorization') ?? undefined;
    if (!isAuthorized(authHeader, config)) {
      debug(config, `HTTP ${method} ${req.url} from ${remoteIp} - unauthorized`);
      return new Response('Unauthorized', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Basic realm="tmux-web"' },
      });
    }

    debug(config, `HTTP ${method} ${req.url} from ${remoteIp}`);

    const url = new URL(req.url);
    const pathname = url.pathname;

    if (pathname === '/api/fonts') {
      if (method !== 'GET') return new Response(null, { status: 405 });
      return new Response(JSON.stringify(fontsCache), { headers: JSON_HEADERS });
    }

    if (pathname === '/api/themes') {
      if (method !== 'GET') return new Response(null, { status: 405 });
      return new Response(JSON.stringify(themesCache), { headers: JSON_HEADERS });
    }

    if (pathname === '/api/colours') {
      if (method !== 'GET') return new Response(null, { status: 405 });
      const body = JSON.stringify(colourInfos.map(c => ({
        name: c.name, variant: c.variant, theme: c.theme,
      })));
      return new Response(body, { headers: JSON_HEADERS });
    }

    if (pathname.startsWith('/themes/')) {
      const rest = pathname.slice('/themes/'.length);
      const slash = rest.indexOf('/');
      if (slash < 0) return new Response(null, { status: 404 });
      let packDir: string;
      let fileName: string;
      try {
        packDir = decodeURIComponent(rest.slice(0, slash));
        fileName = decodeURIComponent(rest.slice(slash + 1));
      } catch {
        return new Response(null, { status: 400 });
      }
      const found = readPackFile(packDir, fileName, packs);
      if (!found) return new Response(null, { status: 404 });
      const ext = path.extname(fileName);
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const data = new Uint8Array(await Bun.file(found.fullPath).arrayBuffer());
      return fileResponse(data, contentType);
    }

    if (pathname.startsWith('/dist/')) {
      const relative = pathname.slice(6);
      const filePath = path.join(distDir, relative);
      const asset = await readFile(filePath, `dist/${relative}`);
      if (asset) return fileResponse(asset.data, asset.contentType);
      return notFound();
    }

    if (pathname === '/api/sessions') {
      if (method !== 'GET') return new Response(null, { status: 405 });
      let stdout: string;
      try {
        stdout = await opts.tmuxControl.run(['list-sessions', '-F', '#{session_id}:#{session_name}']);
      } catch {
        // Control client unavailable or stuck (NoControlClientError / TmuxCommandError).
        // Fall back to execFileAsync so a stuck control client never causes
        // the sessions menu to return an empty list or hang.
        try {
          const r = await execFileAsync(config.tmuxBin, ['list-sessions', '-F', '#{session_id}:#{session_name}']);
          stdout = r.stdout;
        } catch {
          return new Response('[]', { headers: JSON_HEADERS });
        }
      }
      // tmux's #{session_id} is the `$N` internal id — monotonic
      // across the tmux server's lifetime, not 1-indexed per list.
      // Strip the `$` so the client can render it like window ids.
      const sessions = stdout.trim().split('\n').filter(Boolean).map((line) => {
        const [rawId, ...rest] = line.split(':');
        const name = rest.join(':');
        return { id: (rawId ?? '').replace(/^\$/, ''), name };
      });
      return new Response(JSON.stringify(sessions), { headers: JSON_HEADERS });
    }

    if (pathname === '/api/windows') {
      if (method !== 'GET') return new Response(null, { status: 405 });
      const sess = url.searchParams.get('session') || 'main';
      const LIST_WINDOWS_ARGS = ['list-windows', '-t', sess, '-F', '#{window_index}\t#{window_name}\t#{window_active}'] as const;
      const parseWindows = (raw: string) =>
        raw.trim().split('\n').filter(Boolean).map(line => {
          const [index, name, active] = line.split('\t');
          return { index, name, active: active === '1' };
        });
      try {
        // Tab-separated — see matching comment in ws.ts sendWindowState.
        const stdout = await opts.tmuxControl.run(LIST_WINDOWS_ARGS);
        return new Response(JSON.stringify(parseWindows(stdout)), { headers: JSON_HEADERS });
      } catch {
        try {
          const r = await execFileAsync(config.tmuxBin, LIST_WINDOWS_ARGS);
          return new Response(JSON.stringify(parseWindows(r.stdout)), { headers: JSON_HEADERS });
        } catch {
          return new Response('[]', { headers: JSON_HEADERS });
        }
      }
    }

    if (pathname === '/api/drops/paste') {
      if (method !== 'POST') return new Response(null, { status: 405 });
      const session = sanitizeSession(url.searchParams.get('session') || 'main');
      const id = url.searchParams.get('id');
      if (!id) return new Response('Missing id', { status: 400 });
      // Re-resolve the drop from the store rather than trusting any path
      // on the query — guarantees we only paste paths that still exist
      // and are inside the drop store root.
      const drops = listDrops(opts.dropStorage);
      const hit = drops.find(d => d.dropId === id);
      if (!hit) {
        return new Response(JSON.stringify({ pasted: false, id }), { status: 404, headers: JSON_HEADERS });
      }
      if (!config.testMode) {
        try {
          await sendBytesToPane({
            run: opts.tmuxControl.run,
            target: session,
            bytes: await formatDropPasteBytes(opts, session, hit.absolutePath),
          });
        } catch (err) {
          debug(config, `drop re-paste send-keys failed: ${err}`);
          return new Response('Inject failed', { status: 500 });
        }
      }
      return new Response(JSON.stringify({ pasted: true, id, path: hit.absolutePath, filename: hit.filename }),
        { headers: JSON_HEADERS });
    }

    if (pathname === '/api/drops') {
      if (method === 'GET') {
        // Strip `absolutePath` from the public response — it leaks the
        // runtime uid + `$XDG_RUNTIME_DIR` layout (/run/user/<uid>/…).
        // The re-paste flow resolves paths server-side from `dropId`
        // (see the /api/drops/paste handler), so the client doesn't
        // need them.
        const drops = listDrops(opts.dropStorage).map(d => ({
          dropId: d.dropId,
          filename: d.filename,
          size: d.size,
          mtime: d.mtime,
        }));
        return new Response(JSON.stringify({ drops }), { headers: JSON_HEADERS });
      }
      if (method === 'DELETE') {
        const id = url.searchParams.get('id');
        if (id) {
          // Single-drop revoke. deleteDrop rejects anything with path
          // separators or that resolves outside the storage root.
          const ok = deleteDrop(opts.dropStorage, id);
          return new Response(JSON.stringify({ deleted: ok, id }),
            { status: ok ? 200 : 404, headers: JSON_HEADERS });
        }
        // Purge-all: list first, then remove by id so the watcher map
        // stays consistent.
        const before = listDrops(opts.dropStorage);
        let count = 0;
        for (const d of before) {
          if (deleteDrop(opts.dropStorage, d.dropId)) count++;
        }
        return new Response(JSON.stringify({ purged: count }), { headers: JSON_HEADERS });
      }
      return new Response(null, { status: 405 });
    }

    if (pathname === '/api/drop') {
      if (method !== 'POST') return new Response(null, { status: 405 });
      const session = sanitizeSession(url.searchParams.get('session') || 'main');
      // Browser encodes the original filename so arbitrary UTF-8 / special
      // chars survive HTTP headers (which are latin-1 by default).
      const rawNameHeader = req.headers.get('x-filename');
      let rawName = 'file';
      if (typeof rawNameHeader === 'string' && rawNameHeader) {
        try { rawName = decodeURIComponent(rawNameHeader); } catch { rawName = rawNameHeader; }
      }

      let data: Buffer;
      try {
        const buf = await readBodyCapped(req, MAX_DROP_BYTES);
        if (buf === null) return new Response('Too large', { status: 413 });
        data = buf;
      } catch {
        return new Response('Read error', { status: 400 });
      }

      let absolutePath: string;
      let filename: string;
      try {
        const wrote = writeDrop(opts.dropStorage, rawName, data);
        absolutePath = wrote.absolutePath;
        filename = wrote.filename;
      } catch (err) {
        debug(config, `drop write failed: ${err}`);
        return new Response('Write failed', { status: 500 });
      }

      if (!config.testMode) {
        try {
          await sendBytesToPane({
            run: opts.tmuxControl.run,
            target: session,
            bytes: await formatDropPasteBytes(opts, session, absolutePath),
          });
        } catch (err) {
          debug(config, `drop send-keys failed: ${err}`);
          // File is already on disk; surface a 500 so the client can warn
          // the user. The orphaned file will be TTL-swept.
          return new Response('Inject failed', { status: 500 });
        }
      }

      return new Response(JSON.stringify({ path: absolutePath, filename, size: data.length }),
        { headers: JSON_HEADERS });
    }

    if (pathname === '/api/session-settings') {
      if (method === 'GET') {
        const cfg = loadConfig(opts.sessionsStorePath);
        return new Response(JSON.stringify(cfg), { headers: JSON_HEADERS });
      }
      if (method === 'PUT') {
        const contentLength = Number(req.headers.get('content-length') ?? 0);
        if (contentLength > MAX_SESSION_SETTINGS_BYTES) {
          return new Response('Payload Too Large', { status: 413 });
        }
        let body: string;
        try {
          const buf = await readBodyCapped(req, MAX_SESSION_SETTINGS_BYTES);
          if (buf === null) return new Response('Payload Too Large', { status: 413 });
          body = buf.toString('utf-8');
        } catch (err) {
          debug(config, `session-settings PUT error: ${(err as Error).message}`);
          return new Response('Bad Request', { status: 400 });
        }
        let patch: SessionsConfigPatch;
        try {
          patch = JSON.parse(body);
        } catch {
          return new Response('Bad JSON', { status: 400 });
        }
        if (!patch || typeof patch !== 'object') {
          return new Response('Bad payload', { status: 400 });
        }
        // Clipboard grants are only writable via the consent-prompt
        // pipeline (`recordGrant`, keyed by a live BLAKE3 of the
        // requesting binary). Accepting them through this PUT would let
        // an authenticated client pre-seed allow-grants for arbitrary
        // `exePath` strings and bypass the prompt for any binary they
        // control at that path. The client never sends this field —
        // reject rather than silently drop so any future regression
        // surfaces immediately.
        if (hasClipboardField(patch)) {
          return new Response('clipboard entries are not writable via PUT — use the consent prompt',
            { status: 400 });
        }
        try {
          const next = applyPatch(opts.sessionsStorePath, patch);
          return new Response(JSON.stringify(next), { headers: JSON_HEADERS });
        } catch (err) {
          return new Response('Save failed', { status: 500 });
        }
      }
      if (method === 'DELETE') {
        const name = url.searchParams.get('name');
        if (!name) return new Response('Missing name', { status: 400 });
        try {
          const next = deleteSession(opts.sessionsStorePath, name);
          return new Response(JSON.stringify(next), { headers: JSON_HEADERS });
        } catch {
          return new Response('Delete failed', { status: 500 });
        }
      }
      return new Response(null, { status: 405 });
    }

    if (pathname === '/api/terminal-versions') {
      if (method !== 'GET') return new Response(null, { status: 405 });
      return new Response(JSON.stringify(terminalVersionsCache), { headers: JSON_HEADERS });
    }

    if (pathname === '/api/exit' && method === 'POST') {
      const action = url.searchParams.get('action') ?? 'quit';
      const code = action === 'restart' ? 2 : 0;
      setTimeout(() => process.exit(code), 100);
      return new Response(action === 'restart' ? 'restarting' : 'quitting',
        { headers: { 'Content-Type': 'text/plain' } });
    }

    return new Response(makeHtml(), { headers: { 'Content-Type': 'text/html' } });
  };
}
