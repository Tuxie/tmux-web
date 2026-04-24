import { describe, expect, test } from 'bun:test';
import {
  buildTmuxWebLaunch,
  parseTmuxWebListeningLine,
  startTmuxWebServer,
} from '../../../src/desktop/server-process.js';

const credentials = { username: 'tmux-term-user', password: 'random-secret' };

async function bunScriptLaunch(script: string, startupTimeoutMs = 1_000) {
  const scriptPath = `/tmp/tmux-web-child-${crypto.randomUUID()}.ts`;
  await Bun.write(scriptPath, `#!${process.execPath}\n${script}`);
  await Bun.spawn(['chmod', '+x', scriptPath]).exited;
  return {
    executable: scriptPath,
    credentials,
    startupTimeoutMs,
  };
}

async function fileExists(path: string): Promise<boolean> {
  return await Bun.file(path).exists();
}

async function waitForFile(path: string, timeoutMs = 1_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await fileExists(path)) return;
    await Bun.sleep(10);
  }
  throw new Error(`timed out waiting for ${path}`);
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForPidExit(pid: number, timeoutMs = 1_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isPidAlive(pid)) return;
    await Bun.sleep(10);
  }
  throw new Error(`pid ${pid} is still alive`);
}

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

  test('buildTmuxWebLaunch rejects unsafe executable args', () => {
    for (const opts of [
      {
        executable: '/opt/tmux-term/tmux-web',
        executableArgs: ['--no-auth'],
      },
      {
        executable: 'bun',
        executableArgs: ['--no-auth'],
      },
      {
        executable: 'bun',
        executableArgs: ['src/server/index.ts', '--no-auth'],
      },
      {
        executable: '/opt/tmux-term/tmux-web',
        executableArgs: ['tmux'],
      },
    ]) {
      expect(() =>
        buildTmuxWebLaunch({
          ...opts,
          credentials,
        }),
      ).toThrow('not allowed');
    }
  });

  test('buildTmuxWebLaunch allows only safe desktop customization args', () => {
    for (const extraArgs of [
      ['--tmux', '/usr/bin/tmux'],
      ['--tmux=/usr/bin/tmux'],
      ['--tmux-conf', '/tmp/tmux.conf'],
      ['--tmux-conf=/tmp/tmux.conf'],
      ['--themes-dir', '/tmp/themes'],
      ['--themes-dir=/tmp/themes'],
      ['--debug'],
      ['-d'],
    ]) {
      expect(
        buildTmuxWebLaunch({
          executable: '/opt/tmux-term/tmux-web',
          credentials,
          extraArgs,
        }).args,
      ).toEqual(['--listen', '127.0.0.1:0', '--no-tls', ...extraArgs]);
    }
  });

  test('buildTmuxWebLaunch rejects unsafe or unknown extra args', () => {
    for (const extraArgs of [
      ['--no-auth'],
      ['--listen', '0.0.0.0:0'],
      ['--password=secret'],
      ['-p', 'secret'],
      ['--test'],
      ['--allow-origin', '*'],
      ['--allow-origin=*'],
      ['--allow-ip', '127.0.0.1'],
      ['--reset'],
      ['--help'],
      ['--version'],
      ['positional'],
    ]) {
      expect(() =>
        buildTmuxWebLaunch({
          executable: '/opt/tmux-term/tmux-web',
          credentials,
          extraArgs,
        }),
      ).toThrow('not allowed');
    }
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

  test('startTmuxWebServer resolves readiness from a partial stdout line', async () => {
    const server = await startTmuxWebServer(
      await bunScriptLaunch(`
        process.stdout.write('tmux-web listening on http://127.0.0.1:');
        setTimeout(() => process.stdout.write('38123\\n'), 10);
        setInterval(() => {}, 1_000);
      `),
    );

    try {
      expect(server.endpoint).toEqual({
        host: '127.0.0.1',
        port: 38123,
        origin: 'http://127.0.0.1:38123',
      });
    } finally {
      await server.close();
    }
  });

  test('startTmuxWebServer rejects when child exits before readiness', async () => {
    await expect(
      startTmuxWebServer(
        await bunScriptLaunch(`
          process.stdout.write('warning: booting\\n');
          process.exit(7);
        `),
      ),
    ).rejects.toThrow('tmux-web exited before readiness with status 7');
  });

  test('startTmuxWebServer timeout terminates a child that never reports readiness', async () => {
    const marker = `/tmp/tmux-web-timeout-${crypto.randomUUID()}`;

    await expect(
      startTmuxWebServer(
        await bunScriptLaunch(
          `
            process.on('SIGTERM', async () => {
              await Bun.write(${JSON.stringify(marker)}, 'terminated');
              process.exit(0);
            });
            setInterval(() => {}, 1_000);
          `,
          50,
        ),
      ),
    ).rejects.toThrow('tmux-web did not report readiness within 50ms');

    await waitForFile(marker);
  });

  test('startTmuxWebServer timeout kills a pre-readiness child that ignores SIGTERM', async () => {
    const pidFile = `/tmp/tmux-web-timeout-pid-${crypto.randomUUID()}`;

    await Bun.write(pidFile, '');
    await expect(
      startTmuxWebServer({
        ...(await bunScriptLaunch(
          `
            await Bun.write(${JSON.stringify(pidFile)}, String(process.pid));
            process.on('SIGTERM', () => {});
            setInterval(() => {}, 1_000);
          `,
          50,
        )),
        closeGraceMs: 50,
      }),
    ).rejects.toThrow('tmux-web did not report readiness within 50ms');

    const pid = Number((await Bun.file(pidFile).text()).trim());
    expect(Number.isInteger(pid)).toBe(true);
    await waitForPidExit(pid);
  });

  test('close terminates a child after readiness', async () => {
    const marker = `/tmp/tmux-web-close-${crypto.randomUUID()}`;
    const server = await startTmuxWebServer(
      await bunScriptLaunch(`
        process.stdout.write('tmux-web listening on http://127.0.0.1:38123\\n');
        process.on('SIGTERM', async () => {
          await Bun.write(${JSON.stringify(marker)}, 'closed');
          process.exit(0);
        });
        setInterval(() => {}, 1_000);
      `),
    );

    await server.close();

    await waitForFile(marker);
  });

  test('close uses a kill fallback when a child ignores SIGTERM', async () => {
    const server = await startTmuxWebServer(
      await bunScriptLaunch(`
        process.stdout.write('tmux-web listening on http://127.0.0.1:38123\\n');
        process.on('SIGTERM', () => {});
        setInterval(() => {}, 1_000);
      `),
    );

    await expect(Promise.race([
      server.close().then(() => 'closed'),
      Bun.sleep(1_000).then(() => 'timeout'),
    ])).resolves.toBe('closed');
  });
});
