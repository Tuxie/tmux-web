import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { IncomingMessage, ServerResponse } from 'http';
import { MIME_TYPES } from '../shared/constants.js';
import type { ServerConfig } from '../shared/types.js';
import { isAllowed } from './allowlist.js';
import { embeddedAssets } from './assets-embedded.js';
import {
  listColours,
  listFonts,
  listPacks,
  listThemes,
  readPackFile,
  type PackInfo,
} from './themes.js';
import pkg from '../../package.json' with { type: 'json' };

const execFileAsync = promisify(execFile);

export interface HttpHandlerOptions {
  config: ServerConfig;
  htmlTemplate: string;
  distDir: string;
  fontsDir: string;
  themesUserDir: string;
  themesBundledDir: string;
  projectRoot: string;
  isCompiled?: boolean;
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
    fs.mkdirSync(path.dirname(dest), { recursive: true });
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

  return user === config.auth.username && pass === config.auth.password;
}

export async function createHttpHandler(opts: HttpHandlerOptions) {
  const { config, distDir } = opts;
  let bundledDir: string | null = opts.themesBundledDir;
  if (opts.isCompiled) {
    bundledDir = await materializeBundledThemes();
  }
  const packs: PackInfo[] = listPacks(opts.themesUserDir, bundledDir);

  const makeHtml = () => {
    return opts.htmlTemplate
      .replace('<!-- __CONFIG__ -->', `<script>window.__TMUX_WEB_CONFIG = ${JSON.stringify({ version: pkg.version })}</script>`)
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

    if (!isAuthorized(req, config)) {
      debug(config, `HTTP ${req.method} ${req.url} from ${remoteIp} - unauthorized`);
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="tmux-web"' });
      res.end('Unauthorized');
      return;
    }

    debug(config, `HTTP ${req.method} ${req.url} from ${remoteIp}`);

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    if (pathname.startsWith('/fonts/')) {
      let filename: string;
      try { filename = decodeURIComponent(pathname.slice(7)); } catch { res.writeHead(400); res.end(); return; }
      if (!filename || filename.includes('/') || filename.includes('..')) {
        res.writeHead(400); res.end(); return;
      }
      const asset = await readFile(path.join(opts.fontsDir, filename), `fonts/${filename}`);
      if (asset) return serveFile(res, asset.data, asset.contentType);
      return serve404(res);
    }

    if (pathname === '/api/fonts') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(listFonts(packs)));
      return;
    }

    if (pathname === '/api/themes') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(listThemes(packs)));
      return;
    }

    if (pathname === '/api/colours') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(listColours(packs).map(c => ({
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
        // The default theme pack still reuses the legacy bundled fonts/ dir.
        if (packDir === 'default') {
          const legacyFont = await readFile(path.join(opts.fontsDir, fileName), `fonts/${fileName}`);
          if (legacyFont) return serveFile(res, legacyFont.data, legacyFont.contentType);
        }
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
      try {
        const { stdout } = await execFileAsync(config.tmuxBin, ['list-sessions', '-F', '#{session_name}']);
        const sessions = stdout.trim().split('\n').filter(Boolean);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(sessions));
      } catch {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('[]');
      }
      return;
    }

    if (pathname === '/api/windows') {
      const sess = url.searchParams.get('session') || 'main';
      try {
        const { stdout } = await execFileAsync(config.tmuxBin, [
          'list-windows', '-t', sess, '-F', '#{window_index}:#{window_name}:#{window_active}',
        ]);
        const windows = stdout.trim().split('\n').filter(Boolean).map(line => {
          const [index, name, active] = line.split(':');
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

    if (pathname === '/api/terminal-versions') {
      const versions = getTerminalVersions(opts.projectRoot);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(versions));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(makeHtml());
  };
}
