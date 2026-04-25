import { afterEach, describe, expect, test } from 'bun:test';
import http from 'node:http';
import { generateDesktopCredentials } from '../../../src/desktop/auth.js';
import {
  startTmuxWebServer,
  type StartedTmuxWebServer,
} from '../../../src/desktop/server-process.js';

let server: StartedTmuxWebServer | null = null;

function getStatus(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    req.on('error', reject);
  });
}

afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
});

describe('desktop tmux-web smoke', () => {
  test('starts tmux-web in test mode on loopback with generated auth', async () => {
    server = await startTmuxWebServer({
      executable: 'bun',
      executableArgs: ['src/server/index.ts'],
      credentials: generateDesktopCredentials({
        randomBytes: (size) => Buffer.alloc(size, 0xcd),
      }),
      testMode: true,
      startupTimeoutMs: 15_000,
    });

    expect(server.endpoint.host).toBe('127.0.0.1');
    expect(server.endpoint.port).toBeGreaterThan(0);

    await expect(getStatus(`${server.endpoint.origin}/`)).resolves.toBe(401);
  });
});
