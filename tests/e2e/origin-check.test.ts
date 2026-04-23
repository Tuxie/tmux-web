import { test, expect } from '@playwright/test';
import type { ChildProcess } from 'child_process';
import { createIsolatedTmux, hasTmux, startServer, killServer, type IsolatedTmux } from './helpers.js';

const PORT = 4112;
let server: ChildProcess | undefined;
let tmux: IsolatedTmux | undefined;

test.skip(!hasTmux(), 'tmux not available');

test.beforeAll(async () => {
  // `startServer` has its own 60s timeout, but Playwright's default
  // hook timeout is 15s — lose the race on a cold-start `act` runner
  // where bun's first spawn is very slow. Extend so the inner timeout
  // wins instead of Playwright cutting us off.
  test.setTimeout(90_000);
  tmux = createIsolatedTmux('tw-origin-e2e');
  server = await startServer(
    'bun',
    [
      'src/server/index.ts',
      `--listen=127.0.0.1:${PORT}`,
      '--no-auth',
      '--no-tls',
      '--tmux', tmux.wrapperPath,
    ],
  );
});

test.afterAll(() => {
  killServer(server);
  tmux?.cleanup();
  server = undefined;
  tmux = undefined;
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
    const authTmux = createIsolatedTmux('tw-origin-auth-e2e');
    const authServer = await startServer(
      'bun',
      [
        'src/server/index.ts',
        '--listen', `127.0.0.1:${PORT_AUTH}`,
        '--username', 'u',
        '--password', 'p',
        '--no-tls',
        '--tmux', authTmux.wrapperPath,
      ],
    );
    try {
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
      killServer(authServer);
      authTmux.cleanup();
    }
  });
});
