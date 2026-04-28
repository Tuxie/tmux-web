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
