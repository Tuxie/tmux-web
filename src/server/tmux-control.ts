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
