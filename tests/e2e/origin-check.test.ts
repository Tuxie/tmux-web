import { test, expect } from '@playwright/test';
import type { ChildProcess } from 'child_process';
import { spawn } from 'child_process';
import { startServer, killServer } from './helpers.js';

const PORT = 4112;
let server: ChildProcess | undefined;

test.beforeAll(async () => {
  server = await startServer(
    'bun',
    [
      'src/server/index.ts',
      `--listen=127.0.0.1:${PORT}`,
      '--no-auth',
      '--no-tls',
    ],
  );
});

test.afterAll(() => {
  killServer(server);
  server = undefined;
});

test.describe('Origin validation (non-test-mode server)', () => {
  test('rejects DNS-rebind-shape Origin with 403', async ({ request }) => {
    const res = await request.get(`http://127.0.0.1:${PORT}/`, {
      headers: { origin: 'https://evil.com' },
      failOnStatusCode: false,
    });
    expect(res.status()).toBe(403);
  });

  test('allows same-origin loopback Origin', async ({ request }) => {
    const res = await request.get(`http://127.0.0.1:${PORT}/`, {
      headers: { origin: `http://127.0.0.1:${PORT}` },
      failOnStatusCode: false,
    });
    expect([200, 304]).toContain(res.status());
  });

  test('allows request with no Origin header', async ({ request }) => {
    const res = await request.get(`http://127.0.0.1:${PORT}/`, {
      failOnStatusCode: false,
    });
    expect([200, 304]).toContain(res.status());
  });

  test('rejects WebSocket upgrade with cross-origin with 403', async () => {
    // Raw-socket WS upgrade — Playwright's request.get() cannot send
    // Upgrade headers. We speak HTTP/1.1 directly and read the status line.
    const net = await import('node:net');
    const res = await new Promise<string>((resolve, reject) => {
      const sock = net.connect(PORT, '127.0.0.1', () => {
        sock.write(
          'GET /ws HTTP/1.1\r\n'
          + `Host: 127.0.0.1:${PORT}\r\n`
          + 'Upgrade: websocket\r\n'
          + 'Connection: Upgrade\r\n'
          + 'Sec-WebSocket-Version: 13\r\n'
          + 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n'
          + 'Origin: https://evil.com\r\n'
          + '\r\n',
        );
      });
      let buf = '';
      sock.on('data', (chunk) => { buf += chunk.toString('utf8'); });
      sock.on('end', () => resolve(buf));
      sock.on('close', () => resolve(buf));
      sock.on('error', reject);
      setTimeout(() => { sock.destroy(); resolve(buf); }, 3000);
    });
    const statusLine = res.split('\r\n', 1)[0];
    expect(statusLine).toBe('HTTP/1.1 403 Forbidden');
  });

  test('sends WWW-Authenticate on WS upgrade 401', async () => {
    const PORT_AUTH = 4113;
    const authServer = spawn(
      'bun',
      [
        'src/server/index.ts',
        '--listen', `127.0.0.1:${PORT_AUTH}`,
        '--username', 'u',
        '--password', 'p',
        '--no-tls',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    try {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('server did not start in 5s')), 5000);
        authServer.stdout?.on('data', (buf: Buffer) => {
          if (buf.toString().includes(`listening on http://127.0.0.1:${PORT_AUTH}`)) {
            clearTimeout(t); resolve();
          }
        });
        authServer.stderr?.on('data', () => {});
      });
      const net = await import('node:net');
      const res = await new Promise<string>((resolve, reject) => {
        const sock = net.connect(PORT_AUTH, '127.0.0.1', () => {
          sock.write(
            'GET /ws HTTP/1.1\r\n'
            + `Host: 127.0.0.1:${PORT_AUTH}\r\n`
            + 'Upgrade: websocket\r\n'
            + 'Connection: Upgrade\r\n'
            + 'Sec-WebSocket-Version: 13\r\n'
            + 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n'
            + `Origin: http://127.0.0.1:${PORT_AUTH}\r\n`
            + '\r\n',
          );
        });
        let buf = '';
        sock.on('data', (c) => { buf += c.toString('utf8'); });
        sock.on('end', () => resolve(buf));
        sock.on('close', () => resolve(buf));
        sock.on('error', reject);
        setTimeout(() => { sock.destroy(); resolve(buf); }, 3000);
      });
      expect(res.startsWith('HTTP/1.1 401 Unauthorized')).toBe(true);
      expect(res).toContain('WWW-Authenticate: Basic realm="tmux-web"');
    } finally {
      authServer.kill('SIGTERM');
      await new Promise<void>(r => { authServer.on('exit', () => r()); });
    }
  });
});
