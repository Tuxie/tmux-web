import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { RemoteAgentManager } from '../../../src/server/remote-agent-manager.js';
import { encodeFrame, FrameDecoder, type StdioFrame } from '../../../src/server/stdio-protocol.js';

class FakeProc extends EventEmitter {
  writes: Buffer[] = [];
  stdout = new EventEmitter();
  flushes = 0;
  stdin = {
    write: (b: Buffer) => { this.writes.push(Buffer.from(b)); return true; },
    flush: () => { this.flushes += 1; },
    end: () => {},
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

    const second = mgr.getHost('prod');
    expect(procs).toHaveLength(2);
    procs[1]!.emitFrame({ v: 1, type: 'hello-ok', agentVersion: 'test' });
    await second;
    await mgr.close();
  });
});
