# tmux Control Mode Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every `execFileAsync` / `Bun.spawnSync` tmux call in `src/server/` with commands issued over persistent `tmux -C` control-mode clients (one per attached session, primary-elected for notifications), and drive `\x00TT:session` / `\x00TT:windows` pushes from tmux's own `%`-event stream instead of OSC-title sniffing.

**Architecture:** New module `src/server/tmux-control.ts` owns a pool of per-session `ControlClient` instances. Each wraps a `Bun.spawn(['tmux', '-C', 'attach-session', '-t', name])` with a serial FIFO command queue and a line-buffered parser for `%begin / %end / %error` response envelopes and standalone `%<event>` notifications. The oldest-alive client is primary; every `run()` call dispatches through it (`-t <target>` in args does session-scoping), and only the primary's notification stream is fanned out. Spawning is lazy per-session — `ws.ts` calls `attachSession` on WS open and `detachSession` on last-WS-close. Fallback `execFileAsync` is retained only for the cold-path `/api/sessions` GET that runs before any tab is open, plus non-tmux callers (`openssl`, `inotifywait`, startup `tmux -V` / `source-file` probes).

**Tech Stack:** Bun runtime, TypeScript ESM (`.js` imports), `bun:test` for unit tests, Playwright for e2e, `ws` for WebSocket, tmux ≥ 3.x.

**Spec:** `docs/superpowers/specs/2026-04-22-tmux-control-mode-design.md`.

---

## File Structure

### New files

- **`src/server/tmux-control.ts`** — parser + `ControlClient` + `ControlPool` + `TmuxControl` facade. All public types (`TmuxControl`, `TmuxNotification`, `TmuxCommandError`, `NoControlClientError`, `RunCmd`) exported from here. ~400–500 LOC.
- **`tests/unit/server/tmux-control-parser.test.ts`** — byte-level parser tests (envelope framing, notification extraction, split-line re-assembly, cmdnum correlation).
- **`tests/unit/server/tmux-control-pool.test.ts`** — pool-level tests (spawn idempotency, primary election, death handling, `NoControlClientError`).
- **`tests/unit/server/tmux-control-cmd.test.ts`** — single-client command dispatch tests (serial FIFO, `%end` / `%error` / exit / desync / timeout).
- **`tests/e2e/control-mode-notifications.spec.ts`** — real-tmux e2e verifying `\x00TT:session` / `\x00TT:windows` pushes fire on `%` events.
- **`tests/e2e/control-mode-window-size.spec.ts`** — real-tmux e2e verifying control client doesn't shrink the session.

### Modified files

- **`src/server/index.ts`** — construct `TmuxControl`, pass into `createHttpHandler` + `createWsServer`, `close()` on exit.
- **`src/server/http.ts`** — `/api/sessions` and `/api/windows` via `tmuxControl.run`, with `NoControlClientError` → `execFileAsync` cold-path for `/api/sessions`.
- **`src/server/ws.ts`** — lifecycle `attachSession`/`detachSession`, commands via `tmuxControl.run`, notification → broadcast fan-out.
- **`src/server/foreground-process.ts`** — `ForegroundDeps.exec` typed as `RunCmd` semantics (args-only, no binary path).
- **`src/server/tmux-inject.ts`** — `ExecFileAsync` hook replaced with `RunCmd`.
- **`src/server/osc52-reply.ts`** — inherits `RunCmd` from `tmux-inject`.
- **`src/server/protocol.ts`** — remove `messages.push({ session })` branch; keep title detection (title push is still OSC-sniff-driven).
- **`tmux.conf`** — add `set -g window-size latest`.
- **`tests/unit/server/tmux-inject.test.ts`**, **`tests/unit/server/foreground-process.test.ts`**, **`tests/unit/server/osc52-reply.test.ts`**, **`tests/unit/server/protocol.test.ts`** — updated to new signatures / removed expectations.

### Unchanged

All of `src/client/`, `src/server/pty.ts`, `src/server/ws-router.ts`, `src/server/exec.ts`, `src/server/tls.ts`, `src/server/file-drop.ts`, and every other server file not listed above.

---

### Shared type definitions

The plan refers to these exact signatures. They live in `src/server/tmux-control.ts` (created in Task 1).

```ts
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
```

---

## Task 1: Control-mode protocol parser

**Goal:** Pure, synchronous line-buffered parser that consumes tmux `-C` stdout chunks and produces (a) command-response frames and (b) notifications.

**Files:**
- Create: `src/server/tmux-control.ts`
- Create: `tests/unit/server/tmux-control-parser.test.ts`

- [ ] **Step 1: Write the first failing test (parser scaffold)**

Create `tests/unit/server/tmux-control-parser.test.ts`:

```ts
import { describe, test, expect } from 'bun:test';
import { ControlParser } from '../../../src/server/tmux-control.ts';

describe('ControlParser', () => {
  test('emits a command response on %end', () => {
    const events: Array<{ kind: string; cmdnum?: number; output?: string; error?: string }> = [];
    const parser = new ControlParser({
      onResponse: (cmdnum, output) => events.push({ kind: 'response', cmdnum, output }),
      onError: (cmdnum, stderr) => events.push({ kind: 'error', cmdnum, error: stderr }),
      onNotification: () => {},
    });
    parser.push('%begin 1700000000 5 0\n');
    parser.push('hello world\n');
    parser.push('%end 1700000000 5 0\n');
    expect(events).toEqual([{ kind: 'response', cmdnum: 5, output: 'hello world' }]);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `bun test tests/unit/server/tmux-control-parser.test.ts`
Expected: FAIL with `Cannot find module '.../tmux-control.ts'`.

- [ ] **Step 3: Write minimal parser + module skeleton**

Create `src/server/tmux-control.ts`:

```ts
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
    // (Notification handling lands in a later step.)
  }
}
```

- [ ] **Step 4: Run test — verify it passes**

Run: `bun test tests/unit/server/tmux-control-parser.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Add %error test**

Append to `tmux-control-parser.test.ts`:

```ts
  test('emits an error on %error', () => {
    const events: Array<{ kind: string; cmdnum?: number; stderr?: string }> = [];
    const parser = new ControlParser({
      onResponse: () => {},
      onError: (cmdnum, stderr) => events.push({ kind: 'error', cmdnum, stderr }),
      onNotification: () => {},
    });
    parser.push('%begin 1 7 0\nbad args\n%error 1 7 0\n');
    expect(events).toEqual([{ kind: 'error', cmdnum: 7, stderr: 'bad args' }]);
  });
```

Run: `bun test tests/unit/server/tmux-control-parser.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Add split-chunk buffering test**

```ts
  test('buffers lines split across push boundaries', () => {
    const events: Array<{ output: string }> = [];
    const parser = new ControlParser({
      onResponse: (_, output) => events.push({ output }),
      onError: () => {},
      onNotification: () => {},
    });
    parser.push('%begin 1 1 0\nhel');
    parser.push('lo\n%en');
    parser.push('d 1 1 0\n');
    expect(events).toEqual([{ output: 'hello' }]);
  });
```

Run: `bun test tests/unit/server/tmux-control-parser.test.ts`
Expected: PASS (3 tests — parser already handles this via `buf` accumulator).

- [ ] **Step 7: Add notification-line test**

```ts
  test('emits sessionsChanged from a %sessions-changed notification', () => {
    const notes: TmuxNotification[] = [];
    const parser = new ControlParser({
      onResponse: () => {},
      onError: () => {},
      onNotification: (n) => notes.push(n),
    });
    parser.push('%sessions-changed\n');
    expect(notes).toEqual([{ type: 'sessionsChanged' }]);
  });
```

Also add the import if not already in the test file:

```ts
import type { TmuxNotification } from '../../../src/server/tmux-control.ts';
```

Run: `bun test tests/unit/server/tmux-control-parser.test.ts`
Expected: FAIL (notification dispatch not implemented).

- [ ] **Step 8: Implement notification dispatch in `consumeLine`**

Replace the `// Outside an envelope: notification or unknown line.` comment in `src/server/tmux-control.ts` with:

```ts
    // Outside an envelope: notification or unknown line.
    if (!line.startsWith('%')) return;
    const note = parseNotification(line);
    if (note) this.cb.onNotification(note);
```

And add at the bottom of `tmux-control.ts` (outside the class):

```ts
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
```

