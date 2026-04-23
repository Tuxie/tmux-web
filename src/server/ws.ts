import type { Server as BunServer, ServerWebSocket, WebSocketHandler } from 'bun';
import type { ServerConfig, WindowInfo } from '../shared/types.js';
import { processData, frameTTMessage } from './protocol.js';
import { deliverOsc52Reply } from './osc52-reply.js';
import { buildPtyCommand, buildPtyEnv, spawnPty, sanitizeSession, type BunPty } from './pty.js';
import { isAllowed } from './allowlist.js';
import { isAuthorized } from './http.js';
import { isOriginAllowed, logOriginReject } from './origin.js';
import { getForegroundProcess } from './foreground-process.js';
import { resolvePolicy, recordGrant } from './clipboard-policy.js';
import { onDropsChange } from './file-drop.js';
import { routeClientMessage, type WsAction, type PendingRead as RouterPendingRead } from './ws-router.js';
import type { TmuxControl } from './tmux-control.js';

export interface WsServerOptions {
  config: ServerConfig;
  tmuxConfPath: string;
  /** Path to sessions.json; used for reading & writing the per-binary
   *  OSC 52 clipboard policy. */
  sessionsStorePath: string;
  tmuxControl: TmuxControl;
}

/** Per-connection state. Bun stores this on the `ws.data` slot so every
 *  handler (open / message / close) can reach it without closures. */
export interface WsData {
  remoteIp: string;
  initialSession: string;
  cols: number;
  rows: number;
  state: WsConnState;
}

interface WsConnState {
  pty?: BunPty;
  sessionSet?: Set<ServerWebSocket<WsData>>;
  registeredSession: string;
  lastSession: string;
  lastTitle: string;
  pendingReads: Map<string, RouterPendingRead>;
  nextReqId: number;
  unsubscribeDrops?: () => void;
}

const WS_OPEN = 1;

/** Per-`createWsHandlers` instance state. Two test runs that bring up
 *  fresh harnesses in the same process must not share registry entries
 *  — keeping these inside the closure (rather than at module scope)
 *  guarantees that. */
interface WsRegistry {
  /** Counts WS clients per session name. When the count drops to zero
   *  we detach the control client — no live tabs means no need for the
   *  pool to hold a live tmux -C attach on that session. */
  sessionRefs: Map<string, number>;
  /** WS connection registry keyed by session name. Used to fan out
   *  \x00TT notifications driven by tmux %-events. */
  wsClientsBySession: Map<string, Set<ServerWebSocket<WsData>>>;
}

function debug(config: ServerConfig, ...args: unknown[]): void {
  if (config.debug) process.stderr.write(`[debug] ${args.join(' ')}\n`);
}

export interface WsHandlers {
  /** Validate + upgrade. Returns a Response on rejection or `undefined`
   *  when the upgrade succeeded (caller's fetch handler must then return
   *  void to let Bun finish the handshake). */
  upgrade: (req: Request, server: BunServer<WsData>) => Response | undefined;
  websocket: WebSocketHandler<WsData>;
  /** Detaches the tmux-control event subscriptions registered at create
   *  time. Call from a `process.on('exit')` hook or when shutting down
   *  the server. */
  close: () => void;
}

