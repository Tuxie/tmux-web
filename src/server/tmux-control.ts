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
    this.proc.stdin.write(head.args.join(' ') + '\n');
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
    const client = new ControlClient(proc, (n) => this.onNotification(client, n));
    // Size-negotiation guard (§3.5). Swallow errors — older tmux without
    // -C WxH for refresh-client falls back to window-size latest.
    try { await client.run(['refresh-client', '-C', '10000x10000']); } catch { /* best-effort */ }
    // Readiness probe. If it fails, the client is dead/unusable; propagate.
    await client.run(['display-message', '-p', 'ok']);
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
