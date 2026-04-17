import { test, expect } from '@playwright/test';
import type { ChildProcess } from 'child_process';
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
});
