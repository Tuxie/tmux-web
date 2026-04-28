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

async function flushAsyncWork(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
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

  test('client-msg switch-session attaches new session before detaching old session', async () => {
    const io = new FakeIo();
    const attached: Array<{ session: string; cols?: number; rows?: number }> = [];
    const detached: string[] = [];
    const events: string[] = [];
    const runCalls: string[][] = [];
    const write = (buf: Buffer) => {
      io.write(buf);
      const [frame] = new FrameDecoder().push(buf);
      if (
        frame?.type === 'server-msg'
        && typeof frame.data === 'object'
        && frame.data !== null
        && 'session' in frame.data
        && frame.data.session === 'dev'
      ) {
        events.push('ack:dev');
      }
    };
    const tmuxControl: TmuxControl = {
      ...createNullTmuxControl(),
      attachSession: async (session: string, size?: { cols: number; rows: number }) => {
        attached.push({ session, ...size });
      },
      detachSession: (session: string) => { detached.push(session); },
      run: async (args: readonly string[]) => {
        runCalls.push([...args]);
        if (args[0] === 'list-clients' && args.includes('#{client_pid}\t#{client_tty}\t#{client_name}')) {
          return '4242\t/dev/pts/fake\tclient-1\n';
        }
        if (args[0] === 'switch-client') {
          events.push(`switch:${args.join(' ')}`);
          return '';
        }
        if (args[0] === 'list-clients' && args.includes('#{client_tty}\t#{client_name}\t#{client_session}')) {
          return '/dev/pts/fake\tclient-1\tdev\n';
        }
        return '';
      },
      hasSession: (session: string) => ['main', 'dev'].includes(session),
    };
    const makePty: AgentPtyFactory = (opts) => ({
      pid: 4242,
      session: opts.session,
      onData() {},
      onExit() {},
      write() {},
      resize() {},
      kill() {},
    }) as any;

    const agent = runStdioAgent({
      input: io.input as any,
      write,
      makePty,
      tmuxControl,
      version: 'test',
    });

    io.emitFrame({ v: 1, type: 'open', channelId: 'c1', session: 'main', cols: 80, rows: 24 });
    await flushAsyncWork();
    io.emitFrame({ v: 1, type: 'resize', channelId: 'c1', cols: 100, rows: 40 });
    io.emitFrame({
      v: 1,
      type: 'client-msg',
      channelId: 'c1',
      data: JSON.stringify({ type: 'switch-session', name: 'dev' }),
    });
    await flushAsyncWork();

    expect(attached).toEqual([
      { session: 'main', cols: 80, rows: 24 },
      { session: 'dev', cols: 100, rows: 40 },
    ]);
    expect(runCalls).toContainEqual([
      'switch-client',
      '-c',
      'client-1',
      '-t',
      'dev',
    ]);
    expect(events).toEqual(['switch:switch-client -c client-1 -t dev', 'ack:dev']);
    expect(detached).toEqual(['main']);
    expect(io.frames()).toContainEqual({
      v: 1,
      type: 'server-msg',
      channelId: 'c1',
      data: { session: 'dev' },
    });
    expect(io.frames().filter(f => f.type === 'channel-error')).toEqual([]);
    agent.close();
  });

  test('client-msg switch-session failure after attach rolls back new ref without ack', async () => {
    const io = new FakeIo();
    const attached: Array<{ session: string; cols?: number; rows?: number }> = [];
    const detached: string[] = [];
    const runCalls: string[][] = [];
    const tmuxControl: TmuxControl = {
      ...createNullTmuxControl(),
      attachSession: async (session: string, size?: { cols: number; rows: number }) => {
        attached.push({ session, ...size });
      },
      detachSession: (session: string) => { detached.push(session); },
      run: async (args: readonly string[]) => {
        runCalls.push([...args]);
        if (args[0] === 'list-clients' && args.includes('#{client_pid}\t#{client_tty}\t#{client_name}')) {
          return '4242\t/dev/pts/fake\tclient-1\n';
        }
        if (args[0] === 'switch-client') {
          throw new Error('switch-client failed');
        }
        return '';
      },
      hasSession: (session: string) => ['main', 'dev'].includes(session),
    };
    const makePty: AgentPtyFactory = (opts) => ({
      pid: 4242,
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
      tmuxControl,
      version: 'test',
    });

    io.emitFrame({ v: 1, type: 'open', channelId: 'c1', session: 'main', cols: 80, rows: 24 });
    await flushAsyncWork();
    io.emitFrame({
      v: 1,
      type: 'client-msg',
      channelId: 'c1',
      data: JSON.stringify({ type: 'switch-session', name: 'dev' }),
    });
    await flushAsyncWork();

    expect(runCalls).toContainEqual([
      'switch-client',
      '-c',
      'client-1',
      '-t',
      'dev',
    ]);
    expect(attached).toEqual([
      { session: 'main', cols: 80, rows: 24 },
      { session: 'dev', cols: 80, rows: 24 },
    ]);
    expect(detached).toEqual(['dev']);
    expect(io.frames()).toContainEqual({
      v: 1,
      type: 'channel-error',
      channelId: 'c1',
      code: 'switch-session-failed',
      message: 'switch-client failed',
    });
    expect(io.frames()).not.toContainEqual({
      v: 1,
      type: 'server-msg',
      channelId: 'c1',
      data: { session: 'dev' },
    });
    agent.close();
  });

  test('client-msg switch-session fails when no tmux client PID matches channel PTY', async () => {
    const io = new FakeIo();
    const attached: Array<{ session: string; cols?: number; rows?: number }> = [];
    const detached: string[] = [];
    const runCalls: string[][] = [];
    const tmuxControl: TmuxControl = {
      ...createNullTmuxControl(),
      attachSession: async (session: string, size?: { cols: number; rows: number }) => {
        attached.push({ session, ...size });
      },
      detachSession: (session: string) => { detached.push(session); },
      run: async (args: readonly string[]) => {
        runCalls.push([...args]);
        if (args[0] === 'list-clients' && args.includes('#{client_pid}\t#{client_tty}\t#{client_name}')) {
          return '9999\t/dev/pts/other\tother\n';
        }
        if (args[0] === 'switch-client') return '';
        return '';
      },
      hasSession: (session: string) => ['main', 'dev'].includes(session),
    };
    const makePty: AgentPtyFactory = (opts) => ({
      pid: 4242,
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
      tmuxControl,
      version: 'test',
    });

    io.emitFrame({ v: 1, type: 'open', channelId: 'c1', session: 'main', cols: 80, rows: 24 });
    await flushAsyncWork();
    io.emitFrame({
      v: 1,
      type: 'client-msg',
      channelId: 'c1',
      data: JSON.stringify({ type: 'switch-session', name: 'dev' }),
    });
    await flushAsyncWork();

    expect(runCalls.filter(args => args[0] === 'switch-client')).toEqual([]);
    expect(detached).toEqual(['dev']);
    expect(io.frames()).toContainEqual({
      v: 1,
      type: 'channel-error',
      channelId: 'c1',
      code: 'switch-session-failed',
      message: 'PTY tmux client not found',
    });
    expect(io.frames()).not.toContainEqual({
      v: 1,
      type: 'server-msg',
      channelId: 'c1',
      data: { session: 'dev' },
    });
    agent.close();
  });

  test('client-msg switch-session proceeds when hasSession is false but attach succeeds', async () => {
    const io = new FakeIo();
    const attached: Array<{ session: string; cols?: number; rows?: number }> = [];
    const detached: string[] = [];
    const tmuxControl: TmuxControl = {
      ...createNullTmuxControl(),
      attachSession: async (session: string, size?: { cols: number; rows: number }) => {
        attached.push({ session, ...size });
      },
      detachSession: (session: string) => { detached.push(session); },
      run: async (args: readonly string[]) => {
        if (args[0] === 'list-clients' && args.includes('#{client_pid}\t#{client_tty}\t#{client_name}')) {
          return '4242\t/dev/pts/fake\tclient-1\n';
        }
        if (args[0] === 'switch-client') return '';
        if (args[0] === 'list-clients' && args.includes('#{client_tty}\t#{client_name}\t#{client_session}')) {
          return '/dev/pts/fake\tclient-1\tdev\n';
        }
        return '';
      },
      hasSession: () => false,
    };
    const makePty: AgentPtyFactory = (opts) => ({
      pid: 4242,
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
      tmuxControl,
      version: 'test',
    });

    io.emitFrame({ v: 1, type: 'open', channelId: 'c1', session: 'main', cols: 80, rows: 24 });
    await flushAsyncWork();
    io.emitFrame({
      v: 1,
      type: 'client-msg',
      channelId: 'c1',
      data: JSON.stringify({ type: 'switch-session', name: 'dev' }),
    });
    await flushAsyncWork();

    expect(attached).toEqual([
      { session: 'main', cols: 80, rows: 24 },
      { session: 'dev', cols: 80, rows: 24 },
    ]);
    expect(detached).toEqual(['main']);
    expect(io.frames()).toContainEqual({
      v: 1,
      type: 'server-msg',
      channelId: 'c1',
      data: { session: 'dev' },
    });
    agent.close();
  });

  test('client-msg switch-session attach rejection leaves old ref without ack', async () => {
    const io = new FakeIo();
    const attached: Array<{ session: string; cols?: number; rows?: number }> = [];
    const detached: string[] = [];
    const runCalls: string[][] = [];
    const tmuxControl: TmuxControl = {
      ...createNullTmuxControl(),
      attachSession: async (session: string, size?: { cols: number; rows: number }) => {
        attached.push({ session, ...size });
        if (session === 'dev') throw new Error('no such session: dev');
      },
      detachSession: (session: string) => { detached.push(session); },
      run: async (args: readonly string[]) => {
        runCalls.push([...args]);
        return '';
      },
      hasSession: () => false,
    };
    const makePty: AgentPtyFactory = (opts) => ({
      pid: 4242,
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
      tmuxControl,
      version: 'test',
    });

    io.emitFrame({ v: 1, type: 'open', channelId: 'c1', session: 'main', cols: 80, rows: 24 });
    await flushAsyncWork();
    io.emitFrame({
      v: 1,
      type: 'client-msg',
      channelId: 'c1',
      data: JSON.stringify({ type: 'switch-session', name: 'dev' }),
    });
    await flushAsyncWork();

    expect(attached).toEqual([
      { session: 'main', cols: 80, rows: 24 },
      { session: 'dev', cols: 80, rows: 24 },
    ]);
    expect(runCalls).toEqual([]);
    expect(detached).toEqual([]);
    expect(io.frames()).toContainEqual({
      v: 1,
      type: 'channel-error',
      channelId: 'c1',
      code: 'switch-session-failed',
      message: 'no such session: dev',
    });
    expect(io.frames()).not.toContainEqual({
      v: 1,
      type: 'server-msg',
      channelId: 'c1',
      data: { session: 'dev' },
    });
    agent.close();
  });

  test('client-msg switch-session attach failure emits channel-error and keeps old ref', async () => {
    const io = new FakeIo();
    const attached: Array<{ session: string; cols?: number; rows?: number }> = [];
    const detached: string[] = [];
    const tmuxControl: TmuxControl = {
      ...createNullTmuxControl(),
      attachSession: async (session: string, size?: { cols: number; rows: number }) => {
        attached.push({ session, ...size });
        if (session === 'missing') throw new Error('no such session: missing');
      },
      detachSession: (session: string) => { detached.push(session); },
      run: async (args: readonly string[]) => {
        if (args[0] === 'list-clients' && args.includes('#{client_pid}\t#{client_tty}\t#{client_name}')) {
          return '4242\t/dev/pts/fake\tclient-1\n';
        }
        if (args[0] === 'switch-client') return '';
        if (args[0] === 'list-clients' && args.includes('#{client_tty}\t#{client_name}\t#{client_session}')) {
          return '/dev/pts/fake\tclient-1\tdev\n';
        }
        return '';
      },
      hasSession: (session: string) => ['main', 'dev'].includes(session),
    };
    const makePty: AgentPtyFactory = (opts) => ({
      pid: 4242,
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
      tmuxControl,
      version: 'test',
    });

    io.emitFrame({ v: 1, type: 'open', channelId: 'c1', session: 'main', cols: 80, rows: 24 });
    await flushAsyncWork();
    io.emitFrame({
      v: 1,
      type: 'client-msg',
      channelId: 'c1',
      data: JSON.stringify({ type: 'switch-session', name: 'missing' }),
    });
    await flushAsyncWork();
    io.emitFrame({
      v: 1,
      type: 'client-msg',
      channelId: 'c1',
      data: JSON.stringify({ type: 'switch-session', name: 'dev' }),
    });
    await flushAsyncWork();

    expect(attached).toEqual([
      { session: 'main', cols: 80, rows: 24 },
      { session: 'missing', cols: 80, rows: 24 },
      { session: 'dev', cols: 80, rows: 24 },
    ]);
    expect(detached).toEqual(['main']);
    expect(io.frames()).toContainEqual({
      v: 1,
      type: 'channel-error',
      channelId: 'c1',
      code: 'switch-session-failed',
      message: 'no such session: missing',
    });
    expect(io.frames()).toContainEqual({
      v: 1,
      type: 'server-msg',
      channelId: 'c1',
      data: { session: 'dev' },
    });
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