export function createWsHandlers(opts: WsServerOptions): WsHandlers {
  const { config } = opts;
  const reg: WsRegistry = {
    sessionRefs: new Map(),
    wsClientsBySession: new Map(),
  };

  const unsubscribers: Array<() => void> = [];
  unsubscribers.push(opts.tmuxControl.on('sessionsChanged', () => { broadcastSessionRefresh(reg); }));
  unsubscribers.push(opts.tmuxControl.on('sessionRenamed',  () => { broadcastSessionRefresh(reg); }));
  unsubscribers.push(opts.tmuxControl.on('sessionClosed',   () => { broadcastSessionRefresh(reg); }));
  unsubscribers.push(opts.tmuxControl.on('windowAdd', (n) => {
    if (n.session) void broadcastWindowsForSession(reg, n.session, opts);
  }));
  unsubscribers.push(opts.tmuxControl.on('windowClose', (n) => {
    if (n.session) void broadcastWindowsForSession(reg, n.session, opts);
  }));
  unsubscribers.push(opts.tmuxControl.on('windowRenamed', (n) => {
    if (n.session) void broadcastWindowsForSession(reg, n.session, opts);
  }));

  const upgrade = (req: Request, server: BunServer<WsData>): Response | undefined => {
    const remoteIp = server.requestIP(req)?.address || '';
    debug(config, `WS upgrade from ${remoteIp}`);

    if (!config.testMode && !isAllowed(remoteIp, config.allowedIps)) {
      debug(config, `WS upgrade from ${remoteIp} - rejected (IP)`);
      // No HTTP body — match the prior behaviour of `socket.destroy()`
      // (the client sees a closed TCP connection instead of an HTTP
      // status). Bun does not allow us to literally drop without a
      // response, so return a 403 with a `Connection: close` hint.
      return new Response(null, { status: 403, headers: { 'Connection': 'close' } });
    }

    const originHeader = req.headers.get('origin') ?? undefined;
    if (!config.testMode && !isOriginAllowed(originHeader, {
      allowedIps: config.allowedIps,
      allowedOrigins: config.allowedOrigins,
      serverScheme: config.tls ? 'https' : 'http',
      serverPort: config.port,
    })) {
      const origin = originHeader ?? '<none>';
      debug(config, `WS upgrade from ${remoteIp} - rejected (Origin: ${origin})`);
      logOriginReject(origin, remoteIp);
      return new Response('Forbidden', { status: 403 });
    }

    const authHeader = req.headers.get('authorization') ?? undefined;
    if (!isAuthorized(authHeader, config)) {
      debug(config, `WS upgrade from ${remoteIp} - unauthorized`);
      return new Response('Unauthorized', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Basic realm="tmux-web"' },
      });
    }

    const url = new URL(req.url);
    if (!url.pathname.startsWith('/ws')) {
      // Mirror the prior `socket.destroy()` for non-/ws upgrade attempts.
      return new Response(null, { status: 404, headers: { 'Connection': 'close' } });
    }

    const cols = parseInt(url.searchParams.get('cols') || '80');
    const rows = parseInt(url.searchParams.get('rows') || '24');
    const session = sanitizeSession(url.searchParams.get('session') || 'main');

    const data: WsData = {
      remoteIp,
      initialSession: session,
      cols,
      rows,
      state: {
        registeredSession: session,
        lastSession: session,
        lastTitle: '',
        pendingReads: new Map(),
        nextReqId: 0,
      },
    };

    const ok = server.upgrade(req, { data });
    if (!ok) {
      // Not a valid WS handshake — give back a plain 400 so non-WS GETs
      // to /ws don't hang.
      return new Response('Expected WebSocket upgrade', { status: 400 });
    }
    debug(config, `WS upgrade from ${remoteIp} - allowed`);
    return undefined;
  };

  const websocket: WebSocketHandler<WsData> = {
    open(ws) { handleOpen(ws, opts, reg); },
    message(ws, msg) { handleMessage(ws, msg, opts, reg); },
    close(ws) { handleClose(ws, opts, reg); },
  };

  return {
    upgrade,
    websocket,
    close: () => {
      for (const u of unsubscribers) u();
      // Force-kill any live PTY children. Without this, a PTY whose child
      // exited but whose master FD is still open (e.g. tests using
      // /bin/false as `tmuxBin`) keeps `Bun.serve.stop()` blocked.
      for (const set of reg.wsClientsBySession.values()) {
        for (const ws of set) {
          try { ws.data.state.pty?.kill(); } catch { /* best-effort */ }
        }
      }
      reg.wsClientsBySession.clear();
      reg.sessionRefs.clear();
    },
  };
}

