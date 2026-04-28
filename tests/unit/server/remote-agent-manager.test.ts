import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { RemoteAgentManager } from '../../../src/server/remote-agent-manager.js';
import { encodeFrame, FrameDecoder, type StdioFrame } from '../../../src/server/stdio-protocol.js';

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class FakeProc extends EventEmitter {
  writes: Buffer[] = [];
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  flushes = 0;
  endCalls = 0;
  killCalls = 0;
  stdin = {
    write: (b: Buffer) => { this.writes.push(Buffer.from(b)); return true; },
    flush: () => { this.flushes += 1; },
    end: () => { this.endCalls += 1; },
  };
  exited: Promise<void>;
  private exit!: () => void;

  constructor() {
    super();
    this.exited = new Promise(resolve => { this.exit = resolve; });
  }

  emitFrame(frame: StdioFrame) {
    this.stdout.emit('data', encodeFrame(frame));
  }

  emitStderr(text: string) {
    this.stderr.emit('data', Buffer.from(text));
  }

  kill() { this.killCalls += 1; this.exit(); }
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
    expect(procs[0]!.flushes).toBe(1);
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
    const flushesBeforePty = proc.flushes;
    channel.sendPty('x');
    expect(collectWrites(proc).some(f => f.type === 'pty-in' && (f as any).channelId === open.channelId)).toBe(true);
    expect(proc.flushes).toBe(flushesBeforePty + 1);
    await mgr.close();
  });

  test('evicts a host agent that exits before handshake so a later call retries', async () => {
    const procs: FakeProc[] = [];
    const mgr = new RemoteAgentManager({
      spawn: () => { const p = new FakeProc(); procs.push(p); return p as any; },
      idleTimeoutMs: 20,
    });

    const first = mgr.getHost('prod');
    procs[0]!.kill();
    await expect(first).rejects.toThrow(/agent exited/);

    const second = mgr.getHost('prod');
    expect(procs).toHaveLength(2);
    procs[1]!.emitFrame({ v: 1, type: 'hello-ok', agentVersion: 'test' });
    await second;
    await mgr.close();
  });

  test('includes ssh stderr when a host agent exits before handshake', async () => {
    const proc = new FakeProc();
    const mgr = new RemoteAgentManager({
      spawn: () => proc as any,
      idleTimeoutMs: 20,
    });

    const first = mgr.getHost('prod');
    proc.emitStderr('bash: line 1: tmux-web: command not found\n');
    proc.kill();

    await expect(first).rejects.toThrow(/tmux-web: command not found/);
    await mgr.close();
  });

  test('evicts a host agent that exits after handshake so a later call retries', async () => {
    const procs: FakeProc[] = [];
    const mgr = new RemoteAgentManager({
      spawn: () => { const p = new FakeProc(); procs.push(p); return p as any; },
      idleTimeoutMs: 20,
    });

    const first = mgr.getHost('prod');
    procs[0]!.emitFrame({ v: 1, type: 'hello-ok', agentVersion: 'test' });
    await first;
    procs[0]!.kill();
    await procs[0]!.exited;
    await Promise.resolve();

    const second = mgr.getHost('prod');
    expect(procs).toHaveLength(2);
    procs[1]!.emitFrame({ v: 1, type: 'hello-ok', agentVersion: 'test' });
    await second;
    await mgr.close();
  });

  test('evicts a host agent that reports host-error before handshake so a later call retries', async () => {
    const procs: FakeProc[] = [];
    const mgr = new RemoteAgentManager({
      spawn: () => { const p = new FakeProc(); procs.push(p); return p as any; },
      idleTimeoutMs: 20,
    });

    const first = mgr.getHost('prod');
    procs[0]!.emitFrame({ v: 1, type: 'host-error', code: 'connect', message: 'no route' });
    await expect(first).rejects.toThrow(/no route/);
    expect(procs[0]!.endCalls).toBe(1);
    expect(procs[0]!.killCalls).toBe(1);

    const second = mgr.getHost('prod');
    expect(procs).toHaveLength(2);
    procs[1]!.emitFrame({ v: 1, type: 'hello-ok', agentVersion: 'test' });
    await second;
    await mgr.close();
  });

  test('tears down and evicts a ready host agent that later reports host-error', async () => {
    const procs: FakeProc[] = [];
    const mgr = new RemoteAgentManager({
      spawn: () => { const p = new FakeProc(); procs.push(p); return p as any; },
      idleTimeoutMs: 20,
    });

    const first = mgr.getHost('prod');
    procs[0]!.emitFrame({ v: 1, type: 'hello-ok', agentVersion: 'test' });
    await first;
    procs[0]!.emitFrame({ v: 1, type: 'host-error', code: 'lost', message: 'connection lost' });
    expect(procs[0]!.endCalls).toBe(1);
    expect(procs[0]!.killCalls).toBe(1);

    const second = mgr.getHost('prod');
    expect(procs).toHaveLength(2);
    procs[1]!.emitFrame({ v: 1, type: 'hello-ok', agentVersion: 'test' });
    await second;
    await mgr.close();
  });

  test('kills an idle host agent after its last channel is remotely closed', async () => {
    const proc = new FakeProc();
    const mgr = new RemoteAgentManager({
      spawn: () => proc as any,
      idleTimeoutMs: 10,
    });

    const ready = mgr.getHost('prod');
    proc.emitFrame({ v: 1, type: 'hello-ok', agentVersion: 'test' });
    const agent = await ready;
    const opened = agent.openChannel({ session: 'main', cols: 80, rows: 24 });
    const open = collectWrites(proc).find(f => f.type === 'open') as any;
    proc.emitFrame({ v: 1, type: 'open-ok', channelId: open.channelId, session: 'main' });
    const channel = await opened;

    channel.close();
    proc.emitFrame({ v: 1, type: 'close', channelId: open.channelId, reason: 'done' });
    await delay(25);

    expect(proc.killCalls).toBe(1);
    expect(collectWrites(proc).some(f => f.type === 'shutdown')).toBe(true);
    await mgr.close();
  });

  test('kills an idle host agent after local channel close without remote echo', async () => {
    const proc = new FakeProc();
    const mgr = new RemoteAgentManager({
      spawn: () => proc as any,
      idleTimeoutMs: 10,
    });

    const ready = mgr.getHost('prod');
    proc.emitFrame({ v: 1, type: 'hello-ok', agentVersion: 'test' });
    const agent = await ready;
    const opened = agent.openChannel({ session: 'main', cols: 80, rows: 24 });
    const open = collectWrites(proc).find(f => f.type === 'open') as any;
    proc.emitFrame({ v: 1, type: 'open-ok', channelId: open.channelId, session: 'main' });
    const channel = await opened;

    channel.close();
    await delay(25);

    expect(proc.killCalls).toBe(1);
    expect(collectWrites(proc).some(f => f.type === 'shutdown')).toBe(true);
    await mgr.close();
  });

  test('ignores remote close/error after local channel close and kills idle agent once', async () => {
    const proc = new FakeProc();
    const mgr = new RemoteAgentManager({
      spawn: () => proc as any,
      idleTimeoutMs: 10,
    });

    const ready = mgr.getHost('prod');
    proc.emitFrame({ v: 1, type: 'hello-ok', agentVersion: 'test' });
    const agent = await ready;
    const opened = agent.openChannel({ session: 'main', cols: 80, rows: 24 });
    const open = collectWrites(proc).find(f => f.type === 'open') as any;
    proc.emitFrame({ v: 1, type: 'open-ok', channelId: open.channelId, session: 'main' });
    const channel = await opened;

    channel.close();
    proc.emitFrame({ v: 1, type: 'close', channelId: open.channelId, reason: 'remote echo' });
    proc.emitFrame({ v: 1, type: 'channel-error', channelId: open.channelId, code: 'late', message: 'late error' });
    await delay(25);

    expect(proc.killCalls).toBe(1);
    await mgr.close();
    expect(proc.killCalls).toBe(1);
  });

  test('cancels pending idle shutdown when a new channel opens before timeout', async () => {
    const procs: FakeProc[] = [];
    const mgr = new RemoteAgentManager({
      spawn: () => { const p = new FakeProc(); procs.push(p); return p as any; },
      idleTimeoutMs: 30,
    });

    const ready = mgr.getHost('prod');
    procs[0]!.emitFrame({ v: 1, type: 'hello-ok', agentVersion: 'test' });
    const agent = await ready;

    const firstOpened = agent.openChannel({ session: 'main', cols: 80, rows: 24 });
    const firstOpen = collectWrites(procs[0]!).find(f => f.type === 'open') as any;
    procs[0]!.emitFrame({ v: 1, type: 'open-ok', channelId: firstOpen.channelId, session: 'main' });
    const first = await firstOpened;
    first.close();
    procs[0]!.emitFrame({ v: 1, type: 'close', channelId: firstOpen.channelId, reason: 'done' });

    await delay(10);
    const secondOpened = agent.openChannel({ session: 'main', cols: 80, rows: 24 });
    const opens = collectWrites(procs[0]!).filter(f => f.type === 'open') as any[];
    const secondOpen = opens[1]!;
    expect(procs[0]!.killCalls).toBe(0);
    procs[0]!.emitFrame({ v: 1, type: 'open-ok', channelId: secondOpen.channelId, session: 'main' });
    const second = await secondOpened;

    await delay(35);
    expect(procs).toHaveLength(1);
    expect(procs[0]!.killCalls).toBe(0);

    second.close();
    procs[0]!.emitFrame({ v: 1, type: 'close', channelId: secondOpen.channelId, reason: 'done' });
    await delay(40);

    expect(procs[0]!.killCalls).toBe(1);
    await mgr.close();
  });

  test('manager close tears down agents and a later getHost spawns a new process', async () => {
    const procs: FakeProc[] = [];
    const mgr = new RemoteAgentManager({
      spawn: () => { const p = new FakeProc(); procs.push(p); return p as any; },
      idleTimeoutMs: 1000,
    });

    const ready = mgr.getHost('prod');
    procs[0]!.emitFrame({ v: 1, type: 'hello-ok', agentVersion: 'test' });
    const agent = await ready;
    const opened = agent.openChannel({ session: 'main', cols: 80, rows: 24 });
    const open = collectWrites(procs[0]!).find(f => f.type === 'open') as any;
    procs[0]!.emitFrame({ v: 1, type: 'open-ok', channelId: open.channelId, session: 'main' });
    await opened;

    await mgr.close();

    expect(procs[0]!.endCalls).toBe(1);
    expect(procs[0]!.killCalls).toBe(1);
    expect(collectWrites(procs[0]!).some(f => f.type === 'shutdown')).toBe(true);

    const next = mgr.getHost('prod');
    expect(procs).toHaveLength(2);
    procs[1]!.emitFrame({ v: 1, type: 'hello-ok', agentVersion: 'test' });
    await next;
    await mgr.close();
  });
});
