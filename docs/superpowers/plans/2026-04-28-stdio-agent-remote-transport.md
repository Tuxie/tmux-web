# Stdio Agent Remote Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `tmux-web --stdio-agent` and a local remote-host transport so many browser tabs/sessions can share one SSH stdio connection per remote host alias.

**Architecture:** Keep the browser-facing WebSocket protocol unchanged. Add a framed stdio protocol under the server, a remote agent process that owns remote tmux PTY/control clients, and a local agent manager that maps each browser WebSocket to one logical remote channel. Normal local tmux behavior remains the default path.

**Tech Stack:** Bun, TypeScript, OpenSSH via `Bun.spawn`, existing `spawnPty`, existing `TmuxControl`, existing WebSocket handler/router, Bun unit tests.

---

## File Structure

- Create `src/server/stdio-protocol.ts`
  - Binary length-prefixed frame encoder/decoder.
  - JSON payload validation for host/channel frames.
  - Base64 helpers for PTY byte payloads.
- Create `tests/unit/server/stdio-protocol.test.ts`
  - Partial reads, multiple frames per chunk, invalid frame handling, base64 byte round trip.
- Create `src/server/remote-route.ts`
  - Parse `/r/<host>/<session>` path information.
  - Validate conservative SSH host aliases.
  - Build WebSocket remote query parameters.
- Create `tests/unit/server/remote-route.test.ts`
  - Host validation, session extraction, rejection cases.
- Modify `src/server/index.ts`
  - Add `--stdio-agent` parse path.
  - Start stdio agent instead of HTTP server when present.
  - Add help text.
- Modify `tests/unit/server/config.test.ts`
  - Cover `--stdio-agent`.
- Create `src/server/stdio-agent.ts`
  - Remote agent runtime over stdin/stdout.
  - Channel table, PTY lifecycle, control-client refs, and channel frame handling.
- Create `tests/unit/server/stdio-agent.test.ts`
  - Injectable fake PTY/control/frame streams for multi-channel behavior.
- Create `src/server/remote-agent-manager.ts`
  - Local process manager for one SSH agent per host alias.
  - Handshake, channel open/close, idle timeout, shutdown.
- Create `tests/unit/server/remote-agent-manager.test.ts`
  - Fake process transport, handshake, multiplexing, idle cleanup, host-scoped errors.
- Create `src/server/terminal-transport.ts`
  - Server-side interface that lets WebSocket code talk to either local tmux or remote agent channels.
- Modify `src/server/ws.ts`
  - Preserve existing local path.
  - Route `/r/<host>/<session>` WebSockets to remote transport.
  - Close remote managers on handler shutdown.
- Modify `src/client/connection.ts`
  - Include remote host information in WebSocket URL when current page path starts with `/r/<host>/`.
- Add/modify tests:
  - `tests/unit/client/connection.test.ts`
  - `tests/unit/server/ws-integration.test.ts`
  - `tests/unit/server/ws-handle-connection.test.ts` only if remote WebSocket integration needs existing helpers.
- Modify `AGENTS.md` only if the implemented CLI/user surface differs from current documented options.

---

## Task 1: Stdio Frame Protocol

**Files:**
- Create: `src/server/stdio-protocol.ts`
- Test: `tests/unit/server/stdio-protocol.test.ts`

- [ ] **Step 1: Write failing protocol tests**

Create `tests/unit/server/stdio-protocol.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import {
  decodeFramePayload,
  encodeFrame,
  encodePtyBytes,
  FrameDecoder,
  type StdioFrame,
} from '../../../src/server/stdio-protocol.js';

describe('stdio protocol framing', () => {
  test('encodes one JSON frame with uint32_be length prefix', () => {
    const frame: StdioFrame = { v: 1, type: 'hello' };
    const encoded = encodeFrame(frame);
    expect(encoded.readUInt32BE(0)).toBe(encoded.length - 4);
    expect(decodeFramePayload(encoded.subarray(4))).toEqual(frame);
  });

  test('decoder handles partial reads', () => {
    const decoder = new FrameDecoder();
    const encoded = encodeFrame({ v: 1, type: 'hello' });
    expect(decoder.push(encoded.subarray(0, 2))).toEqual([]);
    expect(decoder.push(encoded.subarray(2))).toEqual([{ v: 1, type: 'hello' }]);
  });

  test('decoder handles multiple frames in one chunk', () => {
    const decoder = new FrameDecoder();
    const chunk = Buffer.concat([
      encodeFrame({ v: 1, type: 'hello' }),
      encodeFrame({ v: 1, type: 'hello-ok', agentVersion: '1.10.4' }),
    ]);
    expect(decoder.push(chunk)).toEqual([
      { v: 1, type: 'hello' },
      { v: 1, type: 'hello-ok', agentVersion: '1.10.4' },
    ]);
  });

  test('pty bytes round trip through base64 payload', () => {
    const bytes = Buffer.from([0, 1, 2, 255]);
    const frame = encodePtyBytes('c1', bytes);
    expect(frame).toEqual({
      v: 1,
      type: 'pty-out',
      channelId: 'c1',
      data: 'AAEC/w==',
    });
  });

  test('oversized frame throws before allocation grows unbounded', () => {
    const decoder = new FrameDecoder({ maxFrameBytes: 8 });
    const encoded = encodeFrame({ v: 1, type: 'hello' });
    expect(() => decoder.push(encoded)).toThrow(/frame too large/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bun test tests/unit/server/stdio-protocol.test.ts
```

Expected: fail because `src/server/stdio-protocol.ts` does not exist.

- [ ] **Step 3: Implement frame protocol**

Create `src/server/stdio-protocol.ts` with these exported shapes:

```ts
export const STDIO_PROTOCOL_VERSION = 1;
export const DEFAULT_MAX_FRAME_BYTES = 4 * 1024 * 1024;

export type StdioFrame =
  | { v: 1; type: 'hello' }
  | { v: 1; type: 'hello-ok'; agentVersion: string }
  | { v: 1; type: 'host-error'; code: string; message: string }
  | { v: 1; type: 'shutdown' }
  | { v: 1; type: 'open'; channelId: string; session: string; cols: number; rows: number }
  | { v: 1; type: 'open-ok'; channelId: string; session: string }
  | { v: 1; type: 'pty-in' | 'pty-out'; channelId: string; data: string }
  | { v: 1; type: 'resize'; channelId: string; cols: number; rows: number }
  | { v: 1; type: 'client-msg'; channelId: string; data: string }
  | { v: 1; type: 'server-msg'; channelId: string; data: unknown }
  | { v: 1; type: 'close'; channelId: string; reason?: string }
  | { v: 1; type: 'channel-error'; channelId: string; code: string; message: string };

export function encodeFrame(frame: StdioFrame): Buffer {
  const payload = Buffer.from(JSON.stringify(frame), 'utf8');
  const out = Buffer.allocUnsafe(4 + payload.length);
  out.writeUInt32BE(payload.length, 0);
  payload.copy(out, 4);
  return out;
}

export function decodeFramePayload(payload: Buffer): StdioFrame {
  const parsed = JSON.parse(payload.toString('utf8'));
  if (!parsed || parsed.v !== 1 || typeof parsed.type !== 'string') {
    throw new Error('invalid stdio frame');
  }
  return parsed as StdioFrame;
}

export function encodePtyBytes(
  channelId: string,
  bytes: Buffer | Uint8Array,
  type: 'pty-in' | 'pty-out' = 'pty-out',
): StdioFrame {
  return { v: 1, type, channelId, data: Buffer.from(bytes).toString('base64') };
}

export function decodePtyBytes(frame: Extract<StdioFrame, { type: 'pty-in' | 'pty-out' }>): Buffer {
  return Buffer.from(frame.data, 'base64');
}

export class FrameDecoder {
  private buf = Buffer.alloc(0);
  private maxFrameBytes: number;

  constructor(opts: { maxFrameBytes?: number } = {}) {
    this.maxFrameBytes = opts.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES;
  }

  push(chunk: Buffer | Uint8Array): StdioFrame[] {
    this.buf = Buffer.concat([this.buf, Buffer.from(chunk)]);
    const out: StdioFrame[] = [];
    while (this.buf.length >= 4) {
      const len = this.buf.readUInt32BE(0);
      if (len > this.maxFrameBytes) throw new Error(`frame too large: ${len}`);
      if (this.buf.length < 4 + len) break;
      const payload = this.buf.subarray(4, 4 + len);
      out.push(decodeFramePayload(payload));
      this.buf = this.buf.subarray(4 + len);
    }
    return out;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
bun test tests/unit/server/stdio-protocol.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/stdio-protocol.ts tests/unit/server/stdio-protocol.test.ts
git commit -m "Add stdio agent frame protocol"
```

---

## Task 2: Remote URL and CLI Surface

**Files:**
- Create: `src/server/remote-route.ts`
- Test: `tests/unit/server/remote-route.test.ts`
- Modify: `src/server/index.ts`
- Test: `tests/unit/server/config.test.ts`

- [ ] **Step 1: Write failing route tests**

Create `tests/unit/server/remote-route.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import {
  buildRemoteWsParams,
  isValidRemoteHostAlias,
  parseRemotePath,
} from '../../../src/server/remote-route.js';

describe('remote route parsing', () => {
  test('recognises /r/<host>/<session>', () => {
    expect(parseRemotePath('/r/prod/main')).toEqual({ host: 'prod', session: 'main' });
    expect(parseRemotePath('/r/laptop/dev%20work')).toEqual({ host: 'laptop', session: 'dev%20work' });
  });

  test('rejects non-remote paths', () => {
    expect(parseRemotePath('/main')).toBeNull();
    expect(parseRemotePath('/ws')).toBeNull();
  });

  test('host aliases are conservative and slash-free', () => {
    expect(isValidRemoteHostAlias('prod')).toBe(true);
    expect(isValidRemoteHostAlias('prod.example.com')).toBe(true);
    expect(isValidRemoteHostAlias('user@host')).toBe(false);
    expect(isValidRemoteHostAlias('../host')).toBe(false);
    expect(isValidRemoteHostAlias('host;rm')).toBe(false);
  });

  test('buildRemoteWsParams preserves host and sanitized session intent', () => {
    expect(buildRemoteWsParams('/r/prod/main')).toEqual({ remoteHost: 'prod', session: 'main' });
  });
});
```

- [ ] **Step 2: Add failing CLI parse test**

Append to `tests/unit/server/config.test.ts`:

```ts
test('--stdio-agent short-circuits parsing with stdioAgent:true', () => {
  const r = parseConfig(['--stdio-agent']);
  expect(r.stdioAgent).toBe(true);
  expect(r.config).toBeNull();
});
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
bun test tests/unit/server/remote-route.test.ts tests/unit/server/config.test.ts
```

Expected: fail because route helpers and `stdioAgent` parse result do not exist.

- [ ] **Step 4: Implement route helpers**

Create `src/server/remote-route.ts`:

```ts
export interface RemoteRoute {
  host: string;
  session: string;
}

const HOST_RE = /^[A-Za-z0-9._-]+$/;

export function isValidRemoteHostAlias(host: string): boolean {
  return host.length > 0 && host.length <= 255 && HOST_RE.test(host);
}

export function parseRemotePath(pathname: string): RemoteRoute | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== 'r' || parts.length < 3) return null;
  const host = parts[1]!;
  if (!isValidRemoteHostAlias(host)) return null;
  return { host, session: parts.slice(2).join('/') || 'main' };
}

export function buildRemoteWsParams(pathname: string): { remoteHost: string; session: string } | null {
  const parsed = parseRemotePath(pathname);
  return parsed ? { remoteHost: parsed.host, session: parsed.session } : null;
}
```

- [ ] **Step 5: Implement CLI parse field**

In `src/server/index.ts`, extend `ConfigResult`:

```ts
export interface ConfigResult {
  config: ServerConfig | null;
  host: string;
  port: number;
  help?: boolean;
  version?: boolean;
  reset?: boolean;
  stdioAgent?: boolean;
  resetTls?: boolean;
  resetAuth?: { username: string; password: string | undefined };
}
```

Add the parse option:

```ts
'stdio-agent': { type: 'boolean', default: false },
```

After help/version handling and before normal config creation:

```ts
if (args['stdio-agent']) return { config: null, host: '', port: 0, stdioAgent: true };
```

Add help text:

```text
      --stdio-agent             Run stdio remote-agent mode instead of HTTP server
```

- [ ] **Step 6: Run tests to verify pass**

Run:

```bash
bun test tests/unit/server/remote-route.test.ts tests/unit/server/config.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add src/server/remote-route.ts tests/unit/server/remote-route.test.ts src/server/index.ts tests/unit/server/config.test.ts
git commit -m "Add remote route and stdio-agent CLI surface"
```

---

## Task 3: Remote Agent Manager

**Files:**
- Create: `src/server/remote-agent-manager.ts`
- Test: `tests/unit/server/remote-agent-manager.test.ts`

- [ ] **Step 1: Write failing manager tests**

Create `tests/unit/server/remote-agent-manager.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { RemoteAgentManager } from '../../../src/server/remote-agent-manager.js';
import { encodeFrame, FrameDecoder, type StdioFrame } from '../../../src/server/stdio-protocol.js';

class FakeProc extends EventEmitter {
  writes: Buffer[] = [];
  stdout = new EventEmitter();
  stdin = { write: (b: Buffer) => { this.writes.push(Buffer.from(b)); return true; }, end: () => {} };
  exited: Promise<void>;
  private exit!: () => void;

  constructor() {
    super();
    this.exited = new Promise(resolve => { this.exit = resolve; });
  }

  emitFrame(frame: StdioFrame) {
    this.stdout.emit('data', encodeFrame(frame));
  }

  kill() { this.exit(); }
}

function collectWrites(proc: FakeProc): StdioFrame[] {
  const decoder = new FrameDecoder();
  return proc.writes.flatMap(w => decoder.push(w));
}

describe('RemoteAgentManager', () => {
  test('starts one ssh process per host and handshakes once', async () => {
    const procs: FakeProc[] = [];
    const mgr = new RemoteAgentManager({
      spawn: (_host) => { const p = new FakeProc(); procs.push(p); return p as any; },
      idleTimeoutMs: 20,
    });
    const ready = mgr.getHost('prod');
    expect(procs).toHaveLength(1);
    expect(collectWrites(procs[0]!)).toEqual([{ v: 1, type: 'hello' }]);
    procs[0]!.emitFrame({ v: 1, type: 'hello-ok', agentVersion: 'test' });
    await ready;
    await mgr.getHost('prod');
    expect(procs).toHaveLength(1);
    await mgr.close();
  });

  test('openChannel sends open and resolves after open-ok', async () => {
    const proc = new FakeProc();
    const mgr = new RemoteAgentManager({
      spawn: () => proc as any,
      idleTimeoutMs: 20,
    });
    const host = mgr.getHost('prod');
    proc.emitFrame({ v: 1, type: 'hello-ok', agentVersion: 'test' });
    const agent = await host;
    const opened = agent.openChannel({ session: 'main', cols: 80, rows: 24 });
    const open = collectWrites(proc).find(f => f.type === 'open') as any;
    expect(open.session).toBe('main');
    proc.emitFrame({ v: 1, type: 'open-ok', channelId: open.channelId, session: 'main' });
    const channel = await opened;
    channel.sendPty('x');
    expect(collectWrites(proc).some(f => f.type === 'pty-in' && (f as any).channelId === open.channelId)).toBe(true);
    await mgr.close();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
bun test tests/unit/server/remote-agent-manager.test.ts
```

Expected: fail because manager does not exist.

- [ ] **Step 3: Implement manager skeleton**

Create `src/server/remote-agent-manager.ts` with:

```ts
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { FrameDecoder, encodeFrame, encodePtyBytes, type StdioFrame } from './stdio-protocol.js';

export interface AgentProc {
  stdin: { write(data: Buffer): unknown; end(): unknown };
  stdout: { on(event: 'data', cb: (chunk: Buffer) => unknown): unknown };
  exited: Promise<unknown>;
  kill(): unknown;
}

export interface RemoteAgentManagerOptions {
  spawn?: (host: string) => AgentProc;
  idleTimeoutMs?: number;
}

export interface OpenChannelOptions {
  session: string;
  cols: number;
  rows: number;
}

export class RemoteChannel extends EventEmitter {
  constructor(readonly id: string, private sendFrame: (frame: StdioFrame) => void) { super(); }

  sendPty(data: string): void {
    this.sendFrame(encodePtyBytes(this.id, Buffer.from(data, 'utf8'), 'pty-in'));
  }

  resize(cols: number, rows: number): void {
    this.sendFrame({ v: 1, type: 'resize', channelId: this.id, cols, rows });
  }

  sendClientMessage(data: string): void {
    this.sendFrame({ v: 1, type: 'client-msg', channelId: this.id, data });
  }

  close(reason = 'local close'): void {
    this.sendFrame({ v: 1, type: 'close', channelId: this.id, reason });
  }
}

class RemoteHostAgent {
  private decoder = new FrameDecoder();
  private readyResolve!: () => void;
  private readyReject!: (err: unknown) => void;
  private pendingOpens = new Map<string, { channel: RemoteChannel; resolve: (c: RemoteChannel) => void; reject: (err: unknown) => void }>();
  private channels = new Map<string, RemoteChannel>();
  readonly ready: Promise<void>;

  constructor(readonly host: string, private proc: AgentProc) {
    this.ready = new Promise((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject; });
    proc.stdout.on('data', (chunk) => this.onData(Buffer.from(chunk)));
    proc.exited.then(() => this.failAll(new Error(`remote agent exited for ${host}`)));
    this.write({ v: 1, type: 'hello' });
  }

  write(frame: StdioFrame): void {
    this.proc.stdin.write(encodeFrame(frame));
  }

  openChannel(opts: OpenChannelOptions): Promise<RemoteChannel> {
    const channelId = randomUUID();
    const channel = new RemoteChannel(channelId, f => this.write(f));
    this.write({ v: 1, type: 'open', channelId, session: opts.session, cols: opts.cols, rows: opts.rows });
    return new Promise((resolve, reject) => {
      this.pendingOpens.set(channelId, { channel, resolve, reject });
    });
  }

  close(): void {
    this.write({ v: 1, type: 'shutdown' });
    this.proc.kill();
  }

  private onData(chunk: Buffer): void {
    for (const frame of this.decoder.push(chunk)) this.onFrame(frame);
  }

  private onFrame(frame: StdioFrame): void {
    if (frame.type === 'hello-ok') { this.readyResolve(); return; }
    if (frame.type === 'host-error') { this.readyReject(new Error(frame.message)); return; }
    if ('channelId' in frame) {
      if (frame.type === 'open-ok') {
        const pending = this.pendingOpens.get(frame.channelId);
        if (!pending) return;
        this.pendingOpens.delete(frame.channelId);
        this.channels.set(frame.channelId, pending.channel);
        pending.resolve(pending.channel);
        return;
      }
      const channel = this.channels.get(frame.channelId);
      if (channel) channel.emit('frame', frame);
    }
  }

  private failAll(err: Error): void {
    this.readyReject(err);
    for (const p of this.pendingOpens.values()) p.reject(err);
    for (const c of this.channels.values()) c.emit('error', err);
  }
}

export class RemoteAgentManager {
  private agents = new Map<string, RemoteHostAgent>();
  private idleTimeoutMs: number;
  private spawn: (host: string) => AgentProc;

  constructor(opts: RemoteAgentManagerOptions = {}) {
    this.idleTimeoutMs = opts.idleTimeoutMs ?? 60_000;
    this.spawn = opts.spawn ?? ((host) => {
      const proc = Bun.spawn(['ssh', '-T', host, 'tmux-web', '--stdio-agent'], {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      });
      return {
        stdin: { write: (data) => proc.stdin.write(data), end: () => proc.stdin.end() },
        stdout: { on: (_event, cb) => {
          const reader = proc.stdout.getReader();
          void (async () => {
            while (true) {
              const r = await reader.read();
              if (r.done) break;
              cb(Buffer.from(r.value));
            }
          })();
        } },
        exited: proc.exited,
        kill: () => proc.kill(),
      };
    });
  }

  async getHost(host: string): Promise<RemoteHostAgent> {
    let agent = this.agents.get(host);
    if (!agent) {
      agent = new RemoteHostAgent(host, this.spawn(host));
      this.agents.set(host, agent);
    }
    await agent.ready;
    return agent;
  }

  async close(): Promise<void> {
    for (const agent of this.agents.values()) agent.close();
    this.agents.clear();
    void this.idleTimeoutMs;
  }
}
```