function handleOpen(ws: ServerWebSocket<WsData>, opts: WsServerOptions, reg: WsRegistry): void {
  const { config, tmuxConfPath } = opts;
  const { remoteIp, initialSession: session, cols, rows, state } = ws.data;

  debug(config, `WS connected from ${remoteIp} session=${session} cols=${cols} rows=${rows}`);

  const command = buildPtyCommand({ testMode: config.testMode, session, tmuxConfPath, tmuxBin: config.tmuxBin });
  const env = buildPtyEnv();
  const pty = spawnPty({ command, env, cols, rows });
  state.pty = pty;
  debug(config, `PTY spawned for session=${session} cmd=${command.file}`);

  // Register onData *immediately* after spawn — any data the child
  // emits between `spawnPty` and `pty.onData(cb)` would be silently
  // dropped (replaced no-op default). The fake-tmux fixtures intentionally
  // delay 150 ms before emitting trigger bytes, but every microsecond
  // of registry/setup work shaves into that window under suite load.
  pty.onData((data: string) => {
    if (ws.readyState !== WS_OPEN) return;
    const result = processData(data, state.lastSession);
    for (const msg of result.messages) {
      ws.send(frameTTMessage(msg));
    }
    for (const req of result.readRequests) {
      void handleReadRequest(ws, req.selection, opts);
    }
    if (result.output) ws.send(result.output);
    if (result.titleChanged && result.detectedTitle !== state.lastTitle) {
      state.lastTitle = result.detectedTitle || '';
      if (result.detectedSession) state.lastSession = result.detectedSession;
      void sendWindowState(ws, state.lastSession, opts);
    }
  });

  if (!config.testMode) {
    // Pass the WS's cols/rows so the control client's `refresh-client -C`
    // mirrors the sibling PTY client's size — otherwise tmux's
    // `window-size latest` policy briefly resizes the layout to the
    // control client's size and then snaps back when the PTY client's
    // size arrives, which the user sees as a flash + redraw on attach.
    void opts.tmuxControl.attachSession(session, { cols, rows })
      .then(() => sendWindowState(ws, state.lastSession, opts))
      .catch((err) => {
        debug(config, `attachSession(${session}) failed: ${(err as Error).message}`);
      });
  }
  reg.sessionRefs.set(session, (reg.sessionRefs.get(session) ?? 0) + 1);
  let sessionSet = reg.wsClientsBySession.get(session);
  if (!sessionSet) { sessionSet = new Set(); reg.wsClientsBySession.set(session, sessionSet); }
  sessionSet.add(ws);
  state.sessionSet = sessionSet;

  // Forward drop-list mutations (new drop, auto-unlink on close, TTL
  // sweep, revoke, purge) to this client. Drops are a per-user pool
  // (not partitioned by tmux session) so every attached client sees
  // every change. Unsubscribed on ws close below.
  state.unsubscribeDrops = onDropsChange(() => {
    if (ws.readyState !== WS_OPEN) return;
    ws.send(frameTTMessage({ dropsChanged: true }));
  });

  pty.onExit(() => {
    // Don't initiate a server-side `ws.close()` from inside the spawn's
    // exit-promise resolution. Bun 1.3.13 has a bug where doing so leaves
    // `Bun.serve.stop()` blocked on shutdown for ~3 s, which cascades into
    // flaky tests and slow restarts. Notify the client via a TT sentinel
    // so the browser side can drive the close itself; if the client never
    // sees it, the next inbound packet will fail and the WS will close
    // through the regular browser path.
    if (ws.readyState === WS_OPEN) {
      try { ws.send(frameTTMessage({ ptyExit: true })); } catch { /* ws gone */ }
    }
  });
}

function handleMessage(ws: ServerWebSocket<WsData>, msg: string | Buffer, opts: WsServerOptions, reg: WsRegistry): void {
  const text = typeof msg === 'string' ? msg : Buffer.from(msg).toString('utf8');
  const actions = routeClientMessage(text, {
    currentSession: ws.data.state.lastSession,
    pendingReads: ws.data.state.pendingReads,
  });
  for (const act of actions) dispatchAction(ws, act, opts, reg);
}

function handleClose(ws: ServerWebSocket<WsData>, opts: WsServerOptions, reg: WsRegistry): void {
  const { config } = opts;
  const { remoteIp, state } = ws.data;
  const session = state.registeredSession;
  debug(config, `WS closed from ${remoteIp} session=${session}`);
  state.unsubscribeDrops?.();
  state.sessionSet?.delete(ws);
  if (state.sessionSet && state.sessionSet.size === 0) reg.wsClientsBySession.delete(session);
  const next = (reg.sessionRefs.get(session) ?? 1) - 1;
  if (next <= 0) {
    reg.sessionRefs.delete(session);
    if (!config.testMode) opts.tmuxControl.detachSession(session);
  } else {
    reg.sessionRefs.set(session, next);
  }
  state.pty?.kill();
}