Run: `bun test tests/unit/server/tmux-control-parser.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 9: Add the remaining notification tests**

```ts
  test('parses %session-renamed into id + name', () => {
    const notes: TmuxNotification[] = [];
    const parser = new ControlParser({
      onResponse: () => {}, onError: () => {},
      onNotification: (n) => notes.push(n),
    });
    parser.push('%session-renamed $3 newname\n');
    expect(notes).toEqual([{ type: 'sessionRenamed', id: '$3', name: 'newname' }]);
  });

  test('parses %session-closed', () => {
    const notes: TmuxNotification[] = [];
    const parser = new ControlParser({
      onResponse: () => {}, onError: () => {},
      onNotification: (n) => notes.push(n),
    });
    parser.push('%session-closed $5\n');
    expect(notes).toEqual([{ type: 'sessionClosed', id: '$5' }]);
  });

  test('parses %window-add / %window-close / %window-renamed', () => {
    const notes: TmuxNotification[] = [];
    const parser = new ControlParser({
      onResponse: () => {}, onError: () => {},
      onNotification: (n) => notes.push(n),
    });
    parser.push('%window-add @7\n');
    parser.push('%window-close @7\n');
    parser.push('%window-renamed @8 foo\n');
    expect(notes).toEqual([
      { type: 'windowAdd', window: '@7' },
      { type: 'windowClose', window: '@7' },
      { type: 'windowRenamed', window: '@8', name: 'foo' },
    ]);
  });

  test('discards %output (consumed elsewhere under scope B: it is not)', () => {
    const notes: TmuxNotification[] = [];
    const parser = new ControlParser({
      onResponse: () => {}, onError: () => {},
      onNotification: (n) => notes.push(n),
    });
    parser.push('%output %1 some bytes\n');
    expect(notes).toEqual([]);
  });

  test('discards unrecognised notifications', () => {
    const notes: TmuxNotification[] = [];
    const parser = new ControlParser({
      onResponse: () => {}, onError: () => {},
      onNotification: (n) => notes.push(n),
    });
    parser.push('%client-session-changed /dev/pts/0 $1 main\n');
    parser.push('%layout-change @1 whatever 0\n');
    expect(notes).toEqual([]);
  });
```

Run: `bun test tests/unit/server/tmux-control-parser.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 10: Commit**

```bash
git add src/server/tmux-control.ts tests/unit/server/tmux-control-parser.test.ts
git commit -m "feat(server): add tmux control-mode protocol parser"
```

---

## Task 2: ControlClient — single-client command queue

**Goal:** `ControlClient` wraps a spawned `tmux -C` process (stdin/stdout streams). It serialises commands, correlates responses by monotonic cmdnum, and rejects on exit / `%error` / desync / timeout.

**Files:**
- Modify: `src/server/tmux-control.ts`
- Create: `tests/unit/server/tmux-control-cmd.test.ts`

- [ ] **Step 1: Write the first failing test (serial dispatch + %end)**

Create `tests/unit/server/tmux-control-cmd.test.ts`:

```ts
import { describe, test, expect } from 'bun:test';
import { ControlClient } from '../../../src/server/tmux-control.ts';

/** Scripted stdio pair: stdin is a MemoryWritable that records every
 *  write; stdout is a pushable readable the test drives frame-by-frame. */
function makeStdio() {
  const writes: string[] = [];
  const stdin = {
    write: (s: string) => { writes.push(s); return true; },
    end: () => {},
  };
  type Listener = (chunk: Buffer) => void;
  const listeners: Listener[] = [];
  const stdout = {
    on: (_e: string, cb: Listener) => { listeners.push(cb); },
    emit: (s: string) => { for (const l of listeners) l(Buffer.from(s, 'utf8')); },
  };
  let exitCb: (() => void) | null = null;
  const proc = {
    stdin, stdout,
    exited: new Promise<void>(resolve => { exitCb = resolve; }),
    kill: () => { exitCb?.(); },
  };
  return { writes, stdout, proc, exit: () => exitCb?.() };
}

describe('ControlClient', () => {
  test('serialises commands: writes one line then awaits %end', async () => {
    const { writes, stdout, proc } = makeStdio();
    const client = new ControlClient(proc as any);
    const p = client.run(['list-sessions']);
    // Give the microtask loop a tick so the client wrote stdin.
    await Promise.resolve();
    expect(writes).toEqual(['list-sessions\n']);
    stdout.emit('%begin 1 1 0\nfoo\nbar\n%end 1 1 0\n');
    expect(await p).toBe('foo\nbar');
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `bun test tests/unit/server/tmux-control-cmd.test.ts`
Expected: FAIL with `ControlClient is not exported`.

- [ ] **Step 3: Implement `ControlClient`**

Append to `src/server/tmux-control.ts`:

```ts
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
      // Stale response for a timed-out command: drop silently.
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
```

- [ ] **Step 4: Run test — verify it passes**

Run: `bun test tests/unit/server/tmux-control-cmd.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Add backlog-advancement test**

```ts
  test('advances the backlog after each response', async () => {
    const { writes, stdout, proc } = makeStdio();
    const client = new ControlClient(proc as any);
    const p1 = client.run(['list-sessions']);
    const p2 = client.run(['list-windows', '-t', 'main']);
    await Promise.resolve();
    // Only the first command is on the wire.
    expect(writes).toEqual(['list-sessions\n']);
    stdout.emit('%begin 1 1 0\none\n%end 1 1 0\n');
    expect(await p1).toBe('one');
    await Promise.resolve();
    expect(writes).toEqual(['list-sessions\n', 'list-windows -t main\n']);
    stdout.emit('%begin 2 2 0\ntwo\n%end 2 2 0\n');
    expect(await p2).toBe('two');
  });
```

Run: `bun test tests/unit/server/tmux-control-cmd.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Add %error test**

```ts
  test('rejects with TmuxCommandError on %error', async () => {
    const { stdout, proc } = makeStdio();
    const client = new ControlClient(proc as any);
    const p = client.run(['bogus-command']);
    await Promise.resolve();
    stdout.emit('%begin 1 1 0\nunknown command: bogus-command\n%error 1 1 0\n');
    await expect(p).rejects.toMatchObject({
      name: 'TmuxCommandError',
      stderr: 'unknown command: bogus-command',
      args: ['bogus-command'],
    });
  });
```

Run: `bun test tests/unit/server/tmux-control-cmd.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Add exit-mid-flight test**

```ts
  test('rejects in-flight + queued commands on process exit', async () => {
    const { proc, exit } = makeStdio();
    const client = new ControlClient(proc as any);
    const p1 = client.run(['list-sessions']);
    const p2 = client.run(['list-windows']);
    await Promise.resolve();
    exit();
    await Promise.resolve();
    await expect(p1).rejects.toMatchObject({ stderr: 'control client exited' });
    await expect(p2).rejects.toMatchObject({ stderr: 'control client exited' });
    expect(client.isAlive()).toBe(false);
  });
```

Run: `bun test tests/unit/server/tmux-control-cmd.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 8: Add timeout test (uses short injected timeout)**

```ts
  test('rejects with "timeout" after commandTimeoutMs but keeps the client alive', async () => {
    const { stdout, proc } = makeStdio();
    const client = new ControlClient(proc as any, () => {}, { commandTimeoutMs: 20 });
    const p = client.run(['sleeps-forever']);
    await expect(p).rejects.toMatchObject({ stderr: 'timeout' });
    expect(client.isAlive()).toBe(true);

    // After timeout: a late-arriving stale response for cmdnum 1 is
    // dropped on the cmdnum-mismatch guard (next real cmdnum is 2).
    stdout.emit('%begin 1 1 0\nlate\n%end 1 1 0\n');
    const p2 = client.run(['list-sessions']);
    await Promise.resolve();
    stdout.emit('%begin 2 2 0\nok\n%end 2 2 0\n');
    expect(await p2).toBe('ok');
  });
```

Run: `bun test tests/unit/server/tmux-control-cmd.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 9: Commit**

```bash
git add src/server/tmux-control.ts tests/unit/server/tmux-control-cmd.test.ts
git commit -m "feat(server): add serial ControlClient for tmux -C stdio"
```

---

## Task 3: ControlPool — spawn, primary election, NoControlClientError

**Goal:** Manage `Map<sessionName, ControlClient>` + `insertionOrder[]`. Provide `attachSession`, `detachSession`, `run`, `on`, `close`. Dispatch notifications only from the primary (oldest-alive).

**Files:**
- Modify: `src/server/tmux-control.ts`
- Create: `tests/unit/server/tmux-control-pool.test.ts`

- [ ] **Step 1: Write the first failing test (idempotent attach + primary dispatch)**

Create `tests/unit/server/tmux-control-pool.test.ts`:

