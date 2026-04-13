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
      debug(config, `WS upgrade from ${remoteIp} - rejected`);
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

async function sendWindowState(ws: WebSocket, sessionName: string): Promise<void> {
  try {
    const { stdout } = await execFileAsync('tmux', [
      'list-windows', '-t', sessionName, '-F', '#{window_index}:#{window_name}:#{window_active}',
    ]);
    const windows: WindowInfo[] = stdout.trim().split('\n').filter(Boolean).map(line => {
      const [index, name, active] = line.split(':');
      return { index: index!, name: name!, active: active === '1' };
    });
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(frameTTMessage({ session: sessionName, windows }));
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

  const command = buildPtyCommand({ testMode: config.testMode, session, tmuxConfPath });
  const env = buildPtyEnv(config.terminal);
  const ptyProcess = spawnPty({ command, env, cols, rows, terminal: config.terminal });
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
      sendWindowState(ws, lastSession);
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
