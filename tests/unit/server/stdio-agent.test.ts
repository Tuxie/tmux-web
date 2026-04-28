import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { buildStdioAgentLaunchOptions, parseConfig } from '../../../src/server/index.js';
import { runStdioAgent } from '../../../src/server/stdio-agent.js';
import { decodePtyBytes, encodeFrame, FrameDecoder, type StdioFrame } from '../../../src/server/stdio-protocol.js';
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

class FakeWebSocket {
  binaryType = 'arraybuffer';
  sent: string[] = [];
  closed: Array<{ code?: number; reason?: string }> = [];
  private listeners = new Map<string, Array<(event: any) => void>>();

  addEventListener(type: string, cb: (event: any) => void) {
    const existing = this.listeners.get(type) ?? [];
    existing.push(cb);
    this.listeners.set(type, existing);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close(code?: number, reason?: string) {
    this.closed.push({ code, reason });
  }

  emit(type: string, event: any = {}) {
    for (const cb of this.listeners.get(type) ?? []) cb(event);
  }
}

function framesOfType<T extends StdioFrame['type']>(io: FakeIo, type: T): Array<Extract<StdioFrame, { type: T }>> {
  return io.frames().filter((frame): frame is Extract<StdioFrame, { type: T }> => frame.type === type);
}

async function flushAsyncWork(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

describe('stdio agent runtime', () => {
  test('handshakes without starting the loopback server', async () => {
    const io = new FakeIo();
    let serverStarts = 0;
    const agent = runStdioAgent({
      input: io.input as any,
      write: io.write,
      tmuxControl: createNullTmuxControl(),
      version: 'test',
      serverFactory: async () => {
        serverStarts += 1;
        return { baseUrl: 'http://127.0.0.1:1', close: async () => {} };
      },
    });

    io.emitFrame({ v: 1, type: 'hello' });

    expect(io.frames()).toContainEqual({ v: 1, type: 'hello-ok', agentVersion: 'test' });
    expect(serverStarts).toBe(0);
    agent.close();
  });

  test('opens independent channels as websocket connections to the normal /ws API', async () => {
    const io = new FakeIo();
    const sockets: FakeWebSocket[] = [];
    const urls: string[] = [];
    const agent = runStdioAgent({
      input: io.input as any,
      write: io.write,
      tmuxControl: createNullTmuxControl(),
      version: 'test',
      serverFactory: async () => ({ baseUrl: 'http://127.0.0.1:40222', close: async () => {} }),
      webSocketFactory: (url) => {
        urls.push(url);
        const ws = new FakeWebSocket();
        sockets.push(ws);
        return ws as any;
      },
    });

    io.emitFrame({ v: 1, type: 'open', channelId: 'c1', session: 'main', cols: 80, rows: 24 });
    io.emitFrame({ v: 1, type: 'open', channelId: 'c2', session: 'dev', cols: 100, rows: 30 });
    await flushAsyncWork();

    expect(urls).toEqual([
      'http://127.0.0.1:40222/ws?session=main&cols=80&rows=24',
      'http://127.0.0.1:40222/ws?session=dev&cols=100&rows=30',
    ]);
    sockets[1]!.emit('open');
    sockets[0]!.emit('open');

    expect(io.frames()).toContainEqual({ v: 1, type: 'open-ok', channelId: 'c1', session: 'main' });
    expect(io.frames()).toContainEqual({ v: 1, type: 'open-ok', channelId: 'c2', session: 'dev' });

    io.emitFrame({ v: 1, type: 'pty-in', channelId: 'c2', data: Buffer.from('x').toString('base64') });
    expect(sockets[1]!.sent).toEqual(['x']);
    expect(sockets[0]!.sent).toEqual([]);
    agent.close();
  });

  test('queues input, resize, and client messages until the remote websocket opens', async () => {
    const io = new FakeIo();
    let socket!: FakeWebSocket;
    const agent = runStdioAgent({
      input: io.input as any,
      write: io.write,
      tmuxControl: createNullTmuxControl(),
      version: 'test',
      serverFactory: async () => ({ baseUrl: 'http://127.0.0.1:40222', close: async () => {} }),
      webSocketFactory: () => {
        socket = new FakeWebSocket();
        return socket as any;
      },
    });

    io.emitFrame({ v: 1, type: 'open', channelId: 'c1', session: 'main', cols: 80, rows: 24 });
    await flushAsyncWork();
    io.emitFrame({ v: 1, type: 'pty-in', channelId: 'c1', data: Buffer.from('a').toString('base64') });
    io.emitFrame({ v: 1, type: 'resize', channelId: 'c1', cols: 120, rows: 40 });
    io.emitFrame({ v: 1, type: 'client-msg', channelId: 'c1', data: '{"type":"window","action":"new"}' });

    expect(socket.sent).toEqual([]);
    socket.emit('open');

    expect(socket.sent).toEqual([
      'a',
      '{"type":"resize","cols":120,"rows":40}',
      '{"type":"window","action":"new"}',
    ]);
    agent.close();
  });

  test('forwards websocket messages byte-for-byte as PTY output frames', async () => {
    const io = new FakeIo();
    let socket!: FakeWebSocket;
    const agent = runStdioAgent({
      input: io.input as any,
      write: io.write,
      tmuxControl: createNullTmuxControl(),
      version: 'test',
      serverFactory: async () => ({ baseUrl: 'http://127.0.0.1:40222', close: async () => {} }),
      webSocketFactory: () => {
        socket = new FakeWebSocket();
        return socket as any;
      },
    });

    io.emitFrame({ v: 1, type: 'open', channelId: 'c1', session: 'main', cols: 80, rows: 24 });
    await flushAsyncWork();
    socket.emit('open');
    socket.emit('message', { data: '\x00TT:{"windows":[]}' });
    socket.emit('message', { data: 'terminal bytes' });

    const out = framesOfType(io, 'pty-out').map(frame => decodePtyBytes(frame).toString('utf8'));
    expect(out).toEqual(['\x00TT:{"windows":[]}', 'terminal bytes']);
    agent.close();
  });

  test('api-get proxies to the normal HTTP API', async () => {
    const io = new FakeIo();
    const requested: string[] = [];
    const agent = runStdioAgent({
      input: io.input as any,
      write: io.write,
      tmuxControl: createNullTmuxControl(),
      version: 'test',
      serverFactory: async () => ({ baseUrl: 'http://127.0.0.1:40222', close: async () => {} }),
      fetch: (async (url: string) => {
        requested.push(url);
        return new Response(JSON.stringify({ version: 1, sessions: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as any,
    });

    io.emitFrame({ v: 1, type: 'api-get', requestId: 'req-1', path: '/api/session-settings' });
    await flushAsyncWork();

    expect(requested).toEqual(['http://127.0.0.1:40222/api/session-settings']);
    expect(io.frames()).toContainEqual({
      v: 1,
      type: 'api-response',
      requestId: 'req-1',
      status: 200,
      body: { version: 1, sessions: {} },
    });
    agent.close();
  });

  test('list-sessions is compatibility sugar for /api/sessions', async () => {
    const io = new FakeIo();
    const agent = runStdioAgent({
      input: io.input as any,
      write: io.write,
      tmuxControl: createNullTmuxControl(),
      version: 'test',
      serverFactory: async () => ({ baseUrl: 'http://127.0.0.1:40222', close: async () => {} }),
      fetch: (async () => new Response(JSON.stringify([{ id: '1', name: 'main', windows: 2 }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as any,
    });

    io.emitFrame({ v: 1, type: 'list-sessions', requestId: 'req-1' });
    await flushAsyncWork();

    expect(io.frames()).toContainEqual({
      v: 1,
      type: 'sessions',
      requestId: 'req-1',
      sessions: [{ id: '1', name: 'main', windows: 2 }],
    });
    agent.close();
  });

  test('fatal malformed input sends host-error and closes active channels', async () => {
    const io = new FakeIo();
    let socket!: FakeWebSocket;
    const agent = runStdioAgent({
      input: io.input as any,
      write: io.write,
      tmuxControl: createNullTmuxControl(),
      version: 'test',
      serverFactory: async () => ({ baseUrl: 'http://127.0.0.1:40222', close: async () => {} }),
      webSocketFactory: () => {
        socket = new FakeWebSocket();
        return socket as any;
      },
    });

    io.emitFrame({ v: 1, type: 'open', channelId: 'c1', session: 'main', cols: 80, rows: 24 });
    await flushAsyncWork();
    io.input.emit('data', Buffer.from([0, 0, 0, 1, 0]));

    expect(io.frames()).toContainEqual({
      v: 1,
      type: 'host-error',
      code: 'invalid-frame',
      message: 'invalid stdio frame',
    });
    expect(socket.closed).toEqual([{ code: 1000, reason: 'agent closed' }]);

    socket.emit('message', { data: 'late' });
    expect(framesOfType(io, 'pty-out')).toEqual([]);
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
      sessionsStorePath: `${process.env.HOME ?? ''}/.config/tmux-web/sessions.json`,
      tmuxConfPath: '/run/user/1000/tmux-web/tmux.conf',
      projectRoot: '/repo',
      isCompiled: false,
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
    expect(launch?.projectRoot).toBe('/repo');
    expect(mkdirs).toEqual(['/run/user/1000/tmux-web']);
    expect(writes).toEqual([{
      path: '/run/user/1000/tmux-web/tmux.conf',
      content: 'set -g mouse on\n',
    }]);
  });
});