This task delivers the reusable process/handshake/channel-open foundation. Later tasks extend the same objects with WebSocket frame forwarding and idle cleanup.

- [ ] **Step 4: Run test to verify pass**

Run:

```bash
bun test tests/unit/server/remote-agent-manager.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/remote-agent-manager.ts tests/unit/server/remote-agent-manager.test.ts
git commit -m "Add remote stdio agent manager"
```

---

## Task 4: Stdio Agent Runtime

**Files:**
- Create: `src/server/stdio-agent.ts`
- Test: `tests/unit/server/stdio-agent.test.ts`
- Modify: `src/server/index.ts`

- [ ] **Step 1: Write failing stdio-agent tests**

Create `tests/unit/server/stdio-agent.test.ts` with fake streams and fake PTY:

```ts
import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { runStdioAgent, type AgentPtyFactory } from '../../../src/server/stdio-agent.js';
import { encodeFrame, FrameDecoder, type StdioFrame } from '../../../src/server/stdio-protocol.js';
import { createNullTmuxControl } from '../../../src/server/tmux-control.js';

class FakeIo {
  input = new EventEmitter();
  writes: Buffer[] = [];
  write = (buf: Buffer) => { this.writes.push(Buffer.from(buf)); };
  emitFrame(frame: StdioFrame) { this.input.emit('data', encodeFrame(frame)); }
  frames(): StdioFrame[] {
    const decoder = new FrameDecoder();
    return this.writes.flatMap(w => decoder.push(w));
  }
}

describe('stdio agent runtime', () => {
  test('handshakes and opens two independent channels', async () => {
    const io = new FakeIo();
    const ptys: any[] = [];
    const makePty: AgentPtyFactory = (opts) => {
      const pty = {
        session: opts.session,
        writes: [] as string[],
        onDataCb: (_data: string) => {},
        onExitCb: () => {},
        onData(cb: (data: string) => void) { this.onDataCb = cb; },
        onExit(cb: () => void) { this.onExitCb = cb; },
        write(data: string) { this.writes.push(data); },
        resize() {},
        kill() {},
      };
      ptys.push(pty);
      return pty as any;
    };

    const agent = runStdioAgent({
      input: io.input as any,
      write: io.write,
      makePty,
      tmuxControl: createNullTmuxControl(),
      version: 'test',
    });

    io.emitFrame({ v: 1, type: 'hello' });
    expect(io.frames()).toContainEqual({ v: 1, type: 'hello-ok', agentVersion: 'test' });

    io.emitFrame({ v: 1, type: 'open', channelId: 'c1', session: 'main', cols: 80, rows: 24 });
    io.emitFrame({ v: 1, type: 'open', channelId: 'c2', session: 'dev', cols: 100, rows: 30 });
    expect(ptys.map(p => p.session)).toEqual(['main', 'dev']);
    expect(io.frames()).toContainEqual({ v: 1, type: 'open-ok', channelId: 'c1', session: 'main' });
    expect(io.frames()).toContainEqual({ v: 1, type: 'open-ok', channelId: 'c2', session: 'dev' });

    io.emitFrame({ v: 1, type: 'pty-in', channelId: 'c2', data: Buffer.from('x').toString('base64') });
    expect(ptys[1]!.writes).toEqual(['x']);
    expect(ptys[0]!.writes).toEqual([]);

    agent.close();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
bun test tests/unit/server/stdio-agent.test.ts
```

Expected: fail because `stdio-agent.ts` does not exist.

- [ ] **Step 3: Implement agent runtime**

Create `src/server/stdio-agent.ts` with:

