import { describe, test, expect, afterEach } from 'bun:test';
import WebSocket from 'ws';
import { connect } from 'node:net';
import { startTestServer, type Harness } from './_harness/spawn-server.ts';

let h: Harness | undefined;
afterEach(async () => { if (h) { await h.close(); h = undefined; } });

async function open(path = '/ws?session=main&cols=80&rows=24', headers: Record<string, string> = {}): Promise<WebSocket> {
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(h!.wsUrl + path, { headers });
    ws.once('open', () => resolve(ws));
    ws.once('error', (e) => reject(e));
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

describe('ws upgrade success paths', () => {
  test('happy path: /ws upgrade succeeds, resize accepted, close cleans up', async () => {
    h = await startTestServer();
    const ws = await open();
    ws.send(JSON.stringify({ type: 'resize', cols: 120, rows: 40 }));
    await new Promise(r => setTimeout(r, 20));
    ws.close();
    await new Promise(r => setTimeout(r, 20));
  });

  test('non-/ws path is destroyed (no 101)', async () => {
    h = await startTestServer();
    const port = Number(new URL(h.url).port);
    const { statusCode } = await rawUpgrade(port, '/other?session=main');
    // socket.destroy() with no HTTP response → no status line parsed
    expect(statusCode).toBeNull();
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

  // Note: we cannot exercise the IP-reject branch from a localhost client —
  // `isAllowed()` unconditionally accepts LOCALHOST_IPS (127.0.0.1, ::1)
  // regardless of the allowlist. That branch is covered by the pure-unit
  // tests for `isAllowed()`.
});
