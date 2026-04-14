import fs from 'fs';
import path from 'path';
import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import { createRequire } from 'module';
import type { IncomingMessage, ServerResponse } from 'http';
import { MIME_TYPES } from '../shared/constants.js';
import type { ServerConfig, TerminalBackend } from '../shared/types.js';
import { isAllowed } from './allowlist.js';
import { embeddedAssets } from './assets-embedded.js';
import pkg from '../../package.json' with { type: 'json' };

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

export interface HttpHandlerOptions {
  config: ServerConfig;
  htmlTemplate: string;
  distDir: string;
  fontsDir: string;
  projectRoot: string;
  ghosttyDistDir?: string;
  ghosttyWasmPath?: string;
  isCompiled?: boolean;
}

function debug(config: ServerConfig, ...args: unknown[]): void {
  if (config.debug) process.stderr.write(`[debug] ${args.join(' ')}\n`);
}

function bundleName(terminal: TerminalBackend): string {
  switch (terminal) {
    case 'ghostty': return 'ghostty.js';
    case 'xterm': return 'xterm.js';
  }
}

function getAssetPath(key: string): string | null {
  return embeddedAssets[key] || null;
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

  // Vendor xterm.js rev is baked into dist/client/xterm.js by bun-build.ts
  // as a sentinel comment. Read it from the embedded asset (or disk, when
  // running from source). That is the source of truth in the compiled binary.
  const xtermAssetPath = embeddedAssets['dist/client/xterm.js']
    ?? path.join(projectRoot, 'dist/client/xterm.js');
  try {
    const bundle = fs.readFileSync(xtermAssetPath, 'utf-8');
    const m = bundle.match(/tmux-web: vendor xterm\.js rev ([0-9a-f]{40})/);
    if (m) {
      versions['xterm'] = `xterm.js (HEAD, ${m[1].slice(0, 7)})`;
    } else {
      versions['xterm'] = 'xterm.js (unknown)';
    }
  } catch {
    versions['xterm'] = 'xterm.js (unknown)';
  }

  // Get ghostty-web version
  try {
    const ghosttyPkgPath = require.resolve('ghostty-web/package.json');
    const ghosttyPkg = JSON.parse(fs.readFileSync(ghosttyPkgPath, 'utf-8'));
    versions['ghostty'] = 'ghostty-web v' + ghosttyPkg.version;
  } catch {
    versions['ghostty'] = 'ghostty-web v0.4.0';
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

export function createHttpHandler(opts: HttpHandlerOptions) {
  const { config, distDir } = opts;

  // Support dynamic terminal selection via query parameter
  function getEffectiveTerminal(req: IncomingMessage): TerminalBackend {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const terminalParam = url.searchParams.get('terminal');

    // If a valid terminal is requested via query param, use it
    if (terminalParam && ['ghostty', 'xterm'].includes(terminalParam)) {
      return terminalParam as TerminalBackend;
    }

    // Otherwise use the server's configured terminal
    return config.terminal;
  }

  const makeHtml = (req: IncomingMessage) => {
    const terminal = getEffectiveTerminal(req);
    return opts.htmlTemplate
      .replace('<!-- __CONFIG__ -->', `<script>window.__TMUX_WEB_CONFIG = ${JSON.stringify({ terminal, version: pkg.version })}</script>`)
      .replace('__BUNDLE__', `/dist/client/${bundleName(terminal)}`);
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
      try {
        let files: string[];
        if (opts.isCompiled && Object.keys(embeddedAssets).some(k => k.startsWith('fonts/'))) {
          files = Object.keys(embeddedAssets)
            .filter(k => k.startsWith('fonts/') && k.endsWith('.woff2'))
            .map(k => k.slice(6))
            .sort();
        } else {
          files = fs.readdirSync(opts.fontsDir).filter(f => f.endsWith('.woff2')).sort();
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(files));
      } catch {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('[]');
      }
      return;
    }

    if (pathname.startsWith('/dist/')) {
      const relative = pathname.slice(6);
      const filePath = path.join(distDir, relative);
      const asset = await readFile(filePath, `dist/${relative}`) || 
                    (opts.ghosttyDistDir ? await readFile(path.join(opts.ghosttyDistDir, relative), `dist/${relative}`) : null);
      
      if (asset) return serveFile(res, asset.data, asset.contentType);
      return serve404(res);
    }

    if (pathname === '/ghostty-vt.wasm') {
      const asset = (opts.ghosttyWasmPath ? await readFile(opts.ghosttyWasmPath, 'ghostty-vt.wasm') : null) ||
                    await readFile('', 'ghostty-vt.wasm');
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
    res.end(makeHtml(req));
  };
}