```ts
import { EventEmitter } from 'node:events';
import { buildPtyCommand, buildPtyEnv, sanitizeSession, spawnPty, type BunPty } from './pty.js';
import { FrameDecoder, decodePtyBytes, encodeFrame, encodePtyBytes, type StdioFrame } from './stdio-protocol.js';
import type { TmuxControl } from './tmux-control.js';

export interface AgentPtyFactoryOptions {
  session: string;
  cols: number;
  rows: number;
}

export type AgentPtyFactory = (opts: AgentPtyFactoryOptions) => BunPty;

export interface StdioAgentOptions {
  input: EventEmitter;
  write: (buf: Buffer) => unknown;
  makePty?: AgentPtyFactory;
  tmuxControl: TmuxControl;
  version: string;
  tmuxBin?: string;
  tmuxConfPath?: string;
}

interface Channel {
  id: string;
  session: string;
  pty: BunPty;
}

export function runStdioAgent(opts: StdioAgentOptions): { close: () => void } {
  const decoder = new FrameDecoder();
  const channels = new Map<string, Channel>();

  const send = (frame: StdioFrame): void => {
    opts.write(encodeFrame(frame));
  };

  const makePty = opts.makePty ?? ((p: AgentPtyFactoryOptions) => spawnPty({
    command: buildPtyCommand({
      testMode: false,
      session: p.session,
      tmuxConfPath: opts.tmuxConfPath ?? '',
      tmuxBin: opts.tmuxBin ?? 'tmux',
    }),
    env: buildPtyEnv(),
    cols: p.cols,
    rows: p.rows,
  }));

  const open = (frame: Extract<StdioFrame, { type: 'open' }>): void => {
    const session = sanitizeSession(frame.session);
    const pty = makePty({ session, cols: frame.cols, rows: frame.rows });
    const channel: Channel = { id: frame.channelId, session, pty };
    channels.set(frame.channelId, channel);
    pty.onData((data) => send(encodePtyBytes(frame.channelId, Buffer.from(data, 'utf8'), 'pty-out')));
    pty.onExit(() => send({ v: 1, type: 'server-msg', channelId: frame.channelId, data: { ptyExit: true } }));
    if (pty.spawnError) {
      send({ v: 1, type: 'channel-error', channelId: frame.channelId, code: 'pty-spawn-failed', message: pty.spawnError.message });
      return;
    }
    void opts.tmuxControl.attachSession(session, { cols: frame.cols, rows: frame.rows }).catch(() => {});
    send({ v: 1, type: 'open-ok', channelId: frame.channelId, session });
  };

  const closeChannel = (channelId: string): void => {
    const channel = channels.get(channelId);
    if (!channel) return;
    channels.delete(channelId);
    channel.pty.kill();
    opts.tmuxControl.detachSession(channel.session);
  };

  const onFrame = (frame: StdioFrame): void => {
    switch (frame.type) {
      case 'hello':
        send({ v: 1, type: 'hello-ok', agentVersion: opts.version });
        return;
      case 'open':
        open(frame);
        return;
      case 'pty-in': {
        const channel = channels.get(frame.channelId);
        if (channel) channel.pty.write(decodePtyBytes(frame).toString('utf8'));
        return;
      }
      case 'resize': {
        const channel = channels.get(frame.channelId);
        if (channel) channel.pty.resize(frame.cols, frame.rows);
        return;
      }
      case 'close':
        closeChannel(frame.channelId);
        return;
      case 'shutdown':
        for (const id of [...channels.keys()]) closeChannel(id);
        return;
    }
  };

  opts.input.on('data', (chunk: Buffer) => {
    for (const frame of decoder.push(Buffer.from(chunk))) onFrame(frame);
  });

  return {
    close: () => {
      for (const id of [...channels.keys()]) closeChannel(id);
    },
  };
}
```

- [ ] **Step 4: Wire `--stdio-agent` in `index.ts`**

Import `runStdioAgent` and `createTmuxControl`, then in `startServer()` after parseConfig:

```ts
if (stdioAgent) {
  const tmuxBin = 'tmux';
  const tmuxConfPath = path.join(resolveRuntimeBaseDir(), 'tmux.conf');
  const tmuxControl = createTmuxControl({ tmuxBin, tmuxConfPath });
  const input = new (await import('node:events')).EventEmitter();
  process.stdin.on('data', chunk => input.emit('data', chunk));
  const agent = runStdioAgent({
    input,
    write: (buf) => process.stdout.write(buf),
    tmuxControl,
    version: VERSION,
    tmuxBin,
    tmuxConfPath,
  });
  const cleanup = async () => {
    agent.close();
    await tmuxControl.close();
  };
  process.on('SIGTERM', () => { void cleanup().finally(() => process.exit(0)); });
  process.on('SIGINT', () => { void cleanup().finally(() => process.exit(0)); });
  return;
}
```

If `process.stdin` cannot be passed directly to `runStdioAgent`, add this adapter helper to `src/server/stdio-agent.ts` and use it from `index.ts`:

```ts
export function eventInputFromNodeReadable(input: NodeJS.ReadableStream): EventEmitter {
  const emitter = new EventEmitter();
  input.on('data', chunk => emitter.emit('data', Buffer.from(chunk)));
  input.on('end', () => emitter.emit('end'));
  input.on('error', err => emitter.emit('error', err));
  return emitter;
}
```

Keep stdout reserved for frames; diagnostics must go to stderr.

- [ ] **Step 5: Run tests**

Run:

```bash
bun test tests/unit/server/stdio-agent.test.ts tests/unit/server/config.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/server/stdio-agent.ts tests/unit/server/stdio-agent.test.ts src/server/index.ts tests/unit/server/config.test.ts
git commit -m "Add stdio agent runtime"
```

---

## Task 5: WebSocket Remote Transport Integration

**Files:**
- Create: `src/server/terminal-transport.ts`
- Modify: `src/server/ws.ts`
- Modify: `src/server/remote-agent-manager.ts`
- Test: `tests/unit/server/ws-integration.test.ts`

- [ ] **Step 1: Add failing WebSocket remote integration test**

Append to `tests/unit/server/ws-integration.test.ts` a test that injects a fake remote manager through `createWsHandlers` options. The test should open `/ws?remoteHost=prod&session=main&cols=80&rows=24`, assert an `openChannel` call for `prod/main`, emit remote `pty-out`, and assert the browser WS receives those bytes.

Use this shape:

