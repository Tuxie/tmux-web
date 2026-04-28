import { describe, test, expect, afterEach } from 'bun:test';
import { connect } from 'node:net';
import { startTestServer, type Harness } from './_harness/spawn-server.ts';
import type { StdioFrame } from '../../../src/server/stdio-protocol.ts';
import { createNullTmuxControl, type TmuxControl, type TmuxNotification } from '../../../src/server/tmux-control.ts';

let h: Harness | undefined;
afterEach(async () => { if (h) { await h.close(); h = undefined; } });

async function open(path = '/ws?session=main&cols=80&rows=24', headers: Record<string, string> = {}): Promise<WebSocket> {
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(h!.wsUrl + path, { headers } as any);
    ws.addEventListener('open', () => resolve(ws), { once: true });
    ws.addEventListener('error', (e) => reject(e), { once: true });
  });
}

/**
 * Raw upgrade request — bypasses bun's ws shim (which doesn't implement the
 * `unexpected-response` event) so we can observe the HTTP status the server
 * writes when rejecting the upgrade.
 */
async function rawUpgrade(
  port: number,
  path = '/ws?session=main&cols=80&rows=24',
  headers: Record<string, string> = {},
): Promise<{ statusCode: number | null; raw: string }> {
  return await new Promise((resolve, reject) => {
    const sock = connect(port, '127.0.0.1');
    let buf = '';
    const hdrLines = [
      `GET ${path} HTTP/1.1`,
      `Host: 127.0.0.1:${port}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
      'Sec-WebSocket-Version: 13',
      ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
      '',
      '',
    ];
    sock.once('error', reject);
    sock.on('data', (d) => { buf += d.toString('utf8'); });
    sock.on('close', () => {
      const m = buf.match(/^HTTP\/1\.1 (\d+)/);
      resolve({ statusCode: m ? Number(m[1]) : null, raw: buf });
    });
    sock.write(hdrLines.join('\r\n'));
    // Server closes after writing the rejection; if it doesn't (e.g. happy path),
    // time out so the test doesn't hang.
    setTimeout(() => { try { sock.destroy(); } catch {} }, 300);
  });
}

function waitForMessage(ws: WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('timed out waiting for websocket message'));
    }, 500);
    const onMessage = (event: MessageEvent) => {
      cleanup();
      const data = event.data;
      if (typeof data === 'string') {
        resolve(data);
      } else if (data instanceof ArrayBuffer) {
        resolve(Buffer.from(data).toString('utf8'));
      } else {
        resolve(String(data));
      }
    };
    const onClose = () => {
      cleanup();
      reject(new Error('websocket closed before message'));
    };
    const cleanup = () => {
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
      ws.removeEventListener('close', onClose);
    };
    ws.addEventListener('message', onMessage);
    ws.addEventListener('close', onClose);
  });
}

function waitForClose(ws: WebSocket): Promise<void> {
  return new Promise(resolve => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    ws.addEventListener('close', () => resolve(), { once: true });
  });
}

function waitForOptionalMessage(ws: WebSocket, timeoutMs = 80): Promise<string | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeoutMs);
    const onMessage = (event: MessageEvent) => {
      cleanup();
      const data = event.data;
      if (typeof data === 'string') resolve(data);
      else if (data instanceof ArrayBuffer) resolve(Buffer.from(data).toString('utf8'));
      else resolve(String(data));
    };
    const cleanup = () => {
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
    };
    ws.addEventListener('message', onMessage);
  });
}

type RemoteEvent =
  | { type: 'open'; host: string; session: string; cols: number; rows: number }
  | { type: 'pty'; data: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'client'; data: string }
  | { type: 'close'; reason?: string };

function createFakeRemoteManager(remoteEvents: RemoteEvent[]) {
  const listeners: Array<(frame: StdioFrame) => void> = [];
  const channel = {
    channelId: 'c1',
    on(event: 'frame', cb: (frame: StdioFrame) => void) {
      expect(event).toBe('frame');
      listeners.push(cb);
      return () => {
        const idx = listeners.indexOf(cb);
        if (idx !== -1) listeners.splice(idx, 1);
      };
    },
    emitFrame(frame: StdioFrame) {
      for (const cb of [...listeners]) cb(frame);
    },
    sendPty(data: string) {
      remoteEvents.push({ type: 'pty', data });
    },
    resize(cols: number, rows: number) {
      remoteEvents.push({ type: 'resize', cols, rows });
    },
    sendClientMessage(data: string) {
      remoteEvents.push({ type: 'client', data });
    },
    close(reason?: string) {
      remoteEvents.push({ type: 'close', reason });
    },
  };

  return {
    channel,
    manager: {
      async getHost(host: string) {
        return {
          async openChannel(opts: { session: string; cols: number; rows: number }) {
            remoteEvents.push({ type: 'open', host, session: opts.session, cols: opts.cols, rows: opts.rows });
            return channel;
          },
        };
      },
      async close() {},
    },
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createTrackingTmuxControl() {
  const events: Array<{ type: 'detach'; session: string }> = [];
  return {
    events,
    control: {
      attachSession: async () => {},
      detachSession: (session: string) => { events.push({ type: 'detach', session }); },
      run: async () => '',
      on: () => () => {},
      hasSession: () => false,
      close: async () => {},
    },
  };
}

function createNotifyingTmuxControl() {
  const listeners = new Map<string, Array<(n: any) => void>>();
  const control: TmuxControl = {
    ...createNullTmuxControl(),
    async run(args) {
      if (args[0] === 'list-windows') return '0\tlocal\t1\n';
      return '';
    },
    on(event, cb) {
      const list = listeners.get(event) ?? [];
      list.push(cb);
      listeners.set(event, list);
      return () => {
        const current = listeners.get(event) ?? [];
        listeners.set(event, current.filter(x => x !== cb));
      };
    },
  };
  return {
    control,
    emit<T extends TmuxNotification['type']>(event: T, payload: Extract<TmuxNotification, { type: T }>) {
      for (const cb of listeners.get(event) ?? []) cb(payload);
    },
  };
}

function createDeferredRemoteManager(remoteEvents: RemoteEvent[]) {
  const openDeferred = createDeferred<any>();
  const fake = createFakeRemoteManager(remoteEvents);
  return {
    channel: fake.channel,
    openDeferred,
    manager: {
      async getHost(host: string) {
        return {
          async openChannel(opts: { session: string; cols: number; rows: number }) {
            remoteEvents.push({ type: 'open', host, session: opts.session, cols: opts.cols, rows: opts.rows });
            return await openDeferred.promise;
          },
        };
      },
      async close() {},
    },
  };
}

describe('ws upgrade success paths', () => {
  test('happy path: /ws upgrade succeeds, resize accepted, close cleans up', async () => {
    h = await startTestServer();
    const ws = await open();
    ws.send(JSON.stringify({ type: 'resize', cols: 120, rows: 40 }));
    await new Promise(r => setTimeout(r, 20));
    ws.close();
    await new Promise(r => setTimeout(r, 20));
  });

  test('non-/ws path is rejected (no 101)', async () => {
    h = await startTestServer();
    const port = Number(new URL(h.url).port);
    const { statusCode } = await rawUpgrade(port, '/other?session=main');
    // Whatever the server returns, it must not be a 101 Switching Protocols.
    expect(statusCode).not.toBe(101);
  });

  test('non-JSON message is forwarded to pty (no crash)', async () => {
    h = await startTestServer();
    const ws = await open();
    ws.send('hello');
    await new Promise(r => setTimeout(r, 20));
    ws.close();
  });

  test('malformed JSON falls through as pty write (no crash)', async () => {
    h = await startTestServer();
    const ws = await open();
    ws.send('{not json');
    await new Promise(r => setTimeout(r, 20));
    ws.close();
  });

  test('window action is dispatched without error in test mode', async () => {
    h = await startTestServer();
    const ws = await open();
    ws.send(JSON.stringify({ type: 'window', action: 'select', index: '1' }));
    await new Promise(r => setTimeout(r, 30));
    ws.close();
  });

  test('session action is dispatched without error in test mode', async () => {
    h = await startTestServer();
    const ws = await open();
    ws.send(JSON.stringify({ type: 'session', action: 'rename', name: 'dev' }));
    await new Promise(r => setTimeout(r, 30));
    ws.close();
  });

  test('colour-variant action is accepted', async () => {
    h = await startTestServer();
    const ws = await open();
    ws.send(JSON.stringify({ type: 'colour-variant', variant: 'dark' }));
    await new Promise(r => setTimeout(r, 20));
    ws.close();
  });

  test('remoteHost opens a remote channel and routes ws traffic through it', async () => {
    const remoteEvents: RemoteEvent[] = [];
    const fake = createFakeRemoteManager(remoteEvents);
    h = await startTestServer({ remoteAgentManager: fake.manager });

    const ws = await open('/ws?remoteHost=prod&session=main&cols=80&rows=24');
    await new Promise(r => setTimeout(r, 20));

    expect(remoteEvents).toContainEqual({ type: 'open', host: 'prod', session: 'main', cols: 80, rows: 24 });

    const received = waitForMessage(ws);
    fake.channel.emitFrame({
      v: 1,
      type: 'pty-out',
      channelId: 'c1',
      data: Buffer.from('hello').toString('base64'),
    });
    expect(await received).toBe('hello');

    ws.send('input');
    ws.send(JSON.stringify({ type: 'resize', cols: 120, rows: 40 }));
    ws.send(JSON.stringify({ type: 'window', action: 'select', index: '1' }));
    await new Promise(r => setTimeout(r, 20));

    expect(remoteEvents).toContainEqual({ type: 'pty', data: 'input' });
    expect(remoteEvents).toContainEqual({ type: 'resize', cols: 120, rows: 40 });
    expect(remoteEvents).toContainEqual({ type: 'client', data: JSON.stringify({ type: 'window', action: 'select', index: '1' }) });
    ws.send(JSON.stringify({ x: 1 }));
    await new Promise(r => setTimeout(r, 20));
    expect(remoteEvents).toContainEqual({ type: 'pty', data: JSON.stringify({ x: 1 }) });

    ws.close();
    await new Promise(r => setTimeout(r, 20));
    expect(remoteEvents).toContainEqual({ type: 'close', reason: 'websocket closed' });
  });

  test('remoteHost without a manager reports ptyExit and never detaches local sessions', async () => {
    const tracker = createTrackingTmuxControl();
    h = await startTestServer({ testMode: false, tmuxControl: tracker.control });

    const ws = await open('/ws?remoteHost=prod&session=main&cols=80&rows=24');
    const msg = await waitForMessage(ws);
    ws.close();
    await waitForClose(ws);

    expect(msg).toStartWith('\x00TT:');
    expect(JSON.parse(msg.slice(4))).toMatchObject({
      ptyExit: true,
      exitCode: -1,
      exitReason: 'remote agent manager unavailable',
    });
    expect(tracker.events).toEqual([]);
  });

  test('remoteHost queues early input until async channel open completes', async () => {
    const remoteEvents: RemoteEvent[] = [];
    const fake = createDeferredRemoteManager(remoteEvents);
    const tracker = createTrackingTmuxControl();
    h = await startTestServer({
      remoteAgentManager: fake.manager,
      testMode: false,
      tmuxControl: tracker.control,
    });

    const ws = await open('/ws?remoteHost=prod&session=main&cols=80&rows=24');
    ws.send('early');
    ws.send(JSON.stringify({ type: 'resize', cols: 120, rows: 40 }));
    ws.send(JSON.stringify({ x: 1 }));
    await new Promise(r => setTimeout(r, 20));

    expect(remoteEvents).toEqual([
      { type: 'open', host: 'prod', session: 'main', cols: 80, rows: 24 },
    ]);
    expect(tracker.events).toEqual([]);

    fake.openDeferred.resolve(fake.channel);
    await new Promise(r => setTimeout(r, 20));

    expect(remoteEvents).toContainEqual({ type: 'pty', data: 'early' });
    expect(remoteEvents).toContainEqual({ type: 'resize', cols: 120, rows: 40 });
    expect(remoteEvents).toContainEqual({ type: 'pty', data: JSON.stringify({ x: 1 }) });
    expect(tracker.events).toEqual([]);

    ws.close();
    await new Promise(r => setTimeout(r, 20));
  });

  test('remoteHost client is isolated from local tmux session broadcasts', async () => {
    const remoteEvents: RemoteEvent[] = [];
    const fake = createFakeRemoteManager(remoteEvents);
    const notifier = createNotifyingTmuxControl();
    h = await startTestServer({
      remoteAgentManager: fake.manager,
      testMode: false,
      tmuxControl: notifier.control,
    });

    const ws = await open('/ws?remoteHost=prod&session=main&cols=80&rows=24');
    await new Promise(r => setTimeout(r, 20));

    const nextMessage = waitForOptionalMessage(ws);
    notifier.emit('sessionsChanged', { type: 'sessionsChanged' });
    notifier.emit('windowAdd', { type: 'windowAdd', window: '@1', session: 'main' });

    expect(await nextMessage).toBe(null);
    ws.close();
    await new Promise(r => setTimeout(r, 20));
    expect(remoteEvents).toContainEqual({ type: 'close', reason: 'websocket closed' });
  });
});

describe('ws upgrade rejections', () => {
  test('403 when Origin not allowed', async () => {
    h = await startTestServer({
      testMode: false,
      allowedOrigins: [{ scheme: 'https', host: 'good.example', port: 443 }],
    });
    const port = Number(new URL(h.url).port);
    const { statusCode } = await rawUpgrade(port, '/ws?session=main&cols=80&rows=24', {
      Origin: 'https://bad.example',
    });
    expect(statusCode).toBe(403);
  });

  test('401 when auth is required and credentials missing', async () => {
    h = await startTestServer({
      testMode: false,
      auth: { enabled: true, username: 'u', password: 'p' },
    });
    const port = Number(new URL(h.url).port);
    const { statusCode, raw } = await rawUpgrade(port);
    expect(statusCode).toBe(401);
    expect(raw).toContain('WWW-Authenticate');
  });

  test('tw_auth query token is honoured on WS upgrade (parity with HTTP)', async () => {
    // Mirrors the HTTP path at src/server/http.ts:323-325. Cluster 03
    // (docs/code-analysis/2026-04-26) records the rationale: a future
    // client (e.g. Safari WKWebView) that can't preserve URL userinfo
    // through the WebSocket handshake must still authenticate via the
    // `tw_auth` query parameter the desktop wrapper hands out.
    h = await startTestServer({
      testMode: false,
      auth: { enabled: true, username: 'u', password: 'p' },
      configOverrides: { exposeClientAuth: true, clientAuthToken: 'client-token' },
    });
    const port = Number(new URL(h.url).port);

    // Without the token: 401.
    const denied = await rawUpgrade(port, '/ws?session=main&cols=80&rows=24');
    expect(denied.statusCode).toBe(401);

    // With the token: upgrade is accepted (101 Switching Protocols).
    const accepted = await rawUpgrade(port, '/ws?session=main&cols=80&rows=24&tw_auth=client-token');
    expect(accepted.statusCode).toBe(101);

    // Wrong token: still 401.
    const wrong = await rawUpgrade(port, '/ws?session=main&cols=80&rows=24&tw_auth=nope');
    expect(wrong.statusCode).toBe(401);
  });

  test('invalid remoteHost is rejected during websocket upgrade', async () => {
    h = await startTestServer();
    const port = Number(new URL(h.url).port);
    const { statusCode, raw } = await rawUpgrade(port, '/ws?remoteHost=-Jbad&session=main');
    expect(statusCode).toBe(400);
    expect(raw).toContain('Invalid remote host');
  });

  // Note: we cannot exercise the IP-reject branch from a localhost client —
  // `isAllowed()` unconditionally accepts LOCALHOST_IPS (127.0.0.1, ::1)
  // regardless of the allowlist. That branch is covered by the pure-unit
  // tests for `isAllowed()`.
});