```ts
import { describe, test, expect } from 'bun:test';
import {
  ControlPool,
  NoControlClientError,
  type ControlProc,
  type TmuxNotification,
} from '../../../src/server/tmux-control.ts';

function fakeProc(): { proc: ControlProc; stdout: { emit: (s: string) => void }; writes: string[]; exit: () => void } {
  const writes: string[] = [];
  const stdin = { write: (s: string) => { writes.push(s); return true; }, end: () => {} };
  type L = (c: Buffer) => void; const ls: L[] = [];
  const stdout = {
    on: (_: string, cb: L) => { ls.push(cb); },
    emit: (s: string) => { for (const l of ls) l(Buffer.from(s, 'utf8')); },
  };
  let exitCb: (() => void) | null = null;
  const proc: ControlProc = {
    stdin, stdout: stdout as any,
    exited: new Promise(resolve => { exitCb = resolve; }),
    kill: () => { exitCb?.(); },
  };
  return { proc, stdout, writes, exit: () => exitCb?.() };
}

describe('ControlPool', () => {
  test('attachSession is idempotent and first attach becomes primary', async () => {
    const spawns: ReturnType<typeof fakeProc>[] = [];
    const spawn = (_session: string) => {
      const p = fakeProc();
      spawns.push(p);
      return p.proc;
    };
    const pool = new ControlPool({ spawn });

    const a1 = pool.attachSession('main');
    // Ready-probe: pool sent refresh-client + display-message. Resolve both.
    await Promise.resolve();
    spawns[0]!.stdout.emit(
      '%begin 1 1 0\n%end 1 1 0\n' +          // refresh-client response
      '%begin 2 2 0\nok\n%end 2 2 0\n',       // display-message response
    );
    await a1;
    // Idempotent.
    await pool.attachSession('main');
    expect(spawns.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `bun test tests/unit/server/tmux-control-pool.test.ts`
Expected: FAIL with `ControlPool is not exported`.

- [ ] **Step 3: Implement `ControlPool`**

Append to `src/server/tmux-control.ts`:

```ts
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
```

Also export `ControlProc` and `ControlClient` (already done in prior tasks).

- [ ] **Step 4: Run test — verify it passes**

Run: `bun test tests/unit/server/tmux-control-pool.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Add primary-election-on-death test**

```ts
  async function attachHappy(pool: ControlPool, name: string, fake: ReturnType<typeof fakeProc>) {
    const p = pool.attachSession(name);
    await Promise.resolve();
    fake.stdout.emit('%begin 1 1 0\n%end 1 1 0\n%begin 2 2 0\nok\n%end 2 2 0\n');
    await p;
  }

  test('primary = oldest-alive; promotes next on primary death', async () => {
    const spawns: ReturnType<typeof fakeProc>[] = [];
    const pool = new ControlPool({ spawn: () => { const p = fakeProc(); spawns.push(p); return p.proc; } });

    await attachHappy(pool, 'main', (spawns[0] ??= fakeProc()));
    await attachHappy(pool, 'dev',  (spawns[1] ??= fakeProc()));

    // Fire a notification from BOTH; only the primary should fan out.
    const notes: TmuxNotification[] = [];
    pool.on('sessionsChanged', (n) => notes.push(n));
    spawns[0]!.stdout.emit('%sessions-changed\n');   // primary — delivered
    spawns[1]!.stdout.emit('%sessions-changed\n');   // non-primary — dropped
    expect(notes).toHaveLength(1);

    // Kill primary. Next-oldest promotes.
    spawns[0]!.exit();
    await Promise.resolve();
    spawns[1]!.stdout.emit('%sessions-changed\n');
    expect(notes).toHaveLength(2);
  });
```

Run: `bun test tests/unit/server/tmux-control-pool.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Add empty-pool NoControlClientError test**

```ts
  test('run() rejects NoControlClientError when the pool is empty', async () => {
    const pool = new ControlPool({ spawn: () => fakeProc().proc });
    await expect(pool.run(['list-sessions'])).rejects.toBeInstanceOf(NoControlClientError);
  });
```

Run: `bun test tests/unit/server/tmux-control-pool.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Add detachSession test**

```ts
  test('detachSession kills the client and removes it from primary tracking', async () => {
    const spawns: ReturnType<typeof fakeProc>[] = [];
    const pool = new ControlPool({ spawn: () => { const p = fakeProc(); spawns.push(p); return p.proc; } });
    await attachHappy(pool, 'main', (spawns[0] ??= fakeProc()));
    pool.detachSession('main');
    await expect(pool.run(['list-sessions'])).rejects.toBeInstanceOf(NoControlClientError);
  });
```

Run: `bun test tests/unit/server/tmux-control-pool.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 8: Commit**

```bash
git add src/server/tmux-control.ts tests/unit/server/tmux-control-pool.test.ts
git commit -m "feat(server): add ControlPool with oldest-alive primary election"
```

---

## Task 4: Production spawner — wire `ControlPool` to `Bun.spawn`

**Goal:** Provide a real `spawn` implementation that shells out to `tmux -f <conf> -C attach-session -t <name>` and adapts `Bun.spawn` into the `ControlProc` shape. Expose a single `createTmuxControl()` factory that `index.ts` imports.

**Files:**
- Modify: `src/server/tmux-control.ts`

- [ ] **Step 1: Add factory**

Append to `src/server/tmux-control.ts`:

```ts
export interface CreateTmuxControlOpts {
  tmuxBin: string;
  tmuxConfPath: string;
}

/** Real-world factory. Production code uses this; tests use `new ControlPool`
 *  with an injected spawn. */
export function createTmuxControl(opts: CreateTmuxControlOpts): TmuxControl {
  const spawn = (session: string): ControlProc => {
    const proc = Bun.spawn(
      [opts.tmuxBin, '-f', opts.tmuxConfPath, '-C', 'attach-session', '-t', session],
      { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
    );
    // Bun.spawn stdout is a ReadableStream in newer versions; adapt to
    // the on('data', ...) contract ControlClient expects.
    const stdout = adaptReadable(proc.stdout);
    return {
      stdin: {
        write: (data: string) => {
          proc.stdin.write(data);
          return true;
        },
        end: () => proc.stdin.end(),
      },
      stdout,
      exited: proc.exited,
      kill: () => proc.kill(),
    };
  };
  return new ControlPool({ spawn });
}

function adaptReadable(stream: unknown): ControlProc['stdout'] {
  // Bun.spawn stdout type varies; we accept either a ReadableStream<Uint8Array>
  // or a Node-style stream with .on('data', ...). Return an object with the
  // narrow `on('data', cb)` surface ControlClient uses.
  type DataCb = (chunk: Buffer | string) => void;
  const listeners: DataCb[] = [];
  const readable = stream as ReadableStream<Uint8Array>;
  (async () => {
    const reader = readable.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        if (value) for (const cb of listeners) cb(Buffer.from(value));
      }
    } catch { /* stream errored; exited promise will resolve */ }
  })();
  return { on: (_e, cb) => { listeners.push(cb); } };
}
```

- [ ] **Step 2: Typecheck**

Run: `bun x tsc --noEmit`
Expected: no new errors. If `Bun.spawn` returns `ReadableStream<Uint8Array>` typing disagrees, cast via `as unknown as ReadableStream<Uint8Array>` in `adaptReadable` and note why with a one-line comment.

- [ ] **Step 3: Commit**

```bash
git add src/server/tmux-control.ts
git commit -m "feat(server): add createTmuxControl factory for Bun.spawn"
```

---

## Task 5: Bundled `tmux.conf` — `window-size latest`

**Goal:** Guarantee the control client never shrinks the session, regardless of whether `refresh-client -C WxH` succeeded on older tmux.

**Files:**
- Modify: `tmux.conf`

- [ ] **Step 1: Add the option**

Edit `tmux.conf`. Directly under the existing `set -g mouse on` line (line 42), add:

```conf
# Follow the latest-resizing client so the tmux-web control-mode client
# (which never resizes after its attach-time refresh-client -C 10000x10000)
# can't shrink the session to 80x24. See tmux-control.ts and the design
# spec at docs/superpowers/specs/2026-04-22-tmux-control-mode-design.md.
set -g window-size latest
```

- [ ] **Step 2: Verify the config parses**

Run: `tmux -f tmux.conf start-server \; kill-server`
Expected: exit code 0 (no config-parse error). If tmux isn't in PATH, skip — CI runs tmux.

- [ ] **Step 3: Commit**

```bash
git add tmux.conf
git commit -m "feat(tmux.conf): set window-size latest for control-client coexistence"
```

---

## Task 6: Wire `TmuxControl` into `ws.ts` lifecycle

**Goal:** `ws.ts` calls `tmuxControl.attachSession(session)` on WS open and `tmuxControl.detachSession(session)` on close. No command-routing changes yet — `execFileAsync` call sites stay. After this task there's one extra tmux client per open-tab session visible in `tmux list-clients`.

**Files:**
- Modify: `src/server/ws.ts`, `src/server/index.ts`
- Modify: `tests/unit/server/ws-handle-connection.test.ts` (if it binds tight assumptions)

- [ ] **Step 1: Extend `WsServerOptions`**

In `src/server/ws.ts`, add a `tmuxControl` field:

```ts
import type { TmuxControl } from './tmux-control.js';