```ts
test('remote ws opens remote channel and forwards pty bytes', async () => {
  const remoteEvents: any[] = [];
  const fakeChannel = new EventTarget() as any;
  fakeChannel.sendPty = (data: string) => remoteEvents.push(['pty', data]);
  fakeChannel.resize = (cols: number, rows: number) => remoteEvents.push(['resize', cols, rows]);
  fakeChannel.sendClientMessage = (data: string) => remoteEvents.push(['client', data]);
  fakeChannel.close = () => remoteEvents.push(['close']);

  const fakeRemoteManager = {
    getHost: async (host: string) => ({
      openChannel: async (opts: any) => {
        remoteEvents.push(['open', host, opts.session, opts.cols, opts.rows]);
        return fakeChannel;
      },
    }),
    close: async () => {},
  };

  h = await startTestServer({
    configOverrides: { remoteAgentManager: fakeRemoteManager } as any,
  });

  const ws = await open('/ws?remoteHost=prod&session=main&cols=80&rows=24');
  const received: string[] = [];
  ws.addEventListener('message', (ev) => received.push(String(ev.data)));
  fakeChannel.dispatchEvent(new MessageEvent('frame', {
    data: { v: 1, type: 'pty-out', channelId: 'c1', data: Buffer.from('hello').toString('base64') },
  }));
  await new Promise(r => setTimeout(r, 20));
  expect(remoteEvents).toContainEqual(['open', 'prod', 'main', 80, 24]);
  expect(received.join('')).toContain('hello');
  ws.close();
});
```

If `EventTarget` does not fit the manager’s final channel shape, use the implemented event API from Task 3. Keep the assertion: remote pty bytes must reach the browser unchanged.

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
bun test tests/unit/server/ws-integration.test.ts
```

Expected: fail because `createWsHandlers` does not accept or use a remote manager.

- [ ] **Step 3: Add terminal transport interface**

Create `src/server/terminal-transport.ts`:

```ts
import type { ServerMessage } from '../shared/types.js';

export interface TerminalTransport {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  close(): void;
}

export interface TerminalTransportCallbacks {
  onPtyData(data: string): void;
  onServerMessage(msg: ServerMessage): void;
  onExit(reason?: string): void;
  onError(message: string): void;
}
```

- [ ] **Step 4: Extend `WsServerOptions` and `WsData`**

In `src/server/ws.ts`, add optional remote manager:

```ts
remoteAgentManager?: RemoteAgentManager;
```

Add to `WsData`:

```ts
remoteHost?: string;
```

In `upgrade`, parse:

```ts
const remoteHostRaw = url.searchParams.get('remoteHost') ?? undefined;
const remoteHost = remoteHostRaw && isValidRemoteHostAlias(remoteHostRaw) ? remoteHostRaw : undefined;
```

If `remoteHostRaw` exists but validation fails, return `new Response('Invalid remote host', { status: 400 })`.

Set `remoteHost` on `data`.

- [ ] **Step 5: Open remote channel in `handleOpen`**

At the start of `handleOpen`, before local `buildPtyCommand`, branch:

```ts
if (ws.data.remoteHost) {
  void handleRemoteOpen(ws, opts, reg);
  return;
}
```

Implement `handleRemoteOpen` in `ws.ts`:

```ts
async function handleRemoteOpen(
  ws: ServerWebSocket<WsData>,
  opts: WsServerOptions,
  reg: WsRegistry,
): Promise<void> {
  const host = ws.data.remoteHost!;
  const session = ws.data.initialSession;
  try {
    const manager = opts.remoteAgentManager;
    if (!manager) throw new Error('remote agent manager unavailable');
    const agent = await manager.getHost(host);
    const channel = await agent.openChannel({ session, cols: ws.data.cols, rows: ws.data.rows });
    ws.data.state.remoteChannel = channel;
    registerWsSession(ws, session, reg);
    channel.on('frame', (frame: StdioFrame) => {
      if (ws.readyState !== WS_OPEN) return;
      if (frame.type === 'pty-out') ws.send(decodePtyBytes(frame).toString('utf8'));
      if (frame.type === 'server-msg') ws.send(frameTTMessage(frame.data as ServerMessage));
      if (frame.type === 'channel-error') ws.send(frameTTMessage({ ptyExit: true, exitCode: -1, exitReason: frame.message }));
    });
  } catch (err) {
    if (ws.readyState === WS_OPEN) {
      ws.send(frameTTMessage({ ptyExit: true, exitCode: -1, exitReason: (err as Error).message }));
      ws.close(1011, 'remote open failed');
    }
  }
}
```

Extract the existing local registry increment into a helper:

```ts
function registerWsSession(ws: ServerWebSocket<WsData>, session: string, reg: WsRegistry): void {
  reg.sessionRefs.set(session, (reg.sessionRefs.get(session) ?? 0) + 1);
  let sessionSet = reg.wsClientsBySession.get(session);
  if (!sessionSet) { sessionSet = new Set(); reg.wsClientsBySession.set(session, sessionSet); }
  sessionSet.add(ws);
  ws.data.state.sessionSet = sessionSet;
}
```

Use the helper in the existing local path.

- [ ] **Step 6: Route messages and close to remote channel**

In `handleMessage`, before `routeClientMessage`, add:

```ts
if (ws.data.state.remoteChannel) {
  const text = typeof msg === 'string' ? msg : Buffer.from(msg).toString('utf8');
  try {
    const parsed = JSON.parse(text);
    if (parsed?.type === 'resize' && typeof parsed.cols === 'number' && typeof parsed.rows === 'number') {
      ws.data.state.remoteChannel.resize(parsed.cols, parsed.rows);
      return;
    }
  } catch {
    // non-JSON is PTY input
  }
  if (text.startsWith('{')) ws.data.state.remoteChannel.sendClientMessage(text);
  else ws.data.state.remoteChannel.sendPty(text);
  return;
}
```

In `handleClose`, close remote channel and skip local PTY/control teardown:

```ts
if (state.remoteChannel) {
  state.remoteChannel.close('websocket closed');
  state.sessionSet?.delete(ws);
  return;
}
```

Make sure this does not undercount local `sessionRefs`; decrement remote refs if `registerWsSession` increments them.

- [ ] **Step 7: Run integration test**

Run:

```bash
bun test tests/unit/server/ws-integration.test.ts
```

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add src/server/terminal-transport.ts src/server/ws.ts src/server/remote-agent-manager.ts tests/unit/server/ws-integration.test.ts
git commit -m "Connect websocket sessions to remote stdio channels"
```

---

## Task 6: Client Remote WebSocket URL

**Files:**
- Modify: `src/client/connection.ts`
- Test: `tests/unit/client/connection.test.ts`

- [ ] **Step 1: Write failing client URL test**

Add to `tests/unit/client/connection.test.ts`:

```ts
test('buildWsUrl includes remoteHost from /r/<host>/<session> page path', () => {
  history.replaceState(null, '', '/r/prod/main');
  const url = buildWsUrl('main', 80, 24);
  expect(url).toContain('/ws?');
  expect(url).toContain('remoteHost=prod');
  expect(url).toContain('session=main');
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
bun test tests/unit/client/connection.test.ts
```

