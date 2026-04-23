/* tmux control-mode (`tmux -C`) client pool: parser, per-session
 * ControlClient, oldest-alive primary election, serial command queue,
 * notification dispatch. Consumed by http.ts / ws.ts / foreground-process.ts
 * / tmux-inject.ts / osc52-reply.ts to replace execFileAsync fork-per-op. */

export type RunCmd = (args: readonly string[]) => Promise<string>;

export type TmuxNotification =
  | { type: 'sessionsChanged' }
  | { type: 'sessionRenamed'; id: string; name: string }
  | { type: 'sessionClosed'; id: string }
  | { type: 'windowAdd'; window: string }
  | { type: 'windowClose'; window: string }
  | { type: 'windowRenamed'; window: string; name: string };

export class TmuxCommandError extends Error {
  constructor(
    public args: readonly string[],
    public stderr: string,
    public exitCode?: number,
  ) { super(stderr); this.name = 'TmuxCommandError'; }
}

export class NoControlClientError extends Error {
  constructor() { super('no control client available'); this.name = 'NoControlClientError'; }
}

export interface ParserCallbacks {
  onResponse: (cmdnum: number, output: string) => void;
  onError: (cmdnum: number, stderr: string) => void;
  onNotification: (n: TmuxNotification) => void;
}

export class ControlParser {
  private buf = '';
  private inEnvelope: { cmdnum: number; lines: string[] } | null = null;

  constructor(private cb: ParserCallbacks) {}

  push(chunk: string): void {
    this.buf += chunk;
    let nl: number;
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      this.consumeLine(line);
    }
  }

  private consumeLine(line: string): void {
    if (this.inEnvelope) {
      if (line.startsWith('%end ')) {
        const parts = line.split(' ');
        const cmdnum = Number(parts[2]);
        this.cb.onResponse(cmdnum, this.inEnvelope.lines.join('\n'));
        this.inEnvelope = null;
        return;
      }
      if (line.startsWith('%error ')) {
        const parts = line.split(' ');
        const cmdnum = Number(parts[2]);
        this.cb.onError(cmdnum, this.inEnvelope.lines.join('\n'));
        this.inEnvelope = null;
        return;
      }
      this.inEnvelope.lines.push(line);
      return;
    }
    if (line.startsWith('%begin ')) {
      const parts = line.split(' ');
      this.inEnvelope = { cmdnum: Number(parts[2]), lines: [] };
      return;
    }
    // Outside an envelope: notification or unknown line.
    if (!line.startsWith('%')) return;
    const note = parseNotification(line);
    if (note) this.cb.onNotification(note);
  }
}

/** Parse a standalone tmux control-mode notification line into a
 *  TmuxNotification. Returns null for recognised-but-ignored events
 *  (%output, %client-session-changed, %layout-change, …) and for
 *  unknown event names. */
export function parseNotification(line: string): TmuxNotification | null {
  // Quick escape for %output — the highest-volume notification and the
  // one we explicitly discard (B does not consume control-mode output).
  if (line.startsWith('%output ')) return null;
  const sp = line.indexOf(' ');
  const head = sp >= 0 ? line.slice(0, sp) : line;
  const rest = sp >= 0 ? line.slice(sp + 1) : '';
  switch (head) {
    case '%sessions-changed':
      return { type: 'sessionsChanged' };
    case '%session-renamed': {
      const sp2 = rest.indexOf(' ');
      if (sp2 < 0) return null;
      return { type: 'sessionRenamed', id: rest.slice(0, sp2), name: rest.slice(sp2 + 1) };
    }
    case '%session-closed':
      return { type: 'sessionClosed', id: rest.trim() };
    case '%window-add':
      return { type: 'windowAdd', window: rest.trim() };
    case '%window-close':
      return { type: 'windowClose', window: rest.trim() };
    case '%window-renamed': {
      const sp2 = rest.indexOf(' ');
      if (sp2 < 0) return null;
      return { type: 'windowRenamed', window: rest.slice(0, sp2), name: rest.slice(sp2 + 1) };
    }
    default:
      return null;
  }
}

