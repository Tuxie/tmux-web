import fs from 'fs';
import path from 'path';
import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import { createRequire } from 'module';
import type { IncomingMessage, ServerResponse } from 'http';
import { MIME_TYPES } from '../shared/constants.js';
import type { ServerConfig, TerminalBackend } from '../shared/types.js';
import { isAllowed } from './allowlist.js';

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
}

function debug(config: ServerConfig, ...args: unknown[]): void {
  if (config.debug) process.stderr.write(`[debug] ${args.join(' ')}\n`);
}

function bundleName(terminal: TerminalBackend): string {
  switch (terminal) {
    case 'ghostty': return 'ghostty.js';
    case 'xterm': return 'xterm.js';
    case 'xterm-dev': return 'xterm-dev.js';
  }
}

function getTerminalVersions(projectRoot: string): Record<string, string> {
  const versions: Record<string, string> = {};

  // Get xterm version
  try {
    const xtermPkgPath = require.resolve('@xterm/xterm/package.json');
    const xtermPkg = JSON.parse(fs.readFileSync(xtermPkgPath, 'utf-8'));
    versions['xterm'] = 'xterm.js v' + xtermPkg.version;
  } catch {
    versions['xterm'] = 'xterm.js v6.0.0';
  }

  // Get ghostty-web version
  try {
    const ghosttyPkgPath = require.resolve('ghostty-web/package.json');
    const ghosttyPkg = JSON.parse(fs.readFileSync(ghosttyPkgPath, 'utf-8'));
    versions['ghostty'] = 'ghostty-web v' + ghosttyPkg.version;
  } catch {
    versions['ghostty'] = 'ghostty-web v0.4.0';
  }

  // Get xterm-dev git revision
  try {
    const vendorDir = path.join(projectRoot, 'vendor/xterm.js');
    const rev = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: vendorDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim();
    versions['xterm-dev'] = `xterm.js HEAD (${rev})`;
  } catch {
    versions['xterm-dev'] = 'xterm.js HEAD';
  }

  return versions;
}

export function createHttpHandler(opts: HttpHandlerOptions) {
  const { config, distDir } = opts;

  // Support dynamic terminal selection via query parameter
  function getEffectiveTerminal(req: IncomingMessage): 'ghostty' | 'xterm' | 'xterm-dev' {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const terminalParam = url.searchParams.get('terminal');

    // If a valid terminal is requested via query param, use it
    if (terminalParam && ['ghostty', 'xterm', 'xterm-dev'].includes(terminalParam)) {
      return terminalParam as 'ghostty' | 'xterm' | 'xterm-dev';
    }

    // Otherwise use the server's configured terminal
    return config.terminal;
  }

  const makeHtml = (req: IncomingMessage) => {
    const terminal = getEffectiveTerminal(req);
    return opts.htmlTemplate
      .replace('<!-- __CONFIG__ -->', `<script>window.__TMUX_WEB_CONFIG = ${JSON.stringify({ terminal })}</script>`)
      .replace('__BUNDLE__', `/dist/client/${bundleName(terminal)}`);
  };

  return async (req: IncomingMessage, res: ServerResponse) => {
    const remoteIp = req.socket.remoteAddress || '';
    if (!config.testMode && !isAllowed(remoteIp, config.allowedIps)) {
      debug(config, `HTTP ${req.method} ${req.url} from ${remoteIp} - rejected`);
      res.writeHead(403);
      res.end('Forbidden');
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
      return serveFile(path.join(opts.fontsDir, filename), res);
    }

    if (pathname === '/api/fonts') {
      try {
        const files = fs.readdirSync(opts.fontsDir).filter(f => f.endsWith('.woff2')).sort();
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
      // Try project dist first, fall back to ghostty-web dist
      return serveFileWithFallback(filePath, opts.ghosttyDistDir ? path.join(opts.ghosttyDistDir, relative) : null, res);
    }

    if (pathname === '/ghostty-vt.wasm' && opts.ghosttyWasmPath) {
      return serveFile(opts.ghosttyWasmPath, res);
    }

    if (pathname === '/api/sessions') {
      try {
        const { stdout } = await execFileAsync('tmux', ['list-sessions', '-F', '#{session_name}']);
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
        const { stdout } = await execFileAsync('tmux', [
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

function serveFile(filePath: string, res: ServerResponse): void {
  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

function serveFileWithFallback(primary: string, fallback: string | null, res: ServerResponse): void {
  const ext = path.extname(primary);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  fs.readFile(primary, (err, data) => {
    if (err && fallback) {
      fs.readFile(fallback, (err2, data2) => {
        if (err2) {
          res.writeHead(404);
          res.end('Not Found');
          return;
        }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data2);
      });
      return;
    }
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}