export interface WsServerOptions {
  config: ServerConfig;
  tmuxConfPath: string;
  sessionsStorePath: string;
  tmuxControl: TmuxControl;
}
```

Thread it through `createWsServer` → `handleConnection` (add a parameter to `handleConnection`; update the call site inside `wss.on('connection', ...)`).

- [ ] **Step 2: Change `handleConnection` to take the whole `WsServerOptions`**

The existing `handleConnection(ws, req, config, tmuxConfPath, sessionsStorePath)` signature splits `WsServerOptions` into four positional parameters. Rewrite it as:

```ts
function handleConnection(ws: WebSocket, req: IncomingMessage, opts: WsServerOptions): void {
  const { config, tmuxConfPath, sessionsStorePath } = opts;
  // ... existing body, unchanged ...
}
```

Update the matching caller in `createWsServer`:

```ts
  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    handleConnection(ws, req, opts);
  });
```

Now `opts.tmuxControl` is available throughout the connection handler.

- [ ] **Step 3: Attach on WS open**

In `handleConnection`, immediately after `const ptyProcess = spawnPty({ command, env, cols, rows });`:

```ts
  if (!config.testMode) {
    void opts.tmuxControl.attachSession(session).catch((err) => {
      debug(config, `attachSession(${session}) failed: ${(err as Error).message}`);
    });
  }
```

- [ ] **Step 4: Detach on WS close (when it's the last tab for the session)**

Add a module-level ref-count keyed by session:

```ts
// Counts WS clients per session name. When the count drops to zero we
// detach the control client — no live tabs means no need for the pool
// to hold a live tmux -C attach on that session.
const sessionRefs = new Map<string, number>();
```

In `handleConnection`, after `spawnPty` + `attachSession`:

```ts
  sessionRefs.set(session, (sessionRefs.get(session) ?? 0) + 1);
```

In the `ws.on('close', ...)` handler, before `ptyProcess.kill()`:

```ts
    const next = (sessionRefs.get(session) ?? 1) - 1;
    if (next <= 0) {
      sessionRefs.delete(session);
      if (!config.testMode) opts.tmuxControl.detachSession(session);
    } else {
      sessionRefs.set(session, next);
    }
```

- [ ] **Step 5: Construct `TmuxControl` in `index.ts`**

In `src/server/index.ts`, after `warnIfDangerousOriginConfig(config);` and the tmux `-V` probe, add:

```ts
  const tmuxControl = config.testMode
    ? null
    : createTmuxControl({ tmuxBin: config.tmuxBin, tmuxConfPath: effectiveTmuxConfPath });
```

You need `effectiveTmuxConfPath` — that's resolved a few dozen lines later. Move the `createTmuxControl` call to after `effectiveTmuxConfPath` is known but before `createWsServer(...)`. Also add the import at the top:

```ts
import { createTmuxControl, type TmuxControl } from './tmux-control.js';
```

Pass `tmuxControl` to both `createHttpHandler` (will be wired in Task 12) and `createWsServer`:

```ts
  createWsServer(server, {
    config,
    tmuxConfPath: effectiveTmuxConfPath,
    sessionsStorePath,
    tmuxControl: tmuxControl ?? createNullTmuxControl(),
  });
```

Add `createNullTmuxControl()` to `src/server/tmux-control.ts`:

```ts
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
```

Register shutdown:

```ts
  process.on('exit', () => { void tmuxControl?.close(); });
```

- [ ] **Step 6: Run unit tests, fix any signature drift**

Run: `bun test`
Expected: all pass. If `tests/unit/server/ws-handle-connection.test.ts` constructs `handleConnection`'s argument directly, update the fixture to pass a `createNullTmuxControl()` instance.

- [ ] **Step 7: Run e2e smoke**

Run: `bunx playwright test tests/e2e/sessions.test.ts`
Expected: pass. This asserts no regression from adding the attach call in the WS path (tests run in `--test` mode → `tmuxControl` is null → attach is skipped).

- [ ] **Step 8: Commit**

```bash
git add src/server/ws.ts src/server/index.ts src/server/tmux-control.ts tests/unit/server/ws-handle-connection.test.ts
git commit -m "feat(server): attach/detach TmuxControl on WS open/close"
```

---

## Task 7: Notification-driven session/windows push

**Goal:** Register handlers on `TmuxControl` in `ws.ts` that broadcast `\x00TT:session` / `\x00TT:windows` to WS clients when tmux emits `%sessions-changed`, `%session-renamed`, `%session-closed`, `%window-add`, `%window-close`, `%window-renamed`. At the end of this task, pushes fire from BOTH the OSC-title sniff AND `%` notifications — harmless duplicates, payload-identical. The OSC path is removed in Task 8.

**Files:**
- Modify: `src/server/ws.ts`

- [ ] **Step 1: Track WS clients per session**

Add to `ws.ts` module-level (next to `sessionRefs`):

```ts
/** WS connection registry keyed by session name. Used to fan out
 *  \x00TT notifications driven by tmux %-events. */
const wsClientsBySession = new Map<string, Set<WebSocket>>();
```

In `handleConnection` (after `sessionRefs.set(...)` in Task 6):

```ts
  let sessionSet = wsClientsBySession.get(session);
  if (!sessionSet) { sessionSet = new Set(); wsClientsBySession.set(session, sessionSet); }
  sessionSet.add(ws);
```

In `ws.on('close', ...)` (next to `sessionRefs` decrement):

```ts
    sessionSet?.delete(ws);
    if (sessionSet && sessionSet.size === 0) wsClientsBySession.delete(session);
```

(`sessionSet` is captured in the closure.)

- [ ] **Step 2: Broadcast helper**

Add to `ws.ts` module level:

```ts
async function broadcastSessions(config: ServerConfig, tmuxControl: TmuxControl): Promise<void> {
  if (wsClientsBySession.size === 0) return;
  let stdout: string;
  try {
    stdout = await tmuxControl.run(['list-sessions', '-F', '#{session_id}:#{session_name}']);
  } catch { return; }
  const sessions = stdout.split('\n').filter(Boolean).map(line => {
    const [rawId, ...rest] = line.split(':');
    return { id: (rawId ?? '').replace(/^\$/, ''), name: rest.join(':') };
  });
  for (const [sessionName, clients] of wsClientsBySession) {
    for (const ws of clients) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      // Keep the existing ServerMessage shape: `session` is the current
      // session name for THIS connection; `sessions` is the full list.
      ws.send(frameTTMessage({ session: sessionName, /* sessions field added in a future task if needed */ } as any));
    }
  }
  void sessions; // sessions list unused until client consumes it; push is a trigger
}

