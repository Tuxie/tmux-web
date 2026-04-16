import { execFile } from 'child_process';
import { promisify } from 'util';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type { Server as HttpServer } from 'http';
import type { Server as HttpsServer } from 'https';
import type { Duplex } from 'stream';
import type { ServerConfig, WindowInfo } from '../shared/types.js';
import { processData, frameTTMessage } from './protocol.js';
import { buildPtyCommand, buildPtyEnv, spawnPty, sanitizeSession } from './pty.js';
import { isAllowed } from './allowlist.js';
import { isAuthorized } from './http.js';

const execFileAsync = promisify(execFile);

export interface WsServerOptions {
  config: ServerConfig;
  tmuxConfPath: string;
}

function debug(config: ServerConfig, ...args: unknown[]): void {
  if (config.debug) process.stderr.write(`[debug] ${args.join(' ')}\n`);
}

export function createWsServer(
  httpServer: HttpServer | HttpsServer,
  opts: WsServerOptions,
): WebSocketServer {
  const { config, tmuxConfPath } = opts;
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const remoteIp = (socket as any).remoteAddress || '';
    debug(config, `WS upgrade from ${remoteIp}`);
    if (!config.testMode && !isAllowed(remoteIp, config.allowedIps)) {
      debug(config, `WS upgrade from ${remoteIp} - rejected (IP)`);
      socket.destroy();
      return;
    }

    if (!isAuthorized(req, config)) {
      debug(config, `WS upgrade from ${remoteIp} - unauthorized`);
      socket.write('HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm="tmux-web"\r\n\r\n');
      socket.destroy();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/ws')) {
      debug(config, `WS upgrade from ${remoteIp} - allowed`);
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    handleConnection(ws, req, config, tmuxConfPath);
  });

  return wss;
}

/**
 * Run a tmux session-level action (rename / kill) against the current
 * session. Bypasses the PTY so it works regardless of the user's tmux
 * prefix binding.
 */
async function applySessionAction(
  sessionName: string,
  msg: { action: string; name?: string },
  config: ServerConfig,
): Promise<void> {
  if (config.testMode) return;
  const bin = config.tmuxBin;
  try {
    switch (msg.action) {
      case 'rename':
        if (typeof msg.name !== 'string' || !msg.name.trim()) return;
        await execFileAsync(bin, ['rename-session', '-t', sessionName, msg.name]);
        break;
      case 'kill':
        await execFileAsync(bin, ['kill-session', '-t', sessionName]);
        break;
    }
  } catch { /* ignore */ }
}

/**
 * Run a tmux window action against the target session, bypassing the PTY
 * so it works regardless of what the user has bound their tmux prefix
 * key to. `index` is the tmux window index; omit for session-level
 * actions (e.g. opening a new window).
 */
async function applyWindowAction(
  sessionName: string,
  msg: { action: string; index?: string; name?: string },
  config: ServerConfig,
): Promise<void> {
  if (config.testMode) return;
  const bin = config.tmuxBin;
  const target = typeof msg.index === 'string' ? `${sessionName}:${msg.index}` : sessionName;
  try {
    switch (msg.action) {
      case 'select':
        if (typeof msg.index !== 'string') return;
        await execFileAsync(bin, ['select-window', '-t', target]);
        break;
      case 'new': {
        const args = ['new-window', '-t', sessionName];
        if (typeof msg.name === 'string' && msg.name.trim()) {
          args.push('-n', msg.name.trim());
        }
        await execFileAsync(bin, args);
        break;
      }
      case 'close':
        if (typeof msg.index !== 'string') return;
        await execFileAsync(bin, ['kill-window', '-t', target]);
        break;
      case 'rename':
        if (typeof msg.index !== 'string' || typeof msg.name !== 'string') return;
        await execFileAsync(bin, ['rename-window', '-t', target, msg.name]);
        break;
    }
  } catch { /* ignore — window may have already been closed, etc. */ }
}

/**
 * Set COLORFGBG and CLITHEME on the tmux session so new windows/panes
 * inherit them. No-op in --test mode (no tmux). Retries once after 500 ms
 * to cover the race when the very first client connects and tmux is still
 * starting up the fresh session.
 */