function nextReqId(state: WsConnState): string {
  return `r${Date.now().toString(36)}${(state.nextReqId++).toString(36)}`;
}

/** Respond to the PTY for an OSC 52 read. Empty base64 = denied/empty
 *  clipboard (well-formed but no content).
 *
 *  Bytes can't just be written to the tmux-client PTY: tmux parses its
 *  client-keyboard channel as an outer-terminal reply stream and drops
 *  an OSC 52 WRITE that doesn't match a pending query. Inject directly
 *  into the focused pane's stdin via `tmux send-keys -H <hex bytes>`. */
async function replyToRead(
  ws: ServerWebSocket<WsData>,
  selection: string,
  base64: string,
  opts: WsServerOptions,
): Promise<void> {
  const { config } = opts;
  const { state } = ws.data;
  try {
    await deliverOsc52Reply({
      run: opts.tmuxControl.run,
      target: state.lastSession,
      selection,
      base64,
      directWrite: config.testMode ? (bytes) => state.pty?.write(bytes) : undefined,
    });
  } catch (err) {
    debug(config, `OSC 52 reply delivery failed: ${err}`);
  }
}

/** Ask the client for the current clipboard contents so we can deliver
 *  them back to the PTY via OSC 52. The reply comes in as a
 *  `{type:'clipboard-read-reply', reqId, base64}` message. */
function requestClipboardFromClient(ws: ServerWebSocket<WsData>, reqId: string): void {
  if (ws.readyState !== WS_OPEN) return;
  ws.send(frameTTMessage({ clipboardReadRequest: { reqId } }));
}

async function handleReadRequest(
  ws: ServerWebSocket<WsData>,
  selection: string,
  opts: WsServerOptions,
): Promise<void> {
  const { config, sessionsStorePath } = opts;
  const { state } = ws.data;
  // Find who asked so we can gate policy on the exe path.
  const fg = await getForegroundProcess(opts.tmuxControl.run, state.lastSession);
  const exePath = fg.exePath;
  if (!exePath) {
    // Can't identify the caller — deny silently. Most apps handle an
    // empty reply gracefully (nothing gets pasted).
    debug(config, `OSC 52 read: unknown foreground process, denying`);
    void replyToRead(ws, selection, '', opts);
    return;
  }

  const decision = await resolvePolicy(sessionsStorePath, state.lastSession, exePath, 'read');
  if (decision === 'deny') {
    debug(config, `OSC 52 read: denied by policy for ${exePath}`);
    void replyToRead(ws, selection, '', opts);
    return;
  }

  const reqId = nextReqId(state);
  state.pendingReads.set(reqId, { selection, exePath, commandName: fg.commandName });

  if (decision === 'allow') {
    state.pendingReads.get(reqId)!.awaitingContent = true;
    requestClipboardFromClient(ws, reqId);
    return;
  }

  // 'prompt' — ask the user, decision reply will drive the rest.
  if (ws.readyState !== WS_OPEN) {
    state.pendingReads.delete(reqId);
    return;
  }
  ws.send(frameTTMessage({
    clipboardPrompt: {
      reqId,
      exePath,
      commandName: fg.commandName,
    },
  }));
}

function dispatchAction(ws: ServerWebSocket<WsData>, act: WsAction, opts: WsServerOptions, reg: WsRegistry): void {
  const { state } = ws.data;
  switch (act.type) {
    case 'pty-write': state.pty?.write(act.data); return;
    case 'pty-resize': state.pty?.resize(act.cols, act.rows); return;
    case 'colour-variant': void applyColourVariant(state.lastSession, act.variant, opts); return;
    case 'switch-session':
      void switchSession(ws, act.name, opts, reg);
      return;
    case 'window':
      // After the action completes, refresh the window list. tmux only
      // emits an OSC title change when the *active* window changes, so
      // closing/renaming a non-current window would otherwise leave the
      // client showing a stale tab until the user switched windows.
      void applyWindowAction(state.lastSession, { action: act.action, index: act.index, name: act.name }, opts)
        .then(() => sendWindowState(ws, state.lastSession, opts));
      return;
    case 'session':
      void applySessionAction(state.lastSession, { action: act.action, name: act.name }, opts);
      return;
    case 'clipboard-deny':
      void replyToRead(ws, act.selection, '', opts);
      return;
    case 'clipboard-grant-persist':
      void recordGrant({
        filePath: opts.sessionsStorePath,
        session: state.lastSession,
        exePath: act.exePath,
        action: 'read',
        allow: act.allow,
        expiresAt: act.expiresAt,
        pinHash: act.pinHash,
      }).catch(() => { /* store failure is non-fatal for this request */ });
      return;
    case 'clipboard-request-content': requestClipboardFromClient(ws, act.reqId); return;
    case 'clipboard-reply': void replyToRead(ws, act.selection, act.base64, opts); return;
  }
}

