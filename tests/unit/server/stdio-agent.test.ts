import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { buildStdioAgentLaunchOptions, parseConfig } from '../../../src/server/index.js';
import { runStdioAgent, type AgentPtyFactory } from '../../../src/server/stdio-agent.js';
import { encodeFrame, FrameDecoder, type StdioFrame } from '../../../src/server/stdio-protocol.js';
import { createNullTmuxControl, type TmuxControl } from '../../../src/server/tmux-control.js';

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

function makeRecordingControl(): TmuxControl & { detached: string[] } {
  const detached: string[] = [];
  return {
    ...createNullTmuxControl(),
    detached,
    detachSession(session: string) { detached.push(session); },
  };
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

  test('fatal malformed input sends host-error and prevents later PTY output', () => {
    const io = new FakeIo();
    const control = makeRecordingControl();
    const ptys: any[] = [];
    const makePty: AgentPtyFactory = (opts) => {
      const pty = {
        session: opts.session,
        killed: 0,
        onDataCb: (_data: string) => {},
        onExitCb: () => {},
        onData(cb: (data: string) => void) { this.onDataCb = cb; },
        onExit(cb: () => void) { this.onExitCb = cb; },
        write() {},
        resize() {},
        kill() { this.killed += 1; },
      };
      ptys.push(pty);
      return pty as any;
    };

    const agent = runStdioAgent({
      input: io.input as any,
      write: io.write,
      makePty,
      tmuxControl: control,
      version: 'test',
    });

    io.emitFrame({ v: 1, type: 'open', channelId: 'c1', session: 'main', cols: 80, rows: 24 });
    io.input.emit('data', Buffer.from([0, 0, 0, 1, 0]));

    const framesAfterError = io.frames();
    expect(framesAfterError).toContainEqual({
      v: 1,
      type: 'host-error',
      code: 'invalid-frame',
      message: 'invalid stdio frame',
    });
    expect(ptys[0]!.killed).toBe(1);
    expect(control.detached).toEqual(['main']);

    ptys[0]!.onDataCb('late');
    expect(io.frames().filter(f => f.type === 'pty-out')).toEqual([]);

    agent.close();
  });

  test('PTY exit sends ptyExit then unregisters channel and detaches once', () => {
    const io = new FakeIo();
    const control = makeRecordingControl();
    const ptys: any[] = [];
    const makePty: AgentPtyFactory = (opts) => {
      const pty = {
        session: opts.session,
        writes: [] as string[],
        killed: 0,
        onDataCb: (_data: string) => {},
        onExitCb: () => {},
        onData(cb: (data: string) => void) { this.onDataCb = cb; },
        onExit(cb: () => void) { this.onExitCb = cb; },
        write(data: string) { this.writes.push(data); },
        resize() {},
        kill() { this.killed += 1; },
      };
      ptys.push(pty);
      return pty as any;
    };

    const agent = runStdioAgent({
      input: io.input as any,
      write: io.write,
      makePty,
      tmuxControl: control,
      version: 'test',
    });

    io.emitFrame({ v: 1, type: 'open', channelId: 'c1', session: 'main', cols: 80, rows: 24 });
    ptys[0]!.onExitCb();

    expect(io.frames()).toContainEqual({
      v: 1,
      type: 'server-msg',
      channelId: 'c1',
      data: { ptyExit: true },
    });
    expect(control.detached).toEqual(['main']);

    io.emitFrame({ v: 1, type: 'pty-in', channelId: 'c1', data: Buffer.from('late').toString('base64') });
    expect(ptys[0]!.writes).toEqual([]);
    expect(control.detached).toEqual(['main']);

    agent.close();
  });

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

  test('client-msg unsupported routed actions emit channel-error', () => {
    const io = new FakeIo();
    const makePty: AgentPtyFactory = (opts) => ({
      session: opts.session,
      onData() {},
      onExit() {},
      write() {},
      resize() {},
      kill() {},
    }) as any;

    const agent = runStdioAgent({
      input: io.input as any,
      write: io.write,
      makePty,
      tmuxControl: createNullTmuxControl(),
      version: 'test',
    });

    io.emitFrame({ v: 1, type: 'open', channelId: 'c1', session: 'main', cols: 80, rows: 24 });
    io.emitFrame({
      v: 1,
      type: 'client-msg',
      channelId: 'c1',
      data: JSON.stringify({ type: 'window', action: 'select', index: '1' }),
    });

    expect(io.frames()).toContainEqual({
      v: 1,
      type: 'channel-error',
      channelId: 'c1',
      code: 'unsupported-client-action',
      message: 'unsupported client action: window',
    });
    agent.close();
  });

  test('client-msg unknown JSON is routed as PTY write', () => {
    const io = new FakeIo();
    const ptys: any[] = [];
    const makePty: AgentPtyFactory = (opts) => {
      const pty = {
        session: opts.session,
        writes: [] as string[],
        onData() {},
        onExit() {},
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

    io.emitFrame({ v: 1, type: 'open', channelId: 'c1', session: 'main', cols: 80, rows: 24 });
    io.emitFrame({ v: 1, type: 'client-msg', channelId: 'c1', data: '{"x":1}' });

    expect(ptys[0]!.writes).toEqual(['{"x":1}']);
    expect(io.frames().filter(f => f.type === 'channel-error')).toEqual([]);
    agent.close();
  });

  test('--stdio-agent parse result has a launch path instead of falling through to missing config', () => {
    const parsed = parseConfig(['--stdio-agent']);
    const launch = buildStdioAgentLaunchOptions(parsed, {
      runtimeBaseDir: '/run/user/1000/tmux-web',
      projectRoot: '/repo',
      embeddedAssets: {},
      existsSync: () => false,
      mkdirSync: () => {},
      writeFileSync: () => {},
    });

    expect(parsed.stdioAgent).toBe(true);
    expect(parsed.config).toBeNull();
    expect(launch).toEqual({
      tmuxBin: 'tmux',
      tmuxConfPath: '/run/user/1000/tmux-web/tmux.conf',
    });
  });

  test('--stdio-agent launch materializes project tmux.conf into runtime dir', () => {
    const writes: Array<{ path: string; content: string }> = [];
    const mkdirs: string[] = [];
    const parsed = parseConfig(['--stdio-agent']);

    const launch = buildStdioAgentLaunchOptions(parsed, {
      runtimeBaseDir: '/run/user/1000/tmux-web',
      projectRoot: '/repo',
      embeddedAssets: {},
      existsSync: (p: string) => p === '/repo/tmux.conf',
      readFileSync: (p: string) => {
        expect(p).toBe('/repo/tmux.conf');
        return 'set -g mouse on\n';
      },
      mkdirSync: (p: string) => { mkdirs.push(p); },
      writeFileSync: (p: string, content: string) => { writes.push({ path: p, content }); },
    } as any);

    expect(launch?.tmuxConfPath).toBe('/run/user/1000/tmux-web/tmux.conf');
    expect(mkdirs).toEqual(['/run/user/1000/tmux-web']);
    expect(writes).toEqual([{
      path: '/run/user/1000/tmux-web/tmux.conf',
      content: 'set -g mouse on\n',
    }]);
  });
});
