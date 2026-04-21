import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type { Server as HttpServer } from 'http';
import type { Server as HttpsServer } from 'https';
import type { Duplex } from 'stream';
import type { ServerConfig, WindowInfo } from '../shared/types.js';
import { processData, frameTTMessage } from './protocol.js';
import { deliverOsc52Reply } from './osc52-reply.js';
import { buildPtyCommand, buildPtyEnv, spawnPty, sanitizeSession } from './pty.js';
import { isAllowed } from './allowlist.js';
import { isAuthorized } from './http.js';
import { isOriginAllowed, logOriginReject } from './origin.js';
import { getForegroundProcess } from './foreground-process.js';
import { resolvePolicy, recordGrant } from './clipboard-policy.js';
import { onDropsChange } from './file-drop.js';
import { execFileAsync } from './exec.js';
import { routeClientMessage, type WsAction, type PendingRead as RouterPendingRead } from './ws-router.js';

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

/**
 * Send a short HTTP error response on a raw upgrade socket and close it.
 *
 * Under Bun's Node.js compat layer, `socket.write()` followed immediately by
 * `socket.destroy()` drops the bytes — and `socket.end(payload)` also silently
 * discards the payload in the upgrade context. The only path that reliably
 * flushes is to use the underlying Bun response object exposed via the
 * `::bunternal::` symbol. We prefer that path when available and fall back to
 * `socket.write() + socket.destroy()` (which works on plain Node.js).
 */
function rejectUpgradeSocket(
  socket: Duplex,
  statusCode: number,
  statusText: string,
  extraHeaders: Record<string, string> = {},
): void {
  const native = (socket as any)[Symbol.for('::bunternal::')];
  if (native && typeof native.writeHead === 'function') {
    native.writeHead(statusCode, statusText, {
      'Content-Length': '0',
      'Connection': 'close',
      ...extraHeaders,
    });
    native.end('');
    return;
  }
  // Plain Node.js: socket.write() flushes synchronously before destroy().
  const lines = [
    `HTTP/1.1 ${statusCode} ${statusText}`,
    'Content-Length: 0',
    'Connection: close',
    ...Object.entries(extraHeaders).map(([k, v]) => `${k}: ${v}`),
  ];
  socket.write(lines.join('\r\n') + '\r\n\r\n');
  socket.destroy();
}

