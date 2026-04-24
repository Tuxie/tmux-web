import { describe, expect, test } from 'bun:test';
import {
  buildTmuxWebLaunch,
  parseTmuxWebListeningLine,
} from '../../../src/desktop/server-process.js';

describe('desktop tmux-web launch helpers', () => {
  test('buildTmuxWebLaunch binds loopback port 0 and keeps password out of argv', () => {
    const launch = buildTmuxWebLaunch({
      executable: '/opt/tmux-term/tmux-web',
      credentials: {
        username: 'tmux-term-user',
        password: 'random-secret',
      },
      extraArgs: ['--tmux', '/usr/bin/tmux'],
      env: { PATH: '/usr/bin', TMUX_WEB_PASSWORD: 'old' },
    });

    expect(launch.cmd).toBe('/opt/tmux-term/tmux-web');
    expect(launch.args).toEqual([
      '--listen',
      '127.0.0.1:0',
      '--no-tls',
      '--tmux',
      '/usr/bin/tmux',
    ]);
    expect(launch.args.join(' ')).not.toContain('random-secret');
    expect(launch.env.TMUX_WEB_USERNAME).toBe('tmux-term-user');
    expect(launch.env.TMUX_WEB_PASSWORD).toBe('random-secret');
    expect(launch.env.PATH).toBe('/usr/bin');
  });

  test('buildTmuxWebLaunch supports running the server through bun', () => {
    const launch = buildTmuxWebLaunch({
      executable: 'bun',
      executableArgs: ['src/server/index.ts'],
      credentials: { username: 'tmux-term-user', password: 'random-secret' },
    });

    expect(launch.cmd).toBe('bun');
    expect(launch.args).toEqual([
      'src/server/index.ts',
      '--listen',
      '127.0.0.1:0',
      '--no-tls',
    ]);
  });

  test('parseTmuxWebListeningLine accepts loopback http lines', () => {
    expect(
      parseTmuxWebListeningLine('tmux-web listening on http://127.0.0.1:38123'),
    ).toEqual({
      host: '127.0.0.1',
      port: 38123,
      origin: 'http://127.0.0.1:38123',
    });
  });

  test('parseTmuxWebListeningLine rejects tls, wildcard, and unrelated output', () => {
    expect(
      parseTmuxWebListeningLine('tmux-web listening on https://127.0.0.1:38123'),
    ).toBeNull();
    expect(
      parseTmuxWebListeningLine('tmux-web listening on http://0.0.0.0:38123'),
    ).toBeNull();
    expect(parseTmuxWebListeningLine('warning: booting')).toBeNull();
  });
});