function moveWsToSession(
  ws: ServerWebSocket<WsData>,
  oldSession: string,
  newSession: string,
  opts: WsServerOptions,
  reg: WsRegistry,
): void {
  const { state } = ws.data;
  state.sessionSet?.delete(ws);
  if (state.sessionSet && state.sessionSet.size === 0) reg.wsClientsBySession.delete(oldSession);

  const oldRefs = (reg.sessionRefs.get(oldSession) ?? 1) - 1;
  if (oldRefs <= 0) {
    reg.sessionRefs.delete(oldSession);
    if (!opts.config.testMode) opts.tmuxControl.detachSession(oldSession);
  } else {
    reg.sessionRefs.set(oldSession, oldRefs);
  }

  reg.sessionRefs.set(newSession, (reg.sessionRefs.get(newSession) ?? 0) + 1);
  let newSet = reg.wsClientsBySession.get(newSession);
  if (!newSet) {
    newSet = new Set();
    reg.wsClientsBySession.set(newSession, newSet);
  }
  newSet.add(ws);
  state.sessionSet = newSet;
  state.registeredSession = newSession;
  state.lastSession = newSession;
}

async function tmuxClientForPty(pty: BunPty | undefined, opts: WsServerOptions): Promise<string | null> {
  if (!pty) return null;
  const out = await opts.tmuxControl.run([
    'list-clients',
    '-F',
    '#{client_pid}\t#{client_tty}\t#{client_name}',
  ]);
  const candidates: string[] = [];
  for (const line of out.split('\n')) {
    if (!line) continue;
    const [pid, tty, name] = line.split('\t');
    const candidate = tty || name || null;
    if (candidate) candidates.push(candidate);
    if (Number(pid) !== pty.pid) continue;
    return candidate;
  }
  if (candidates.length === 1) return candidates[0]!;
  return null;
}