export function createWsServer(
  httpServer: HttpServer | HttpsServer,
  opts: WsServerOptions,
): WebSocketServer {
  const { config, tmuxConfPath, sessionsStorePath } = opts;
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    // safe: Duplex does not declare remoteAddress but the underlying socket does; see https://nodejs.org/api/net.html#socketremoteaddress
    const remoteIp = (socket as any).remoteAddress || '';
    debug(config, `WS upgrade from ${remoteIp}`);
    if (!config.testMode && !isAllowed(remoteIp, config.allowedIps)) {
      debug(config, `WS upgrade from ${remoteIp} - rejected (IP)`);
      socket.destroy();
      return;
    }

    if (!config.testMode && !isOriginAllowed(req, {
      allowedIps: config.allowedIps,
      allowedOrigins: config.allowedOrigins,
      serverScheme: config.tls ? 'https' : 'http',
      serverPort: config.port,
    })) {
      const origin = req.headers.origin ?? '<none>';
      debug(config, `WS upgrade from ${remoteIp} - rejected (Origin: ${origin})`);
      logOriginReject(origin, remoteIp);
      rejectUpgradeSocket(socket, 403, 'Forbidden');
      return;
    }

    if (!isAuthorized(req, config)) {
      debug(config, `WS upgrade from ${remoteIp} - unauthorized`);
      rejectUpgradeSocket(socket, 401, 'Unauthorized', {
        'WWW-Authenticate': 'Basic realm="tmux-web"',
      });
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
/** tmux treats a leading `-` as an option even at positional slots, and
 *  `:` / `.` are interpreted as session/window separators. Reject those
 *  shapes up-front so the server error (not tmux's parser) surfaces the
 *  problem and an empty name or literal `-foo` can't reach tmux. */
function isSafeTmuxName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('-')) return false;
  if (trimmed.includes(':') || trimmed.includes('.')) return false;
  return true;
}

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
        if (typeof msg.name !== 'string' || !isSafeTmuxName(msg.name)) return;
        await execFileAsync(bin, ['rename-session', '-t', sessionName, '--', msg.name.trim()]);
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
        if (typeof msg.name === 'string' && isSafeTmuxName(msg.name)) {
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
        if (!isSafeTmuxName(msg.name)) return;
        await execFileAsync(bin, ['rename-window', '-t', target, '--', msg.name.trim()]);
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
  // safe: Duplex does not declare remoteAddress but the underlying socket does; see https://nodejs.org/api/net.html#socketremoteaddress
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

  /** Pending OSC 52 read requests keyed by reqId. See `ws-router.ts`
   *  for the shape; shared with the pure router so the dispatcher and
   *  the read-request path see the same Map. */
  const pendingReads = new Map<string, RouterPendingRead>();
  let nextReqId = 0;
  const newReqId = (): string => `r${Date.now().toString(36)}${(nextReqId++).toString(36)}`;

  // Forward drop-list mutations (new drop, auto-unlink on close, TTL
  // sweep, revoke, purge) to this client. Drops are a per-user pool
  // (not partitioned by tmux session) so every attached client sees
  // every change. Unsubscribed on ws close below.
  const unsubscribeDrops = onDropsChange(() => {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(frameTTMessage({ dropsChanged: true }));
  });

  /** Respond to the PTY for an OSC 52 read. Empty base64 = denied/empty
   *  clipboard (well-formed but no content).
   *
   *  Bytes can't just be written to the tmux-client PTY: tmux parses its
   *  client-keyboard channel as an outer-terminal reply stream and drops
   *  an OSC 52 WRITE that doesn't match a pending query. Inject directly
   *  into the focused pane's stdin via `tmux send-keys -H <hex bytes>`. */
  const replyToRead = async (selection: string, base64: string): Promise<void> => {
    try {
      await deliverOsc52Reply({
        tmuxBin: config.tmuxBin,
        target: lastSession,
        selection,
        base64,
        directWrite: config.testMode ? (bytes) => ptyProcess.write(bytes) : undefined,
      });
    } catch (err) {
      debug(config, `OSC 52 reply delivery failed: ${err}`);
    }
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
      void replyToRead(selection, '');
      return;
    }

    const decision = await resolvePolicy(sessionsStorePath, lastSession, exePath, 'read');
    if (decision === 'deny') {
      debug(config, `OSC 52 read: denied by policy for ${exePath}`);
      void replyToRead(selection, '');
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
      void sendWindowState(ws, lastSession, config);
    }
  });

  ptyProcess.onExit(() => {
    if (ws.readyState === WebSocket.OPEN) ws.close();
  });

  const dispatchAction = (act: WsAction): void => {
    switch (act.type) {
      case 'pty-write': ptyProcess.write(act.data); return;
      case 'pty-resize': ptyProcess.resize(act.cols, act.rows); return;
      case 'colour-variant': void applyColourVariant(lastSession, act.variant, config); return;
      case 'window':
        // After the action completes, refresh the window list. tmux only
        // emits an OSC title change when the *active* window changes, so
        // closing/renaming a non-current window would otherwise leave the
        // client showing a stale tab until the user switched windows.
        void applyWindowAction(lastSession, { action: act.action, index: act.index, name: act.name }, config)
          .then(() => sendWindowState(ws, lastSession, config));
        return;
      case 'session':
        void applySessionAction(lastSession, { action: act.action, name: act.name }, config);
        return;
      case 'clipboard-deny':
        void replyToRead(act.selection, '');
        return;
      case 'clipboard-grant-persist':
        void recordGrant({
          filePath: sessionsStorePath,
          session: lastSession,
          exePath: act.exePath,
          action: 'read',
          allow: act.allow,
          expiresAt: act.expiresAt,
          pinHash: act.pinHash,
        }).catch(() => { /* store failure is non-fatal for this request */ });
        return;
      case 'clipboard-request-content': requestClipboardFromClient(act.reqId); return;
      case 'clipboard-reply': void replyToRead(act.selection, act.base64); return;
    }
  };

  ws.on('message', (data) => {
    const msg = data.toString('utf8');
    const actions = routeClientMessage(msg, { currentSession: lastSession, pendingReads });
    for (const act of actions) dispatchAction(act);
  });

  ws.on('close', () => {
    debug(config, `WS closed from ${remoteIp} session=${session}`);
    unsubscribeDrops();
    ptyProcess.kill();
  });
  ws.on('error', () => {});
}