async function broadcastWindowsForSession(
  sessionName: string,
  config: ServerConfig,
  tmuxControl: TmuxControl,
): Promise<void> {
  const clients = wsClientsBySession.get(sessionName);
  if (!clients || clients.size === 0) return;
  try {
    const stdout = await tmuxControl.run([
      'list-windows', '-t', sessionName, '-F',
      '#{window_index}\t#{window_name}\t#{window_active}',
    ]);
    const windows: WindowInfo[] = stdout.split('\n').filter(Boolean).map(line => {
      const [index, name, active] = line.split('\t');
      return { index: index!, name: name!, active: active === '1' };
    });
    for (const ws of clients) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      ws.send(frameTTMessage({ session: sessionName, windows }));
    }
  } catch { /* non-fatal */ }
}
```

The `sessions` object / aggregated list isn't currently part of `ServerMessage`; the existing session-dropdown-population path calls `/api/sessions` on the client when it receives any `session` message. Matching that, we just fire one `{ session: sessionName }` per attached client — the client re-fetches. This preserves today's protocol and keeps the push change isolated.

Simplify — collapse `broadcastSessions` to:

```ts
async function broadcastSessions(tmuxControl: TmuxControl): Promise<void> {
  if (wsClientsBySession.size === 0) return;
  for (const [sessionName, clients] of wsClientsBySession) {
    for (const ws of clients) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      ws.send(frameTTMessage({ session: sessionName }));
    }
  }
  void tmuxControl; // kept in signature for symmetry with window broadcast
}
```

The client's existing on-`session` handler already re-fetches `/api/sessions` and `/api/windows` on receipt.

- [ ] **Step 3: Resolve window → session**

tmux `%window-*` events carry `@N` (the global window id) but not its owning session. Resolve via `display-message`:

```ts
async function sessionForWindow(
  windowId: string,
  tmuxControl: TmuxControl,
): Promise<string | null> {
  try {
    const stdout = await tmuxControl.run(['display-message', '-p', '-t', windowId, '#{session_name}']);
    const name = stdout.trim();
    return name || null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Subscribe in `createWsServer`**

Right after `const wss = new WebSocketServer({ noServer: true });` at the top of `createWsServer`, add:

```ts
  const unsubscribers: Array<() => void> = [];
  unsubscribers.push(opts.tmuxControl.on('sessionsChanged', () => { void broadcastSessions(opts.tmuxControl); }));
  unsubscribers.push(opts.tmuxControl.on('sessionRenamed',  () => { void broadcastSessions(opts.tmuxControl); }));
  unsubscribers.push(opts.tmuxControl.on('sessionClosed',   () => { void broadcastSessions(opts.tmuxControl); }));
  unsubscribers.push(opts.tmuxControl.on('windowAdd', async (n) => {
    const s = await sessionForWindow(n.window, opts.tmuxControl);
    if (s) void broadcastWindowsForSession(s, opts.config, opts.tmuxControl);
  }));
  unsubscribers.push(opts.tmuxControl.on('windowClose', async (n) => {
    const s = await sessionForWindow(n.window, opts.tmuxControl);
    if (s) void broadcastWindowsForSession(s, opts.config, opts.tmuxControl);
  }));
  unsubscribers.push(opts.tmuxControl.on('windowRenamed', async (n) => {
    const s = await sessionForWindow(n.window, opts.tmuxControl);
    if (s) void broadcastWindowsForSession(s, opts.config, opts.tmuxControl);
  }));
```

Call the unsubscribers in a `wss.on('close', ...)` handler (append):

```ts
  wss.on('close', () => { for (const u of unsubscribers) u(); });
```

- [ ] **Step 5: Typecheck + unit tests**

Run: `bun x tsc --noEmit`
Expected: clean.

Run: `bun test`
Expected: all pass. The new code runs only when `TmuxControl` emits events; in `--test` mode `createNullTmuxControl` never emits, so existing tests are unaffected.

- [ ] **Step 6: Commit**

```bash
git add src/server/ws.ts
git commit -m "feat(server): broadcast session/windows pushes from tmux %-events"
```

---

## Task 8: Remove OSC-title-triggered session/windows push

**Goal:** With `%` notifications driving session/windows push (Task 7), the OSC-title-sniff path in `protocol.ts` becomes redundant. Remove the `messages.push({ session })` branch. The `detectedTitle` / `titleChanged` flags stay — they drive pane-title push (`sendWindowState`'s `title` field) via `ws.ts`.

**Files:**
- Modify: `src/server/protocol.ts`
- Modify: `tests/unit/server/protocol.test.ts`

- [ ] **Step 1: Write the failing test**

Update `tests/unit/server/protocol.test.ts` — replace this existing assertion:

```ts
  it('detects OSC 0 title sequence (BEL terminated)', () => {
    const data = '\x1b]0;mysession:1:vim - hello\x07rest';
    const result = processData(data, 'main');
    expect(result.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ session: 'mysession' }),
      ])
    );
    expect(result.output).toContain('\x1b]0;');
  });
```

with:

```ts
  it('detects OSC 0 title sequence without pushing a session message', () => {
    const data = '\x1b]0;mysession:1:vim - hello\x07rest';
    const result = processData(data, 'main');
    // Session push is now %-event driven (tmux-control.ts). The OSC
    // sniff still exposes titleChanged + detectedSession so ws.ts can
    // update `title` on the connection, but messages[] no longer
    // carries a {session} entry from this path.
    expect(result.titleChanged).toBe(true);
    expect(result.detectedSession).toBe('mysession');
    expect(result.messages.filter(m => m.session !== undefined)).toEqual([]);
    expect(result.output).toContain('\x1b]0;');
  });
```

Also replace the `detects OSC 2 title sequence (ST terminated)` test:

```ts
  it('detects OSC 2 title sequence without pushing a session message', () => {
    const data = '\x1b]2;dev:0:zsh - test\x1b\\rest';
    const result = processData(data, 'main');
    expect(result.titleChanged).toBe(true);
    expect(result.detectedSession).toBe('dev');
    expect(result.messages.filter(m => m.session !== undefined)).toEqual([]);
  });
```

Also replace `handles mixed OSC title + OSC 52 in same data`:

```ts
  it('handles mixed OSC title + OSC 52 in same data', () => {
    const data = '\x1b]0;work:0:zsh\x07some output\x1b]52;c;dGVzdA==\x07more';
    const result = processData(data, 'main');
    expect(result.output).toBe('\x1b]0;work:0:zsh\x07some outputmore');
    // Session push moved off the OSC path; still only OSC 52 clipboard
    // messages are emitted from processData under the new contract.
    expect(result.messages.some(m => m.session === 'work')).toBe(false);
    expect(result.messages.some(m => m.clipboard === 'dGVzdA==')).toBe(true);
  });
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `bun test tests/unit/server/protocol.test.ts`
Expected: FAIL (messages still contain `{session}`).

- [ ] **Step 3: Drop the push in `processData`**

In `src/server/protocol.ts`, remove these four lines at the bottom of `processData`:

```ts
  if (titleChanged && detectedSession) {
    messages.push({ session: detectedSession });
  }
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `bun test tests/unit/server/protocol.test.ts`
Expected: PASS.

Run the full unit suite:

Run: `bun test`
Expected: PASS (other tests that touched session push use the updated assertion above).

- [ ] **Step 5: Commit**

```bash
git add src/server/protocol.ts tests/unit/server/protocol.test.ts
git commit -m "refactor(server): drop OSC-title-triggered session push"
```

---

## Task 9: Convert `foreground-process.ts` to use `RunCmd`

**Goal:** Replace the `ExecFileAsync` signature in `ForegroundDeps.exec` with `RunCmd` (args-only; the binary is already encapsulated in the injected `TmuxControl.run`). Call sites update to pass `tmuxControl.run`.

**Files:**
- Modify: `src/server/foreground-process.ts`
- Modify: `tests/unit/server/foreground-process.test.ts`
- Modify: `src/server/ws.ts`, `src/server/http.ts` (call sites)

- [ ] **Step 1: Update `foreground-process.ts` signature**

Replace the file body. The net change: `deps.exec` takes `(args)` only, and there is no `tmuxBin` parameter on `getForegroundProcess`.

```ts
import fs from 'fs';
import type { RunCmd } from './tmux-control.js';

export interface ForegroundProcessInfo {
  exePath: string | null;
  commandName: string | null;
  pid: number | null;
}

export interface ForegroundDeps {
  exec: RunCmd;
  readFile: (path: string) => string;
  readlink: (path: string) => string;
}

export function parseForegroundFromProc(stat: string): number | null {
  const closeParen = stat.lastIndexOf(')');
  if (closeParen === -1) return null;
  const tail = stat.slice(closeParen + 2).split(' ');
  const tpgid = Number(tail[5]);
  if (!Number.isFinite(tpgid) || tpgid <= 0) return null;
  return tpgid;
}

const defaultDeps = (runCmd: RunCmd): ForegroundDeps => ({
  exec: runCmd,
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  readlink: (p) => fs.readlinkSync(p) as string,
});

export async function getForegroundProcess(
  run: RunCmd,
  session: string,
  depsOverride?: Partial<ForegroundDeps>,
): Promise<ForegroundProcessInfo> {
  const deps: ForegroundDeps = { ...defaultDeps(run), ...depsOverride };
  let panePid: string | null = null;
  let commandName: string | null = null;
  try {
    const stdout = await deps.exec([
      'display-message', '-p', '-t', session,
      '-F', '#{pane_pid}\t#{pane_current_command}',
    ]);
    const [pidStr, cmdStr] = stdout.trim().split('\t');
    if (pidStr) panePid = pidStr;
    if (cmdStr) commandName = cmdStr;
  } catch {
    return { exePath: null, commandName: null, pid: null };
  }
  if (!panePid) return { exePath: null, commandName, pid: null };

  let foregroundPid: number | null = null;
  try {
    const stat = deps.readFile(`/proc/${panePid}/stat`);
    foregroundPid = parseForegroundFromProc(stat);
  } catch {
    return { exePath: null, commandName, pid: Number(panePid) };
  }
  if (!foregroundPid) foregroundPid = Number(panePid);

  try {
    const exePath = deps.readlink(`/proc/${foregroundPid}/exe`);
    return { exePath, commandName, pid: foregroundPid };
  } catch {
    return { exePath: null, commandName, pid: foregroundPid };
  }
}
```

- [ ] **Step 2: Update `foreground-process.test.ts`**

Replace each `deps` literal to match the new shape. Full file:

```ts
import { describe, test, expect } from 'bun:test';
import { parseForegroundFromProc, getForegroundProcess } from '../../../src/server/foreground-process.ts';

describe('parseForegroundFromProc', () => {
  test('extracts tpgid from canonical /proc/<pid>/stat', () => {
    const stat = '123 (bash) S 100 123 123 34816 456 4194304 0 ...';
    expect(parseForegroundFromProc(stat)).toBe(456);
  });
  test('handles comm containing spaces and parens', () => {
    const stat = '123 (weird )(name) S 100 123 123 34816 789 ...';
    expect(parseForegroundFromProc(stat)).toBe(789);
  });
  test('returns null for tpgid 0 or -1', () => {
    expect(parseForegroundFromProc('1 (x) S 1 1 1 0 0 ...')).toBeNull();
    expect(parseForegroundFromProc('1 (x) S 1 1 1 0 -1 ...')).toBeNull();
  });
  test('returns null for malformed input', () => {
    expect(parseForegroundFromProc('')).toBeNull();
    expect(parseForegroundFromProc('no closing paren here')).toBeNull();
  });
});

describe('getForegroundProcess with injected deps', () => {
  const ok = async (_args: readonly string[]) => '123\tbash\n';

  test('happy path: resolves exePath via injected readlink', async () => {
    const got = await getForegroundProcess(ok, 'main', {
      readFile: () => '123 (bash) S 1 1 1 34816 999 ...',
      readlink: () => '/usr/bin/bash',
    });
    expect(got).toEqual({ exePath: '/usr/bin/bash', commandName: 'bash', pid: 999 });
  });

  test('exec failure → all null', async () => {
    const got = await getForegroundProcess(async () => { throw new Error('nope'); }, 'main');
    expect(got).toEqual({ exePath: null, commandName: null, pid: null });
  });

  test('readlink failure → exePath null, pid preserved', async () => {
    const got = await getForegroundProcess(ok, 'main', {
      readFile: () => '123 (bash) S 1 1 1 34816 999 ...',
      readlink: () => { throw new Error('ENOENT'); },
    });
    expect(got).toEqual({ exePath: null, commandName: 'bash', pid: 999 });
  });

  test('readFile failure → exePath null, commandName preserved', async () => {
    const got = await getForegroundProcess(ok, 'main', {
      readFile: () => { throw new Error('EACCES'); },
      readlink: () => '/never-called',
    });
    expect(got).toEqual({ exePath: null, commandName: 'bash', pid: 123 });
  });

  test('tpgid zero falls back to panePid for exe lookup', async () => {
    const got = await getForegroundProcess(async () => '500\tzsh', 'main', {
      readFile: () => '500 (zsh) S 1 1 1 34816 0 ...',
      readlink: (p) => (p.includes('/500/') ? '/bin/zsh' : (() => { throw new Error(); })()),
    });
    expect(got).toEqual({ exePath: '/bin/zsh', commandName: 'zsh', pid: 500 });
  });

  test('empty exec stdout → commandName null, pid null', async () => {
    const got = await getForegroundProcess(async () => '', 'main', {
      readFile: () => { throw new Error('unused'); },
      readlink: () => { throw new Error('unused'); },
    });
    expect(got).toEqual({ exePath: null, commandName: null, pid: null });
  });
});
```

- [ ] **Step 3: Update call sites**

In `src/server/ws.ts`, line 327:

```ts
    const fg = await getForegroundProcess(opts.tmuxControl.run, lastSession);
```

In `src/server/http.ts`, line 81 (`formatDropPasteBytes`):

```ts
      const fg = await getForegroundProcess(opts.tmuxControl.run, session);
```

For the http.ts call site, `opts.tmuxControl` isn't yet plumbed into `createHttpHandler`. Add it to `HttpHandlerOptions`:

```ts
import type { TmuxControl } from './tmux-control.js';

export interface HttpHandlerOptions {
  /* ...existing fields... */
  tmuxControl: TmuxControl;
}
```

and pass from `index.ts`:

```ts
  const handler = await createHttpHandler({
    /* ...existing fields... */
    tmuxControl: tmuxControl ?? createNullTmuxControl(),
  });
```

- [ ] **Step 4: Run unit tests**

Run: `bun test tests/unit/server/foreground-process.test.ts tests/unit/server/foreground-process-integration.test.ts`
Expected: PASS. If `foreground-process-integration.test.ts` calls the old signature, update it the same way (wrap the fake-tmux invocation in a `RunCmd` that shells to the fake binary via `execFileAsync` — keep the integration value by running the real shell-script fake).

- [ ] **Step 5: Run full test suite**

Run: `bun test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/foreground-process.ts src/server/ws.ts src/server/http.ts src/server/index.ts tests/unit/server/foreground-process.test.ts tests/unit/server/foreground-process-integration.test.ts
git commit -m "refactor(server): foreground-process uses RunCmd"
```

---

## Task 10: Convert `tmux-inject.ts` to use `RunCmd`

**Goal:** `sendBytesToPane` stops taking `tmuxBin`; takes a `RunCmd` instead. Update callers (`osc52-reply.ts`, `http.ts` drop-paste, `ws.ts`).

**Files:**
- Modify: `src/server/tmux-inject.ts`
- Modify: `tests/unit/server/tmux-inject.test.ts`
- Modify: `src/server/osc52-reply.ts`, `tests/unit/server/osc52-reply.test.ts`
- Modify: `src/server/http.ts`

- [ ] **Step 1: Update `tmux-inject.ts`**

Replace the file:

```ts
import type { RunCmd } from './tmux-control.js';

export type { RunCmd };

export interface SendBytesOpts {
  run: RunCmd;
  /** tmux `-t` target (session, session:window, pane id …). */
  target: string;
  /** Raw byte string (one char = one byte). */
  bytes: string;
}

/** Inject raw bytes into the active pane of a tmux target via
 *  `send-keys -H <hex bytes>`. See the design spec §4.5 for why
 *  this goes through control mode now. */
export async function sendBytesToPane(opts: SendBytesOpts): Promise<void> {
  const hex: string[] = [];
  for (let i = 0; i < opts.bytes.length; i++) {
    hex.push(opts.bytes.charCodeAt(i).toString(16).padStart(2, '0'));
  }
  await opts.run(['send-keys', '-H', '-t', opts.target, ...hex]);
}
```

- [ ] **Step 2: Update `tmux-inject.test.ts`**

```ts
import { describe, test, expect } from 'bun:test';
import { sendBytesToPane } from '../../../src/server/tmux-inject.ts';

function recordingRun() {
  const calls: Array<readonly string[]> = [];
  const run = async (args: readonly string[]) => {
    calls.push(args);
    return '';
  };
  return { calls, run };
}

describe('sendBytesToPane', () => {
  test('invokes `send-keys -H -t <target> <hex bytes>`', async () => {
    const { calls, run } = recordingRun();
    await sendBytesToPane({
      run, target: 'main', bytes: '\x1b[200~/tmp/x\x1b[201~',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.slice(0, 4)).toEqual(['send-keys', '-H', '-t', 'main']);
    const decoded = calls[0]!.slice(4).map(h => String.fromCharCode(parseInt(h, 16))).join('');
    expect(decoded).toBe('\x1b[200~/tmp/x\x1b[201~');
  });

  test('forwards the target string verbatim (session:window.pane form)', async () => {
    const { calls, run } = recordingRun();
    await sendBytesToPane({ run, target: 'dev:2.1', bytes: 'x' });
    expect(calls[0]!.slice(0, 4)).toEqual(['send-keys', '-H', '-t', 'dev:2.1']);
  });

  test('each byte is emitted as exactly one two-digit hex arg', async () => {
    const { calls, run } = recordingRun();
    await sendBytesToPane({ run, target: 'main', bytes: 'ab\x00\xff' });
    expect(calls[0]!.slice(4)).toEqual(['61', '62', '00', 'ff']);
  });
});
```

- [ ] **Step 3: Update `osc52-reply.ts`**

```ts
import { buildOsc52Response } from './protocol.js';
import { sendBytesToPane } from './tmux-inject.js';
import type { RunCmd } from './tmux-control.js';

export interface DeliverOpts {
  run: RunCmd;
  target: string;
  selection: string;
  base64: string;
  /** Fallback for callers not running under tmux (test mode). Receives
   *  the raw OSC 52 byte string directly — e.g. ptyProcess.write. */
  directWrite?: (bytes: string) => void;
}

export async function deliverOsc52Reply(opts: DeliverOpts): Promise<void> {
  const bytes = buildOsc52Response(opts.selection, opts.base64);
  if (opts.directWrite) { opts.directWrite(bytes); return; }
  await sendBytesToPane({ run: opts.run, target: opts.target, bytes });
}
```

- [ ] **Step 4: Update `osc52-reply.test.ts`**

Replace `recordingExec` usage with `recordingRun`, drop the `tmuxBin` field, drop the `expect(calls[0]!.file)` assertions (there's no `file` now — the `RunCmd` is the injection point):

```ts
import { describe, test, expect } from 'bun:test';
import { deliverOsc52Reply } from '../../../src/server/osc52-reply.ts';

function recordingRun() {
  const calls: Array<readonly string[]> = [];
  const run = async (args: readonly string[]) => { calls.push(args); return ''; };
  return { calls, run };
}

describe('deliverOsc52Reply', () => {
  test('invokes send-keys -H, not a direct PTY write, when no directWrite is provided', async () => {
    const { calls, run } = recordingRun();
    let directWriteCalls = 0;
    await deliverOsc52Reply({
      run, target: 'main', selection: 'c', base64: 'aGk=',
    });
    expect(directWriteCalls).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.slice(0, 4)).toEqual(['send-keys', '-H', '-t', 'main']);
    const hexArgs = calls[0]!.slice(4);
    expect(hexArgs.every(a => /^[0-9a-f]{2}$/.test(a))).toBe(true);
  });

  test('hex args decode back to the expected OSC 52 response bytes', async () => {
    const { calls, run } = recordingRun();
    await deliverOsc52Reply({ run, target: 'dev', selection: 'c', base64: 'aGk=' });
    const hex = calls[0]!.slice(4);
    const decoded = hex.map(h => String.fromCharCode(parseInt(h, 16))).join('');
    expect(decoded).toBe('\x1b]52;c;aGk=\x07');
  });

  test('empty base64 still delivers a well-formed OSC 52 reply (deny path)', async () => {
    const { calls, run } = recordingRun();
    await deliverOsc52Reply({ run, target: 'main', selection: 'c', base64: '' });
    const hex = calls[0]!.slice(4);
    expect(hex.map(h => String.fromCharCode(parseInt(h, 16))).join(''))
      .toBe('\x1b]52;c;\x07');
  });

  test('directWrite shortcut (test mode) bypasses tmux entirely', async () => {
    const { calls, run } = recordingRun();
    let captured = '';
    await deliverOsc52Reply({
      run, target: 'main', selection: 'c', base64: 'b2s=',
      directWrite: (b) => { captured = b; },
    });
    expect(calls).toHaveLength(0);
    expect(captured).toBe('\x1b]52;c;b2s=\x07');
  });

  test('target string is forwarded verbatim (session, window, pane)', async () => {
    const { calls, run } = recordingRun();
    await deliverOsc52Reply({ run, target: 'dev:2.1', selection: 'c', base64: '' });
    expect(calls[0]!.slice(0, 4)).toEqual(['send-keys', '-H', '-t', 'dev:2.1']);
  });
});
```

- [ ] **Step 5: Update production call sites**

In `src/server/ws.ts`, the `replyToRead` closure (around line 303) now calls:

```ts
      await deliverOsc52Reply({
        run: opts.tmuxControl.run,
        target: lastSession,
        selection,
        base64,
        directWrite: opts.config.testMode ? (bytes) => ptyProcess.write(bytes) : undefined,
      });
```

In `src/server/http.ts`, both drop paths (around lines 395 and 507):

```ts
          await sendBytesToPane({
            run: opts.tmuxControl.run,
            target: session,
            bytes: await formatDropPasteBytes(opts, session, hit.absolutePath),
          });
```

Update `formatDropPasteBytes` (around line 73) to take `opts: HttpHandlerOptions` (so it can reach `opts.tmuxControl`) and call `getForegroundProcess(opts.tmuxControl.run, session)`.

- [ ] **Step 6: Run unit tests**

Run: `bun test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/tmux-inject.ts src/server/osc52-reply.ts src/server/ws.ts src/server/http.ts tests/unit/server/tmux-inject.test.ts tests/unit/server/osc52-reply.test.ts
git commit -m "refactor(server): tmux-inject + osc52-reply use RunCmd"
```

---

## Task 11: Convert `http.ts` `/api/sessions` + `/api/windows`

**Goal:** `/api/sessions` and `/api/windows` dispatch through `tmuxControl.run`. `/api/sessions` catches `NoControlClientError` and falls back to `execFileAsync` (cold path — no tab opened yet). `/api/windows` has no fallback (always called after a tab opens).

**Files:**
- Modify: `src/server/http.ts`

- [ ] **Step 1: Update the `/api/sessions` handler**

Replace lines 328–347 (`if (pathname === '/api/sessions') { ... }`) with:

```ts
    if (pathname === '/api/sessions') {
      if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
      let stdout: string;
      try {
        stdout = await opts.tmuxControl.run(['list-sessions', '-F', '#{session_id}:#{session_name}']);
      } catch (err) {
        if ((err as Error).name === 'NoControlClientError') {
          // Cold path: no control client yet (first page load before any
          // WS tab is open). Fall back to execFileAsync — one fork-per-op
          // here is acceptable since it's a one-time-per-boot path.
          try {
            const r = await execFileAsync(config.tmuxBin, ['list-sessions', '-F', '#{session_id}:#{session_name}']);
            stdout = r.stdout;
          } catch {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('[]');
            return;
          }
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('[]');
          return;
        }
      }
      const sessions = stdout.trim().split('\n').filter(Boolean).map((line) => {
        const [rawId, ...rest] = line.split(':');
        const name = rest.join(':');
        return { id: (rawId ?? '').replace(/^\$/, ''), name };
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(sessions));
      return;
    }
```

- [ ] **Step 2: Update the `/api/windows` handler**

Replace lines 349–368 with:

```ts
    if (pathname === '/api/windows') {
      if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
      const sess = url.searchParams.get('session') || 'main';
      try {
        const stdout = await opts.tmuxControl.run([
          'list-windows', '-t', sess, '-F',
          '#{window_index}\t#{window_name}\t#{window_active}',
        ]);
        const windows = stdout.trim().split('\n').filter(Boolean).map(line => {
          const [index, name, active] = line.split('\t');
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
```

- [ ] **Step 3: Run unit tests**

Run: `bun test`
Expected: PASS. If `tests/unit/server/http-*.test.ts` expected `execFileAsync` calls for these paths, adjust to inject a `TmuxControl` that returns the expected stdout. Mirror the pattern in `foreground-process.test.ts` — create a minimal `TmuxControl` mock via `createNullTmuxControl` + overrides, or just pass a hand-rolled object matching the interface.

- [ ] **Step 4: Commit**

```bash
git add src/server/http.ts
git commit -m "refactor(server): /api/sessions and /api/windows via TmuxControl"
```

---

## Task 12: Convert `ws.ts` session/window actions + `set-environment`

**Goal:** Replace every remaining `execFileAsync(config.tmuxBin, …)` in `ws.ts` with `opts.tmuxControl.run(…)`. Keep the `testMode` early-returns untouched (test mode never touches tmux).

**Files:**
- Modify: `src/server/ws.ts`

- [ ] **Step 1: Update `applySessionAction`**

```ts
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
```

- [ ] **Step 2: Update `applyWindowAction`**

```ts
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
```

- [ ] **Step 3: Update `applyColourVariant`**

```ts
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
  try { await run(); }
  catch { setTimeout(() => { run().catch(() => {}); }, 500); }
}
```

- [ ] **Step 4: Update `sendWindowState`**

```ts
async function sendWindowState(ws: WebSocket, sessionName: string, opts: WsServerOptions): Promise<void> {
  try {
    const [winResult, titleResult] = await Promise.allSettled([
      opts.tmuxControl.run([
        'list-windows', '-t', sessionName, '-F',
        '#{window_index}\t#{window_name}\t#{window_active}',
      ]),
      opts.tmuxControl.run(['display-message', '-t', sessionName, '-p', '#{pane_title}']),
    ]);
    const windows: WindowInfo[] = winResult.status === 'fulfilled'
      ? winResult.value.split('\n').filter(Boolean).map(line => {
          const [index, name, active] = line.split('\t');
          return { index: index!, name: name!, active: active === '1' };
        })
      : [];
    const title = titleResult.status === 'fulfilled' ? titleResult.value.trim() : undefined;
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(frameTTMessage({ session: sessionName, windows, title }));
    }
  } catch {
    if (ws.readyState === WebSocket.OPEN) ws.send(frameTTMessage({ session: sessionName }));
  }
}
```

- [ ] **Step 5: Update dispatchAction call sites + drop dead import**

Every call inside `dispatchAction` that went through `applySessionAction`/`applyWindowAction`/`applyColourVariant` previously passed `config`; pass `opts` now:

```ts
      case 'colour-variant': void applyColourVariant(lastSession, act.variant, opts); return;
      case 'window':
        void applyWindowAction(lastSession, { action: act.action, index: act.index, name: act.name }, opts)
          .then(() => sendWindowState(ws, lastSession, opts));
        return;
      case 'session':
        void applySessionAction(lastSession, { action: act.action, name: act.name }, opts);
        return;
```

Drop the now-unused `execFileAsync` import at the top of `ws.ts`:

```ts
// delete: import { execFileAsync } from './exec.js';
```

(`handleConnection`'s signature was already changed to `(ws, req, opts)` in Task 6, so nothing further is required there.)

- [ ] **Step 6: Run tests**

Run: `bun test`
Expected: PASS. Fix any lingering references to `execFileAsync` or the old call-site signatures.

Run: `bunx playwright test`
Expected: PASS (e2e uses `--test` mode; TmuxControl is the null impl).

- [ ] **Step 7: Commit**

```bash
git add src/server/ws.ts
git commit -m "refactor(server): session/window/set-env actions via TmuxControl"
```

---

## Task 13: E2E — notification-driven push against real tmux

**Goal:** End-to-end test that proves `\x00TT:session` fires when a rename happens outside tmux-web. This is the user-visible win the spec promises.

**Files:**
- Create: `tests/e2e/control-mode-notifications.spec.ts`

- [ ] **Step 1: Write the test**

```ts
import { test, expect } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, killServer } from './helpers.js';

/** Boot a standalone tmux server on a scratch socket for this test,
 *  so we never touch the developer's real tmux session state. */
function bootTmux(): { sock: string; tmux: (args: string[]) => string } {
  const sockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-ctl-e2e-'));
  const sock = path.join(sockDir, 'sock');
  const tmux = (args: string[]) => execFileSync('tmux', ['-S', sock, ...args], { encoding: 'utf8' });
  tmux(['new-session', '-d', '-s', 'e2e-main', 'cat']);
  return { sock, tmux };
}

test('rename-session emits \\x00TT:session push to attached WS', async ({ page }) => {
  const { sock, tmux } = bootTmux();
  // Our server needs to attach to the same tmux socket. tmux-web uses
  // `tmux` bare unless --tmux is given; stub a wrapper that fixes -S.
  const wrapperDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-tmux-wrap-'));
  const wrapper = path.join(wrapperDir, 'tmux');
  fs.writeFileSync(wrapper, `#!/usr/bin/env bash\nexec tmux -S ${sock} "$@"\n`, { mode: 0o755 });

  const server = await startServer('bun', [
    'src/server/index.ts',
    '--listen', '127.0.0.1:14231',
    '--no-auth', '--no-tls',
    '--tmux', wrapper,
  ]);
  try {
    // Navigate to the e2e-main session; this opens a WS, which triggers
    // attachSession → the control client joins the same tmux server.
    const events: string[] = [];
    page.on('websocket', (ws) => {
      ws.on('framereceived', (ev) => {
        const payload = typeof ev.payload === 'string' ? ev.payload : ev.payload.toString('utf8');
        if (payload.startsWith('\x00TT:')) events.push(payload);
      });
    });
    await page.goto('http://127.0.0.1:14231/e2e-main');
    await page.waitForLoadState('networkidle');

    // Give the control client a beat to attach.
    await new Promise(r => setTimeout(r, 250));
    const before = events.length;

    // Rename the session from outside tmux-web. tmux fires
    // %session-renamed → primary forwards → ws broadcast.
    tmux(['rename-session', '-t', 'e2e-main', 'e2e-renamed']);

    // Expect at least one new \x00TT:session payload within 500ms.
    await expect.poll(() => events.length > before, { timeout: 500 }).toBe(true);
    const msg = events[events.length - 1]!;
    expect(msg).toMatch(/^\x00TT:.*"session"/);
  } finally {
    killServer(server);
    try { tmux(['kill-server']); } catch { /* already gone */ }
  }
});
```

- [ ] **Step 2: Run the test**

Run: `bunx playwright test tests/e2e/control-mode-notifications.spec.ts`
Expected: PASS.

If tmux isn't available on the test host, skip with `test.skip(!hasTmux, ...)` — add a `hasTmux` check:

```ts
const hasTmux = (() => { try { execFileSync('tmux', ['-V']); return true; } catch { return false; } })();
test.skip(!hasTmux, 'tmux not available');
```

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/control-mode-notifications.spec.ts
git commit -m "test(e2e): rename-session triggers %-event push"
```

---

## Task 14: E2E — window-size negotiation regression guard

**Goal:** Prove the control client does NOT shrink the session. Opens a 200×50 tab, attaches, verifies xterm dimensions are still 200×50.

**Files:**
- Create: `tests/e2e/control-mode-window-size.spec.ts`

- [ ] **Step 1: Write the test**

```ts
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, killServer } from './helpers.js';

const hasTmux = (() => { try { execFileSync('tmux', ['-V']); return true; } catch { return false; } })();
test.skip(!hasTmux, 'tmux not available');

test('attached control client does not shrink session below display size', async ({ page }) => {
  const sockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-ctl-size-'));
  const sock = path.join(sockDir, 'sock');
  const tmux = (args: string[]) => execFileSync('tmux', ['-S', sock, ...args], { encoding: 'utf8' });
  tmux(['new-session', '-d', '-s', 'sz', 'cat']);

  const wrapperDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-sz-wrap-'));
  const wrapper = path.join(wrapperDir, 'tmux');
  fs.writeFileSync(wrapper, `#!/usr/bin/env bash\nexec tmux -S ${sock} "$@"\n`, { mode: 0o755 });

  const server = await startServer('bun', [
    'src/server/index.ts',
    '--listen', '127.0.0.1:14232',
    '--no-auth', '--no-tls',
    '--tmux', wrapper,
  ]);
  try {
    await page.setViewportSize({ width: 2400, height: 1200 });
    await page.goto('http://127.0.0.1:14232/sz');
    await page.waitForLoadState('networkidle');
    // Give attach + refresh-client a beat.
    await new Promise(r => setTimeout(r, 500));

    const size = tmux(['display-message', '-p', '-t', 'sz', '#{window_width}x#{window_height}']).trim();
    const [w, h] = size.split('x').map(Number);
    // The display client should drive the size. Confirm it's not the
    // control-client default (80x24) and not the old smallest-wins
    // collapse to 80.
    expect(w!).toBeGreaterThan(80);
    expect(h!).toBeGreaterThan(24);
  } finally {
    killServer(server);
    try { tmux(['kill-server']); } catch {}
  }
});
```

- [ ] **Step 2: Run the test**

Run: `bunx playwright test tests/e2e/control-mode-window-size.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/control-mode-window-size.spec.ts
git commit -m "test(e2e): window-size regression guard for control client"
```

---

## Task 15: Final sweep — dead code, import hygiene, verify full suite

**Goal:** Remove dead imports, confirm `exec.ts` is still referenced by its legitimate callers, run the full suite green.

**Files:**
- Modify: various (import pruning only)

- [ ] **Step 1: Search for dead imports**

Run: `grep -rn "execFileAsync" src/server/`
Expected callers after this plan: `src/server/http.ts` (cold-path fallback for `/api/sessions`), `src/server/exec.ts` (definition). No other uses in server code.

If other files still import `execFileAsync` without using it, delete the import.

- [ ] **Step 2: Confirm `exec.ts` is still referenced**

Run: `grep -rn "from './exec" src/server/ && grep -rn "from './exec" tests/`
Expected: at minimum `http.ts` imports `execFileAsync`, `tests/unit/server/exec.test.ts` imports it. Non-tmux callers (`tls.ts`, `file-drop.ts`, `index.ts`) currently use `Bun.spawnSync` / `execFileSync`, not this helper — that's fine, it's a tmux-specific utility, and keeping it for the cold-path fallback is sufficient justification.

- [ ] **Step 3: Run full test suite**

Run: `bun test`
Expected: PASS.

Run: `bunx playwright test`
Expected: PASS.

- [ ] **Step 4: Run `act` verify step (per CLAUDE.md)**

Do NOT push a tag. This is a sanity check for the release pipeline.

Run: `act -j build --matrix name:linux-x64 -P ubuntu-latest=catthehacker/ubuntu:act-latest`
Expected: unit tests + `verify-vendor-xterm.ts` pass. The upload-artifact step failing is expected.

- [ ] **Step 5: Manual smoke against a real tmux instance**

Run: `bun src/server/index.ts --listen 127.0.0.1:4022 --no-auth --no-tls`

In a browser, open `http://127.0.0.1:4022/main`. In another terminal run:

```bash
tmux rename-session -t main foo
```

Expected: the session label in the tmux-web toolbar updates to `foo` within ~500 ms, without the user typing anything in the pane.

```bash
tmux new-window -t foo
tmux rename-window -t foo:1 hello
tmux kill-window -t foo:1
```

Expected: the window tabs in the toolbar reflect each change live.

- [ ] **Step 6: Commit any cleanups**

```bash
git add -u
git commit -m "chore: prune dead imports after control-mode migration" || echo "nothing to clean"
```

---

## Final Checklist

- [ ] `bun test` passes.
- [ ] `bunx playwright test` passes.
- [ ] `act -j build --matrix name:linux-x64 -P ubuntu-latest=catthehacker/ubuntu:act-latest` passes up to (and excluding) upload-artifact.
- [ ] Manual smoke: live session / window rename propagates to the browser without OSC title activity in the pane.
- [ ] `grep -rn "execFileAsync(config.tmuxBin" src/server/` returns ONLY the `/api/sessions` cold-path fallback in `http.ts`.
- [ ] `grep -rn "Bun.spawnSync(\[config.tmuxBin" src/server/` returns ONLY the startup `-V` probe and `source-file` reload in `index.ts`.
- [ ] No changes under `src/client/`.