export interface TmuxControl {
  attachSession(session: string): Promise<void>;
  detachSession(session: string): void;
  run: RunCmd;
  on<T extends TmuxNotification['type']>(
    event: T,
    cb: (n: Extract<TmuxNotification, { type: T }>) => void,
  ): () => void;
  close(): Promise<void>;
}

/** Minimum shape of the spawned tmux -C child process that ControlClient
 *  needs. Matches the subset of `Bun.spawn` + Node child-process streams
 *  we actually touch, so tests can inject a plain object. */
export interface ControlProc {
  stdin: { write(data: string): unknown; end(): unknown };
  stdout: { on(event: 'data', cb: (chunk: Buffer | string) => void): unknown };
  exited: Promise<unknown>;
  kill(): unknown;
}

interface Pending {
  cmdnum: number;
  args: readonly string[];
  resolve: (stdout: string) => void;
  reject: (err: unknown) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

const DEFAULT_COMMAND_TIMEOUT_MS = 5_000;

/** Tmux command-line tokenizer treats whitespace as an argument
 *  separator, so any arg containing a tab/space/newline (e.g. the
 *  TAB-separated `list-windows -F` format string used by ws.ts) must
 *  be quoted. Tmux supports double-quoted strings with backslash
 *  escapes; wrap unconditionally for any arg that needs it. */
export function quoteTmuxArg(arg: string): string {
  // Bare tokens with no whitespace, no quotes, no backslashes,
  // and no $ / # / ; (which tmux interprets) pass through.
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(arg)) return arg;
  return '"' + arg.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$') + '"';
}

export interface ControlClientOpts {
  /** Override the per-command soft timeout. Default 5 s. Tests use
   *  short values to exercise the timeout path without wall-clock wait. */
  commandTimeoutMs?: number;
}

export class ControlClient {
  private parser: ControlParser;
  private nextCmdnum = 1;
  /** Head of the FIFO = in-flight; rest = backlog. */
  private queue: Pending[] = [];
  private alive = true;
  private readonly notifyCb: (n: TmuxNotification) => void;
  private readonly commandTimeoutMs: number;

  constructor(
    private proc: ControlProc,
    onNotification: (n: TmuxNotification) => void = () => {},
    opts: ControlClientOpts = {},
  ) {
    this.notifyCb = onNotification;
    this.commandTimeoutMs = opts.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    this.parser = new ControlParser({
      onResponse: (cmdnum, output) => this.handleResponse(cmdnum, output),
      onError: (cmdnum, stderr) => this.handleError(cmdnum, stderr),
      onNotification: (n) => this.notifyCb(n),
    });
    proc.stdout.on('data', (chunk: Buffer | string) => {
      const s = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      this.parser.push(s);
    });
    void proc.exited.then(() => this.onExit());
  }

  run(args: readonly string[]): Promise<string> {
    if (!this.alive) return Promise.reject(new TmuxCommandError(args, 'control client exited'));
    return new Promise((resolve, reject) => {
      const pending: Pending = {
        cmdnum: this.nextCmdnum++,
        args, resolve, reject,
        timer: null,
      };
      this.queue.push(pending);
      if (this.queue.length === 1) this.dispatch();
    });
  }

  private dispatch(): void {
    const head = this.queue[0];
    if (!head) return;
    this.proc.stdin.write(head.args.map(quoteTmuxArg).join(' ') + '\n');
    head.timer = setTimeout(() => this.handleTimeout(head.cmdnum), this.commandTimeoutMs);
  }

  private handleResponse(cmdnum: number, output: string): void {
    const head = this.queue[0];
    if (!head) return;
    if (head.cmdnum !== cmdnum) {
      // Stale response for a force-advanced cmdnum (timeout). Drop
      // silently. Spec §4.2's "protocol desync → tear down primary"
      // branch is deferred to Task 3 so the soft-timeout path can't
      // kill a live primary just because a slow tmux finally answered.
      return;
    }
    if (head.timer) clearTimeout(head.timer);
    this.queue.shift();
    head.resolve(output);
    this.dispatch();
  }