Expected: fail because `buildWsUrl` does not include `remoteHost`.

- [ ] **Step 3: Implement remote URL extraction**

In `src/client/connection.ts`, add:

```ts
function remoteHostFromPath(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== 'r' || !parts[1]) return null;
  return /^[A-Za-z0-9._-]+$/.test(parts[1]) ? parts[1] : null;
}
```

Modify `buildWsUrl`:

```ts
const params = new URLSearchParams({
  cols: String(cols),
  rows: String(rows),
  session,
});
const remoteHost = remoteHostFromPath(current.pathname);
if (remoteHost) params.set('remoteHost', remoteHost);
const authParam = current.searchParams.get('tw_auth');
if (authParam) params.set('tw_auth', authParam);
return `${protocol}//${auth}${location.host}/ws?${params.toString()}`;
```

Preserve existing URL userinfo behavior.

- [ ] **Step 4: Run client test**

Run:

```bash
bun test tests/unit/client/connection.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/client/connection.ts tests/unit/client/connection.test.ts
git commit -m "Route remote pages to remote websocket sessions"
```

---

## Task 7: Full Agent Message Parity

**Files:**
- Modify: `src/server/stdio-agent.ts`
- Modify: `src/server/ws.ts`
- Test: `tests/unit/server/stdio-agent.test.ts`
- Test: `tests/unit/server/ws-router.test.ts` only if routing extraction is needed.

- [ ] **Step 1: Add failing tests for `client-msg` parity**

Extend `tests/unit/server/stdio-agent.test.ts`:

```ts
test('client-msg resize and pty writes are channel-scoped', () => {
  const io = new FakeIo();
  const ptys: any[] = [];
  const makePty: AgentPtyFactory = (opts) => {
    const pty = {
      session: opts.session,
      writes: [] as string[],
      resizes: [] as Array<[number, number]>,
      onDataCb: (_data: string) => {},
      onExitCb: () => {},
      onData(cb: (data: string) => void) { this.onDataCb = cb; },
      onExit(cb: () => void) { this.onExitCb = cb; },
      write(data: string) { this.writes.push(data); },
      resize(cols: number, rows: number) { this.resizes.push([cols, rows]); },
      kill() {},
    };
    ptys.push(pty);
    return pty as any;
  };

  const agent = runStdioAgent({
    input: io.input as any,
    write: io.write,
    makePty,
    tmuxControl: createNullTmuxControl(),
    version: 'test',
  });

  io.emitFrame({ v: 1, type: 'hello' });
  io.emitFrame({ v: 1, type: 'open', channelId: 'c1', session: 'main', cols: 80, rows: 24 });
  io.emitFrame({ v: 1, type: 'open', channelId: 'c2', session: 'dev', cols: 100, rows: 30 });
  io.emitFrame({
    v: 1,
    type: 'client-msg',
    channelId: 'c2',
    data: JSON.stringify({ type: 'resize', cols: 120, rows: 40 }),
  });
  io.emitFrame({ v: 1, type: 'pty-in', channelId: 'c2', data: Buffer.from('x').toString('base64') });

  expect(ptys[0]!.resizes).toEqual([]);
  expect(ptys[1]!.resizes).toEqual([[120, 40]]);
  expect(ptys[0]!.writes).toEqual([]);
  expect(ptys[1]!.writes).toEqual(['x']);
  agent.close();
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
bun test tests/unit/server/stdio-agent.test.ts
```

Expected: fail because `client-msg` handling is incomplete.

- [ ] **Step 3: Reuse `routeClientMessage` inside stdio agent**

In `stdio-agent.ts`, import:

```ts
import { routeClientMessage, type PendingRead } from './ws-router.js';
```

Add per-channel state:

```ts
pendingReads: Map<string, PendingRead>;
```

For `client-msg`, call:

```ts
const actions = routeClientMessage(frame.data, {
  currentSession: channel.session,
  pendingReads: channel.pendingReads,
});
```

Handle at minimum:

- `pty-write`: `channel.pty.write(act.data)`
- `pty-resize`: `channel.pty.resize(act.cols, act.rows)`
- `switch-session`: perform remote switch flow or return `channel-error` if not implemented in this task
- `scrollbar`, `window`, `session`, `colour-variant`, clipboard actions: route to the same helper functions used by local WS where practical, or return `channel-error` with code `unsupported-client-action`

For this task to satisfy the spec, do not silently drop any action returned by `routeClientMessage`. Every action must either execute or emit `channel-error`.

- [ ] **Step 4: Run tests**

Run:

```bash
bun test tests/unit/server/stdio-agent.test.ts tests/unit/server/ws-router.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/stdio-agent.ts tests/unit/server/stdio-agent.test.ts
git commit -m "Route client messages inside stdio agent"
```

---

## Task 8: Session Switching Over Remote Agent

**Files:**
- Modify: `src/server/stdio-agent.ts`
- Modify: `src/server/remote-agent-manager.ts`
- Test: `tests/unit/server/stdio-agent.test.ts`
- Test: `tests/unit/server/remote-agent-manager.test.ts`

- [ ] **Step 1: Add failing session-switch test**

In `tests/unit/server/stdio-agent.test.ts`, add a test that:

- Opens channel `c1` on session `main`.
- Sends `client-msg` with `{"type":"switch-session","name":"dev"}`.
- Fake control reports success.
- Agent sends `server-msg` with `{ "session": "dev" }`.
- Old session ref is detached and new session ref is attached.

Use fake `TmuxControl` counters:

```ts
const attached: string[] = [];
const detached: string[] = [];
const tmuxControl = {
  attachSession: async (session: string) => { attached.push(session); },
  detachSession: (session: string) => { detached.push(session); },
  run: async () => '',
  on: () => () => {},
  hasSession: (session: string) => ['main', 'dev'].includes(session),
  close: async () => {},
};
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
bun test tests/unit/server/stdio-agent.test.ts
```

Expected: fail because switch-session emits unsupported error or does nothing.

- [ ] **Step 3: Implement remote session switch**

In `stdio-agent.ts`, implement:

```ts
async function switchChannelSession(channel: Channel, newSessionRaw: string): Promise<void> {
  const newSession = sanitizeSession(newSessionRaw);
  if (newSession === channel.session) {
    send({ v: 1, type: 'server-msg', channelId: channel.id, data: { session: newSession } });
    return;
  }
  await opts.tmuxControl.attachSession(newSession, channel.lastSize);
  opts.tmuxControl.detachSession(channel.session);
  channel.session = newSession;
  send({ v: 1, type: 'server-msg', channelId: channel.id, data: { session: newSession } });
}
```

If the real PTY-side verification helper from local `ws.ts` is not easily reusable yet, implement a conservative first version that sends `switch-client -t <session>` through control or direct tmux command and waits for a PTY output tick before `server-msg`. Do not acknowledge before the command succeeds.

- [ ] **Step 4: Run tests**

Run:

```bash
bun test tests/unit/server/stdio-agent.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/stdio-agent.ts tests/unit/server/stdio-agent.test.ts
git commit -m "Support session switching in stdio agent"
```

---

## Task 9: Agent Lifecycle, Idle Timeout, and Shutdown

**Files:**
- Modify: `src/server/remote-agent-manager.ts`
- Modify: `src/server/ws.ts`
- Test: `tests/unit/server/remote-agent-manager.test.ts`
- Test: `tests/unit/server/index-cleanup.test.ts` if shutdown integration needs coverage.

- [ ] **Step 1: Add failing idle timeout test**

In `tests/unit/server/remote-agent-manager.test.ts`, add:

```ts
test('host agent shuts down after last channel closes and idle timeout elapses', async () => {
  const proc = new FakeProc();
  let killed = false;
  proc.kill = () => { killed = true; };
  const mgr = new RemoteAgentManager({ spawn: () => proc as any, idleTimeoutMs: 5 });
  const agent = mgr.getHost('prod');
  proc.emitFrame({ v: 1, type: 'hello-ok', agentVersion: 'test' });
  const ready = await agent;
  const opened = ready.openChannel({ session: 'main', cols: 80, rows: 24 });
  const open = collectWrites(proc).find(f => f.type === 'open') as any;
  proc.emitFrame({ v: 1, type: 'open-ok', channelId: open.channelId, session: 'main' });
  const channel = await opened;
  channel.close();
  proc.emitFrame({ v: 1, type: 'close', channelId: open.channelId, reason: 'closed' });
  await new Promise(r => setTimeout(r, 20));
  expect(killed).toBe(true);
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
bun test tests/unit/server/remote-agent-manager.test.ts
```

Expected: fail because idle cleanup is not implemented.

- [ ] **Step 3: Implement channel ref tracking and idle shutdown**

In `RemoteHostAgent`, track active channels and emit an `idle` event when the last closes:

```ts
private activeChannelCount = 0;
```

Increment on `open-ok`, decrement on `close` frame or local `RemoteChannel.close()`. In `RemoteAgentManager`, schedule:

```ts
private scheduleIdle(host: string, agent: RemoteHostAgent): void {
  const timer = setTimeout(() => {
    if (agent.isIdle()) {
      agent.close();
      this.agents.delete(host);
    }
  }, this.idleTimeoutMs);
  agent.setIdleTimer(timer);
}
```

Cancel the timer when a new channel opens.

- [ ] **Step 4: Ensure WebSocket handler shutdown closes agents**

In `createWsHandlers(...).close`, after local PTY cleanup:

```ts
void opts.remoteAgentManager?.close();
```

If `close()` must remain synchronous, make `remoteAgentManager.close()` best-effort and do not await.

- [ ] **Step 5: Run lifecycle tests**

Run:

```bash
bun test tests/unit/server/remote-agent-manager.test.ts tests/unit/server/ws-integration.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/server/remote-agent-manager.ts src/server/ws.ts tests/unit/server/remote-agent-manager.test.ts
git commit -m "Add remote agent idle cleanup"
```

---

## Task 10: Final Verification and Documentation

**Files:**
- Modify: `AGENTS.md` only if CLI help or remote URL surface should be documented there.
- Modify: `docs/superpowers/specs/2026-04-28-stdio-agent-remote-transport-design.md` only if implementation intentionally diverged from the spec.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
bun test \
  tests/unit/server/stdio-protocol.test.ts \
  tests/unit/server/remote-route.test.ts \
  tests/unit/server/stdio-agent.test.ts \
  tests/unit/server/remote-agent-manager.test.ts \
  tests/unit/server/ws-integration.test.ts \
  tests/unit/client/connection.test.ts \
  tests/unit/server/config.test.ts
```

Expected: pass.

- [ ] **Step 2: Run full unit suite**

Run:

```bash
make test-unit
```

Expected: pass.

- [ ] **Step 3: Build**

Run:

```bash
make build
```

Expected: pass.

- [ ] **Step 4: Manual stdio smoke without SSH**

Run a valid frame through the agent and confirm the response frame is binary-framed output, not HTTP or human text:

```bash
bun -e 'import { spawn } from "node:child_process";
import { encodeFrame, FrameDecoder } from "./src/server/stdio-protocol.ts";
const child = spawn("bun", ["src/server/index.ts", "--stdio-agent"], { stdio: ["pipe", "pipe", "inherit"] });
const decoder = new FrameDecoder();
child.stdout.on("data", chunk => {
  const frames = decoder.push(chunk);
  if (frames.some(f => f.type === "hello-ok")) {
    child.kill();
    process.exit(0);
  }
});
child.stdin.write(encodeFrame({ v: 1, type: "hello" }));
setTimeout(() => process.exit(1), 2000);'
```

Expected: exit code 0.

- [ ] **Step 5: Update docs**

Add to `AGENTS.md` CLI options:

```text
    --stdio-agent                 Run stdio remote-agent mode instead of HTTP server
```

And add a short remote usage note:

```text
Remote agent mode: local tmux-web can serve `/r/<ssh-config-host>/<session>` and start
`ssh -T <ssh-config-host> tmux-web --stdio-agent`. SSH aliases are resolved by OpenSSH;
tmux-web does not store SSH credentials.
```

- [ ] **Step 6: Commit final docs**

```bash
git add AGENTS.md docs/superpowers/specs/2026-04-28-stdio-agent-remote-transport-design.md
git commit -m "Document stdio agent remote usage"
```

- [ ] **Step 7: Report verification**

Final implementation report must include:

- Commit list.
- Targeted test command result.
- `make test-unit` result.
- `make build` result.
- Any unverified manual SSH behavior.
