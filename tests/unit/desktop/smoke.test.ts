import { afterEach, describe, expect, test } from 'bun:test';
import { generateDesktopCredentials } from '../../../src/desktop/auth.js';
import {
  startTmuxWebServer,
  type StartedTmuxWebServer,
} from '../../../src/desktop/server-process.js';

let server: StartedTmuxWebServer | null = null;

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

    const noAuth = await fetch(`${server.endpoint.origin}/`);
    expect(noAuth.status).toBe(401);
  });
});