async function switchSession(
  ws: ServerWebSocket<WsData>,
  rawName: string,
  opts: WsServerOptions,
  reg: WsRegistry,
): Promise<void> {
  const { state } = ws.data;
  const oldSession = state.registeredSession;
  const newSession = sanitizeSession(rawName);
  if (newSession === oldSession) {
    await sendWindowState(ws, newSession, opts);
    return;
  }

  moveWsToSession(ws, oldSession, newSession, opts, reg);
  if (opts.config.testMode) {
    await sendWindowState(ws, newSession, opts);
    return;
  }

  try {
    await opts.tmuxControl.attachSession(newSession, { cols: ws.data.cols, rows: ws.data.rows });
    const client = await tmuxClientForPty(state.pty, opts);
    if (!client) {
      debug(opts.config, `switch-session(${newSession}) failed: PTY tmux client not found`);
      return;
    }
    await opts.tmuxControl.run(['switch-client', '-c', client, '-t', newSession]);
    await sendWindowState(ws, newSession, opts);
  } catch (err) {
    debug(opts.config, `switch-session(${newSession}) failed: ${(err as Error).message}`);
  }
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
  opts: WsServerOptions,
): Promise<void> {
  if (opts.config.testMode) return;
  try {
    switch (msg.action) {
      case 'rename':
        if (typeof msg.name !== 'string' || !isSafeTmuxName(msg.name)) return;
        await opts.tmuxControl.run(['rename-session', '-t', sessionName, '--', msg.name.trim()]);
        break;
      case 'kill':
        await opts.tmuxControl.run(['kill-session', '-t', sessionName]);
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
  opts: WsServerOptions,
): Promise<void> {
  if (opts.config.testMode) return;
  const target = typeof msg.index === 'string' ? `${sessionName}:${msg.index}` : sessionName;
  try {
    switch (msg.action) {
      case 'select':
        if (typeof msg.index !== 'string') return;
        await opts.tmuxControl.run(['select-window', '-t', target]);
        break;
      case 'new': {
        const args = ['new-window', '-t', sessionName];
        if (typeof msg.name === 'string' && isSafeTmuxName(msg.name)) {
          args.push('-n', msg.name.trim());
        }
        await opts.tmuxControl.run(args);
        break;
      }
      case 'close':
        if (typeof msg.index !== 'string') return;
        await opts.tmuxControl.run(['kill-window', '-t', target]);
        break;
      case 'rename':
        if (typeof msg.index !== 'string' || typeof msg.name !== 'string') return;
        if (!isSafeTmuxName(msg.name)) return;
        await opts.tmuxControl.run(['rename-window', '-t', target, '--', msg.name.trim()]);
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
  opts: WsServerOptions,
): Promise<void> {
  if (opts.config.testMode) return;
  const colorFgBg = variant === 'dark' ? '15;0' : '0;15';
  const run = () => Promise.all([
    opts.tmuxControl.run(['set-environment', '-t', sessionName, 'COLORFGBG', colorFgBg]),
    opts.tmuxControl.run(['set-environment', '-t', sessionName, 'CLITHEME', variant]),
  ]);
  try {
    await run();
  } catch {
    setTimeout(() => { run().catch(() => {}); }, 500);
  }
}

async function sendWindowState(ws: ServerWebSocket<WsData>, sessionName: string, opts: WsServerOptions): Promise<void> {
  try {
    // Tab-separated fields — window names can contain any Unicode code
    // point including `:`, so `\t` is the unambiguous separator (tmux
    // window names cannot contain `\t`).
    const [winResult, titleResult] = await Promise.allSettled([
      opts.tmuxControl.run([
        'list-windows', '-t', sessionName, '-F', '#{window_index}\t#{window_name}\t#{window_active}',
      ]),
      opts.tmuxControl.run([
        'display-message', '-t', sessionName, '-p', '#{pane_title}',
      ]),
    ]);
    const windows: WindowInfo[] = winResult.status === 'fulfilled'
      ? winResult.value.trim().split('\n').filter(Boolean).map(line => {
          const [index, name, active] = line.split('\t');
          return { index: index!, name: name!, active: active === '1' };
        })
      : [];
    const title = titleResult.status === 'fulfilled'
      ? titleResult.value.trim()
      : undefined;
    if (ws.readyState === WS_OPEN) {
      ws.send(frameTTMessage({ session: sessionName, windows, title }));
    }
  } catch {
    if (ws.readyState === WS_OPEN) {
      ws.send(frameTTMessage({ session: sessionName }));
    }
  }
}

/** Fire a {session: name} push to every connected WS client. The client's
 *  on-session handler re-fetches /api/sessions and /api/windows, so this
 *  push is just a "refresh your session list" signal. */
function broadcastSessionRefresh(reg: WsRegistry): void {
  if (reg.wsClientsBySession.size === 0) return;
  for (const [sessionName, clients] of reg.wsClientsBySession) {
    for (const ws of clients) {
      if (ws.readyState !== WS_OPEN) continue;
      ws.send(frameTTMessage({ session: sessionName }));
    }
  }
}

async function broadcastWindowsForSession(
  reg: WsRegistry,
  sessionName: string,
  opts: WsServerOptions,
): Promise<void> {
  const clients = reg.wsClientsBySession.get(sessionName);
  if (!clients || clients.size === 0) return;
  try {
    const stdout = await opts.tmuxControl.run([
      'list-windows', '-t', sessionName, '-F',
      '#{window_index}\t#{window_name}\t#{window_active}',
    ]);
    const windows: WindowInfo[] = stdout.split('\n').filter(Boolean).map(line => {
      const [index, name, active] = line.split('\t');
      return { index: index!, name: name!, active: active === '1' };
    });
    for (const ws of clients) {
      if (ws.readyState !== WS_OPEN) continue;
      ws.send(frameTTMessage({ session: sessionName, windows }));
    }
  } catch { /* non-fatal — command might fail while session dying */ }
}