  private handleError(cmdnum: number, stderr: string): void {
    const head = this.queue[0];
    if (!head) return;
    // Same rationale as in handleResponse: stale %error for a
    // force-advanced cmdnum is dropped silently (desync tear-down
    // deferred to Task 3).
    if (head.cmdnum !== cmdnum) return;
    if (head.timer) clearTimeout(head.timer);
    this.queue.shift();
    head.reject(new TmuxCommandError(head.args, stderr));
    this.dispatch();
  }

  private handleTimeout(cmdnum: number): void {
    const head = this.queue[0];
    if (!head || head.cmdnum !== cmdnum) return;
    // Soft timeout: advance the queue but do NOT tear down the client.
    // A late %end/%error will be ignored via the cmdnum mismatch guard.
    this.queue.shift();
    head.reject(new TmuxCommandError(head.args, 'timeout'));
    this.dispatch();
  }

  private onExit(): void {
    if (!this.alive) return;
    this.alive = false;
    const queued = this.queue.splice(0);
    for (const p of queued) {
      if (p.timer) clearTimeout(p.timer);
      p.reject(new TmuxCommandError(p.args, 'control client exited'));
    }
  }

  kill(): void {
    this.proc.kill();
  }

  isAlive(): boolean { return this.alive; }
}

export interface ControlPoolOpts {
  /** Spawn a tmux -C control-mode child for the given session. Returns
   *  the proc-like handle ControlClient wraps. Injectable for tests. */
  spawn: (session: string) => ControlProc;
}

export class ControlPool implements TmuxControl {
  private clients = new Map<string, ControlClient>();
  private insertionOrder: ControlClient[] = [];
  private readyPromises = new Map<string, Promise<void>>();
  private listeners: { [K in TmuxNotification['type']]: Array<(n: any) => void> } = {
    sessionsChanged: [], sessionRenamed: [], sessionClosed: [],
    windowAdd: [], windowClose: [], windowRenamed: [],
  };

  constructor(private opts: ControlPoolOpts) {}

  attachSession(session: string): Promise<void> {
    const existing = this.readyPromises.get(session);
    if (existing) return existing;
    const ready = this.startSession(session);
    this.readyPromises.set(session, ready);
    ready.catch(() => this.readyPromises.delete(session));
    return ready;
  }

  private async startSession(session: string): Promise<void> {
    const proc = this.opts.spawn(session);
    // Forward-reference: the notification callback captures `client`. Safe
    // because stdout 'data' is async; `client` is always bound when it fires.
    const client = new ControlClient(proc, (n) => this.onNotification(client, n));
    // Guard: detachSession called before probe resolves must not leak the
    // child. Check cancellation after each await and kill the client if so.
    const wasCancelled = () => this.readyPromises.get(session) === undefined;
    // Size-negotiation guard (§3.5). Swallow errors — older tmux without
    // -C WxH for refresh-client falls back to window-size latest.
    try { await client.run(['refresh-client', '-C', '10000x10000']); } catch { /* best-effort */ }
    if (wasCancelled()) { client.kill(); return; }
    // Readiness probe. If it fails, the client is dead/unusable; propagate.
    await client.run(['display-message', '-p', 'ok']);
    if (wasCancelled()) { client.kill(); return; }
    this.clients.set(session, client);
    this.insertionOrder.push(client);
    // When the process exits unexpectedly, evict it from the pool so that
    // the next-oldest entry can promote to primary.
    void proc.exited.then(() => this.evictClient(client, session));
  }

  private evictClient(client: ControlClient, session: string): void {
    // Remove from insertionOrder (primary promotion happens automatically
    // since insertionOrder[0] is checked at notification-dispatch time).
    const idx = this.insertionOrder.indexOf(client);
    if (idx >= 0) this.insertionOrder.splice(idx, 1);
    // Remove from clients map only if this client is still the one tracked
    // for this session (detachSession may have already replaced it).
    if (this.clients.get(session) === client) {
      this.clients.delete(session);
      this.readyPromises.delete(session);
    }
  }

