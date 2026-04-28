import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { buildStdioAgentLaunchOptions, parseConfig } from '../../../src/server/index.js';
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

  test('--stdio-agent parse result has a launch path instead of falling through to missing config', () => {
    const parsed = parseConfig(['--stdio-agent']);
    const launch = buildStdioAgentLaunchOptions(parsed, { runtimeBaseDir: '/run/user/1000/tmux-web' });

    expect(parsed.stdioAgent).toBe(true);
    expect(parsed.config).toBeNull();
    expect(launch).toEqual({
      tmuxBin: 'tmux',
      tmuxConfPath: '/run/user/1000/tmux-web/tmux.conf',
    });
  });
});
