import { execFile } from 'child_process';
import { promisify } from 'util';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type { Server as HttpServer } from 'http';
import type { Server as HttpsServer } from 'https';
import type { Duplex } from 'stream';
import type { ServerConfig, WindowInfo } from '../shared/types.js';
import { processData, frameTTMessage, buildOsc52Response } from './protocol.js';
import { buildPtyCommand, buildPtyEnv, spawnPty, sanitizeSession } from './pty.js';
import { isAllowed } from './allowlist.js';
import { isAuthorized } from './http.js';
import { getForegroundProcess } from './foreground-process.js';
import { resolvePolicy, recordGrant } from './clipboard-policy.js';

const execFileAsync = promisify(execFile);

export interface WsServerOptions {
  config: ServerConfig;
  tmuxConfPath: string;
  /** Path to sessions.json; used for reading & writing the per-binary
   *  OSC 52 clipboard policy. */
  sessionsStorePath: string;
}

function debug(config: ServerConfig, ...args: unknown[]): void {
  if (config.debug) process.stderr.write(`[debug] ${args.join(' ')}\n`);
}

export function createWsServer(
  httpServer: HttpServer | HttpsServer,
  opts: WsServerOptions,
): WebSocketServer {
  const { config, tmuxConfPath, sessionsStorePath } = opts;
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
    handleConnection(ws, req, config, tmuxConfPath, sessionsStorePath);
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
  sessionsStorePath: string,
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

  /** Pending OSC 52 read requests keyed by reqId. Each entry remembers the
   *  OSC 52 selection char ('c'/'p'/…) and the resolved exe path (if any),
   *  so the decision reply knows where to record the grant and which
   *  selection to echo back to the PTY. */
  interface PendingRead {
    selection: string;
    exePath: string | null;
    commandName: string | null;
    /** Populated when the server has already decided to allow and is
     *  awaiting the client's clipboard content for this request. */
    awaitingContent?: boolean;
  }
  const pendingReads = new Map<string, PendingRead>();
  let nextReqId = 0;
  const newReqId = (): string => `r${Date.now().toString(36)}${(nextReqId++).toString(36)}`;

  /** Respond to the PTY for an OSC 52 read. Empty base64 = denied/empty
   *  clipboard (well-formed but no content). */
  const replyToRead = (selection: string, base64: string): void => {
    ptyProcess.write(buildOsc52Response(selection, base64));
  };

  /** Ask the client for the current clipboard contents so we can deliver
   *  them back to the PTY via OSC 52. The reply comes in as a
   *  `{type:'clipboard-read-reply', reqId, base64}` message. */
  const requestClipboardFromClient = (reqId: string): void => {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(frameTTMessage({ clipboardReadRequest: { reqId } }));
  };

  const handleReadRequest = async (selection: string): Promise<void> => {
    // Find who asked so we can gate policy on the exe path.
    const fg = await getForegroundProcess(config.tmuxBin, lastSession);
    const exePath = fg.exePath;
    if (!exePath) {
      // Can't identify the caller — deny silently. Most apps handle an
      // empty reply gracefully (nothing gets pasted).
      debug(config, `OSC 52 read: unknown foreground process, denying`);
      replyToRead(selection, '');
      return;
    }

    const decision = await resolvePolicy(sessionsStorePath, lastSession, exePath, 'read');
    if (decision === 'deny') {
      debug(config, `OSC 52 read: denied by policy for ${exePath}`);
      replyToRead(selection, '');
      return;
    }

    const reqId = newReqId();
    pendingReads.set(reqId, { selection, exePath, commandName: fg.commandName });

    if (decision === 'allow') {
      pendingReads.get(reqId)!.awaitingContent = true;
      requestClipboardFromClient(reqId);
      return;
    }

    // 'prompt' — ask the user, decision reply will drive the rest.
    if (ws.readyState !== WebSocket.OPEN) {
      pendingReads.delete(reqId);
      return;
    }
    ws.send(frameTTMessage({
      clipboardPrompt: {
        reqId,
        exePath,
        commandName: fg.commandName,
      },
    }));
  };

  ptyProcess.onData((data: string) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    const result = processData(data, lastSession);
    for (const msg of result.messages) {
      ws.send(frameTTMessage(msg));
    }
    for (const req of result.readRequests) {
      void handleReadRequest(req.selection);
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
          // After the action completes, refresh the window list. tmux only
          // emits an OSC title change when the *active* window changes, so
          // closing/renaming a non-current window would otherwise leave the
          // client showing a stale tab until the user switched windows.
          void applyWindowAction(lastSession, parsed, config)
            .then(() => sendWindowState(ws, lastSession, config));
          return;
        }
        if (parsed.type === 'session' && typeof parsed.action === 'string') {
          void applySessionAction(lastSession, parsed, config);
          return;
        }
        if (parsed.type === 'clipboard-decision' && typeof parsed.reqId === 'string') {
          const pending = pendingReads.get(parsed.reqId);
          if (!pending) return; // stale / duplicate
          const allow = !!parsed.allow;
          const pinHash = !!parsed.pinHash;
          const expiresAt = (typeof parsed.expiresAt === 'string' || parsed.expiresAt === null)
            ? parsed.expiresAt : null;
          const persist = parsed.persist === true;
          if (persist && pending.exePath) {
            void recordGrant({
              filePath: sessionsStorePath,
              session: lastSession,
              exePath: pending.exePath,
              action: 'read',
              allow,
              expiresAt,
              pinHash,
            }).catch(() => { /* store failure is non-fatal for this request */ });
          }
          if (allow) {
            pending.awaitingContent = true;
            requestClipboardFromClient(parsed.reqId);
          } else {
            pendingReads.delete(parsed.reqId);
            replyToRead(pending.selection, '');
          }
          return;
        }
        if (parsed.type === 'clipboard-read-reply' && typeof parsed.reqId === 'string') {
          const pending = pendingReads.get(parsed.reqId);
          if (!pending || !pending.awaitingContent) return;
          pendingReads.delete(parsed.reqId);
          const base64 = typeof parsed.base64 === 'string' ? parsed.base64 : '';
          // Cap the payload to 1 MiB of base64 so a huge clipboard can't
          // stall the PTY. 1 MiB base64 ≈ 768 KiB raw — plenty for sane use.
          const MAX = 1024 * 1024;
          const clipped = base64.length > MAX ? '' : base64;
          replyToRead(pending.selection, clipped);
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