async function applyColourVariant(
  sessionName: string,
  variant: 'dark' | 'light',
  config: ServerConfig,
): Promise<void> {
  if (config.testMode) return;
  const colorFgBg = variant === 'dark' ? '15;0' : '0;15';
  const run = () => Promise.all([
    execFileAsync(config.tmuxBin, ['set-environment', '-t', sessionName, 'COLORFGBG', colorFgBg]),
    execFileAsync(config.tmuxBin, ['set-environment', '-t', sessionName, 'CLITHEME', variant]),
  ]);
  try {
    await run();
  } catch {
    setTimeout(() => { run().catch(() => {}); }, 500);
  }
}

async function sendWindowState(ws: WebSocket, sessionName: string, config: ServerConfig): Promise<void> {
  try {
    const [winResult, titleResult] = await Promise.allSettled([
      execFileAsync(config.tmuxBin, [
        'list-windows', '-t', sessionName, '-F', '#{window_index}:#{window_name}:#{window_active}',
      ]),
      execFileAsync(config.tmuxBin, [
        'display-message', '-t', sessionName, '-p', '#{pane_title}',
      ]),
    ]);
    const windows: WindowInfo[] = winResult.status === 'fulfilled'
      ? winResult.value.stdout.trim().split('\n').filter(Boolean).map(line => {
          const [index, name, active] = line.split(':');
          return { index: index!, name: name!, active: active === '1' };
        })
      : [];
    const title = titleResult.status === 'fulfilled'
      ? titleResult.value.stdout.trim()
      : undefined;
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(frameTTMessage({ session: sessionName, windows, title }));
    }
  } catch {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(frameTTMessage({ session: sessionName }));
    }
  }
}

function handleConnection(
  ws: WebSocket,
  req: IncomingMessage,
  config: ServerConfig,
  tmuxConfPath: string,
): void {
  const remoteIp = (req.socket as any).remoteAddress || '';
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const cols = parseInt(url.searchParams.get('cols') || '80');
  const rows = parseInt(url.searchParams.get('rows') || '24');
  const session = sanitizeSession(url.searchParams.get('session') || 'main');

  debug(config, `WS connected from ${remoteIp} session=${session} cols=${cols} rows=${rows}`);

  const command = buildPtyCommand({ testMode: config.testMode, session, tmuxConfPath, tmuxBin: config.tmuxBin });
  const env = buildPtyEnv();
  const ptyProcess = spawnPty({ command, env, cols, rows });
  debug(config, `PTY spawned for session=${session} cmd=${command.file}`);

  let lastSession = session;
  let lastTitle = '';

  ptyProcess.onData((data: string) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    const result = processData(data, lastSession);
    for (const msg of result.messages) {
      ws.send(frameTTMessage(msg));
    }
    if (result.output) ws.send(result.output);
    if (result.titleChanged && result.detectedTitle !== lastTitle) {
      lastTitle = result.detectedTitle || '';
      if (result.detectedSession) lastSession = result.detectedSession;
      sendWindowState(ws, lastSession, config);
    }
  });

  ptyProcess.onExit(() => {
    if (ws.readyState === WebSocket.OPEN) ws.close();
  });

  ws.on('message', (data) => {
    const msg = data.toString('utf8');
    if (msg.startsWith('{')) {
      try {
        const parsed = JSON.parse(msg);
        if (parsed.type === 'resize') {
          ptyProcess.resize(parsed.cols, parsed.rows);
          return;
        }
        if (parsed.type === 'colour-variant' && (parsed.variant === 'dark' || parsed.variant === 'light')) {
          void applyColourVariant(lastSession, parsed.variant, config);
          return;
        }
        if (parsed.type === 'window' && typeof parsed.action === 'string') {
          void applyWindowAction(lastSession, parsed, config);
          return;
        }
        if (parsed.type === 'session' && typeof parsed.action === 'string') {
          void applySessionAction(lastSession, parsed, config);
          return;
        }
      } catch { /* not JSON, pass through */ }
    }
    ptyProcess.write(msg);
  });

  ws.on('close', () => {
    debug(config, `WS closed from ${remoteIp} session=${session}`);
    ptyProcess.kill();
  });
  ws.on('error', () => {});
}
