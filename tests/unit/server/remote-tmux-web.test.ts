import { describe, expect, test } from 'bun:test';
import { decodePtyBytes, type StdioFrame } from '../../../src/server/stdio-protocol.js';
import {
  DirectHttpRemoteTmuxWebConnection,
  RemoteTmuxWebManager,
  parseRemoteHttpBaseUrls,
} from '../../../src/server/remote-tmux-web.js';

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

function framesOfType<T extends StdioFrame['type']>(frames: StdioFrame[], type: T): Array<Extract<StdioFrame, { type: T }>> {
  return frames.filter((frame): frame is Extract<StdioFrame, { type: T }> => frame.type === type);
}

describe('remote tmux-web transports', () => {
  test('direct HTTP transport proxies API GETs to the configured base URL', async () => {
    const requested: string[] = [];
    const conn = new DirectHttpRemoteTmuxWebConnection({
      baseUrl: 'https://remote.example/tmux/',
      fetch: (async (url: string) => {
        requested.push(url);
        return new Response(JSON.stringify([{ id: '1', name: 'main' }]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as any,
      webSocketFactory: (() => { throw new Error('no ws'); }) as any,
    });

    const response = await conn.apiGet('/api/sessions');

    expect(requested).toEqual(['https://remote.example/api/sessions']);
    expect(response).toEqual({ status: 200, body: [{ id: '1', name: 'main' }] });
  });

  test('direct HTTP transport opens the same websocket channel contract as stdio', async () => {
    const sockets: FakeWebSocket[] = [];
    const urls: string[] = [];
    const conn = new DirectHttpRemoteTmuxWebConnection({
      baseUrl: 'https://remote.example:4022',
      fetch: (() => { throw new Error('no fetch'); }) as any,
      webSocketFactory: (url) => {
        urls.push(url);
        const ws = new FakeWebSocket();
        sockets.push(ws);
        return ws as any;
      },
    });

    const opened = conn.openChannel({ session: 'main', cols: 80, rows: 24 });
    expect(urls).toEqual(['wss://remote.example:4022/ws?session=main&cols=80&rows=24']);
    sockets[0]!.emit('open');
    const channel = await opened;

    const frames: StdioFrame[] = [];
    channel.on('frame', frame => frames.push(frame));
    channel.sendPty('x');
    channel.resize(100, 30);
    channel.sendClientMessage('{"type":"window","action":"new"}');
    sockets[0]!.emit('message', { data: '\x00TT:{"windows":[]}' });
    sockets[0]!.emit('close', { reason: 'done' });

    expect(sockets[0]!.sent).toEqual([
      'x',
      '{"type":"resize","cols":100,"rows":30}',
      '{"type":"window","action":"new"}',
    ]);
    expect(framesOfType(frames, 'pty-out').map(frame => decodePtyBytes(frame).toString('utf8'))).toEqual([
      '\x00TT:{"windows":[]}',
    ]);
    expect(frames).toContainEqual({ v: 1, type: 'close', channelId: channel.channelId, reason: 'done' });
  });

  test('manager chooses direct HTTP for configured aliases and stdio otherwise', async () => {
    const stdioHosts: string[] = [];
    const manager = new RemoteTmuxWebManager({
      directHttpBaseUrls: new Map([['prod', 'http://prod.example:4022']]),
      stdioManager: {
        getHost: async (host: string) => {
          stdioHosts.push(host);
          return {
            apiGet: async () => ({ status: 200, body: [] }),
            openChannel: async () => { throw new Error('not needed'); },
          };
        },
        close: async () => {},
      },
    });

    expect(await manager.getHost('prod')).toBeInstanceOf(DirectHttpRemoteTmuxWebConnection);
    await manager.getHost('dev');
    expect(stdioHosts).toEqual(['dev']);
    await manager.close();
  });

  test('parses direct remote URL map from JSON', () => {
    expect(parseRemoteHttpBaseUrls('{"prod":"https://prod.example:4022","-Jbad":"https://bad.example","bad":"file:///tmp/x","empty":""}')).toEqual(
      new Map([['prod', 'https://prod.example:4022']]),
    );
    expect(parseRemoteHttpBaseUrls('not-json')).toEqual(new Map());
  });
});