  detachSession(session: string): void {
    const client = this.clients.get(session);
    if (!client) { this.readyPromises.delete(session); return; }
    this.clients.delete(session);
    const idx = this.insertionOrder.indexOf(client);
    if (idx >= 0) this.insertionOrder.splice(idx, 1);
    this.readyPromises.delete(session);
    client.kill();
  }

  run = (args: readonly string[]): Promise<string> => {
    const primary = this.insertionOrder[0];
    if (!primary) return Promise.reject(new NoControlClientError());
    return primary.run(args);
  };

  on<T extends TmuxNotification['type']>(
    event: T,
    cb: (n: Extract<TmuxNotification, { type: T }>) => void,
  ): () => void {
    (this.listeners[event] as Array<(n: Extract<TmuxNotification, { type: T }>) => void>).push(cb);
    return () => {
      const arr = this.listeners[event];
      const idx = (arr as any).indexOf(cb);
      if (idx >= 0) (arr as any).splice(idx, 1);
    };
  }

  async close(): Promise<void> {
    for (const c of this.insertionOrder.splice(0)) c.kill();
    this.clients.clear();
    this.readyPromises.clear();
  }

  private onNotification(from: ControlClient, n: TmuxNotification): void {
    // Only the primary's notifications are fanned out; others are
    // parsed-and-dropped to avoid N-copies of each global event.
    if (this.insertionOrder[0] !== from) return;
    const subs = this.listeners[n.type] as Array<(n: any) => void>;
    for (const cb of subs) cb(n);
  }
}

export interface CreateTmuxControlOpts {
  tmuxBin: string;
  tmuxConfPath: string;
}

/** Real-world factory. Production code uses this; tests use `new ControlPool`
 *  with an injected spawn. */
export function createTmuxControl(opts: CreateTmuxControlOpts): TmuxControl {
  const spawn = (session: string): ControlProc => {
    // stderr is `'ignore'` rather than `'pipe'` because errors surface via
    // the `%error` envelope on stdout — stderr would just buffer
    // unboundedly inside Bun until the child exits.
    const proc = Bun.spawn(
      [opts.tmuxBin, '-f', opts.tmuxConfPath, '-C', 'attach-session', '-t', session],
      { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore' },
    );
    // Bun.spawn stdout is a ReadableStream<Uint8Array>; adapt to the
    // `on('data', ...)` contract ControlClient expects. On a stream-side
    // error (rare — usually means the child died), `proc.kill()` makes
    // sure `proc.exited` resolves so ControlClient.onExit fires and
    // drains the in-flight queue instead of waiting on per-command
    // soft timeouts.
    const stdout = adaptReadable(proc.stdout, () => proc.kill());
    return {
      stdin: {
        // tmux in -C mode reads stdin line-by-line and eagerly; FileSink.write
        // is effectively fire-and-forget here, so we don't await its Promise.
        write: (data: string) => { proc.stdin.write(data); return true; },
        end: () => proc.stdin.end(),
      },
      stdout,
      exited: proc.exited,
      kill: () => proc.kill(),
    };
  };
  return new ControlPool({ spawn });
}

/** No-op TmuxControl for `--test` mode (and anywhere else tmux must
 *  not be touched). Every method resolves / returns the empty case. */
export function createNullTmuxControl(): TmuxControl {
  return {
    attachSession: async () => {},
    detachSession: () => {},
    run: () => Promise.reject(new NoControlClientError()),
    on: () => () => {},
    close: async () => {},
  };
}

function adaptReadable(
  stream: ReadableStream<Uint8Array>,
  onStreamError: () => void,
): ControlProc['stdout'] {
  type DataCb = (chunk: Buffer | string) => void;
  const listeners: DataCb[] = [];
  (async () => {
    const reader = stream.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        if (value) for (const cb of listeners) cb(Buffer.from(value));
      }
    } catch {
      onStreamError();
    }
  })();
  return { on: (_e, cb) => { listeners.push(cb); } };
}
