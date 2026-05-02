import { describe, expect, test } from 'bun:test';
import {
  buildTmuxWebLaunch,
  createCloseOnce,
  parseTmuxWebListeningLine,
  startTmuxWebServer,
} from '../../../src/desktop/server-process.js';

const credentials = {
  username: 'tmux-term-user',
  password: 'random-secret',
  clientToken: 'client-token',
};

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

async function waitForText(read: () => string, expected: string, timeoutMs = 1_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (read().includes(expected)) return;
    await Bun.sleep(10);
  }
  throw new Error(`timed out waiting for ${expected}`);
}

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`invalid pid ${pid}`);
  }
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

async function waitForPidFile(path: string, timeoutMs = 1_000): Promise<number> {
  const startedAt = Date.now();
  let lastText = '';
  while (Date.now() - startedAt < timeoutMs) {
    lastText = (await Bun.file(path).text()).trim();
    const pid = Number(lastText);
    if (Number.isInteger(pid) && pid > 0) return pid;
    await Bun.sleep(10);
  }
  throw new Error(`timed out waiting for valid pid in ${path}; last value=${JSON.stringify(lastText)}`);
}

describe('desktop tmux-web launch helpers', () => {
  test('buildTmuxWebLaunch binds loopback port 0 and keeps password out of argv', () => {
    const launch = buildTmuxWebLaunch({
      executable: '/opt/tmux-term/tmux-web',
      credentials: {
        username: 'tmux-term-user',
        password: 'random-secret',
        clientToken: 'client-token',
      },
      extraArgs: ['--tmux', '/usr/bin/tmux'],
      env: { PATH: '/usr/bin', TMUX_WEB_PASSWORD: 'old' },
    });

    expect(launch.cmd).toBe('/opt/tmux-term/tmux-web');
    expect(launch.args).toEqual([
      '--listen',
      '127.0.0.1:0',
      '--no-tls',
      '--debug',
      '--tmux',
      '/usr/bin/tmux',
    ]);
    expect(launch.args.join(' ')).not.toContain('random-secret');
    expect(launch.env.TMUX_WEB_USERNAME).toBe('tmux-term-user');
    expect(launch.env.TMUX_WEB_PASSWORD).toBe('random-secret');
    expect(launch.env.TMUX_WEB_CLIENT_AUTH_TOKEN).toBe('client-token');
    expect(launch.env.TMUX_WEB_EXPOSE_CLIENT_AUTH).toBe('1');
    expect(launch.env.PATH).toBe('/usr/bin');
  });

  test('buildTmuxWebLaunch pins desktop sessions to the normal tmux-web store', () => {
    const launch = buildTmuxWebLaunch({
      executable: '/opt/tmux-term/tmux-web',
      credentials,
      env: { HOME: '/Users/per', PATH: '/bin' },
    });

    expect(launch.env.TMUX_WEB_SESSIONS_FILE).toBe('/Users/per/.config/tmux-web/sessions.json');
  });

  test('buildTmuxWebLaunch preserves explicit sessions store override', () => {
    const launch = buildTmuxWebLaunch({
      executable: '/opt/tmux-term/tmux-web',
      credentials,
      env: {
        HOME: '/Users/per',
        PATH: '/bin',
        TMUX_WEB_SESSIONS_FILE: '/tmp/custom-sessions.json',
      },
    });

    expect(launch.env.TMUX_WEB_SESSIONS_FILE).toBe('/tmp/custom-sessions.json');
  });

  test('buildTmuxWebLaunch supports running the server through bun', () => {
    const launch = buildTmuxWebLaunch({
      executable: 'bun',
      executableArgs: ['src/server/index.ts'],
      credentials,
    });

    expect(launch.cmd).toBe('bun');
    expect(launch.args).toEqual([
      'src/server/index.ts',
      '--listen',
      '127.0.0.1:0',
      '--no-tls',
      '--debug',
    ]);
  });

  test('buildTmuxWebLaunch appends test mode only from the typed option', () => {
    const launch = buildTmuxWebLaunch({
      executable: 'bun',
      executableArgs: ['src/server/index.ts'],
      credentials,
      testMode: true,
    });

    expect(launch.args).toEqual([
      'src/server/index.ts',
      '--listen',
      '127.0.0.1:0',
      '--no-tls',
      '--debug',
      '--test',
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
      ).toEqual([
        '--listen',
        '127.0.0.1:0',
        '--no-tls',
        ...(extraArgs.includes('--debug') || extraArgs.includes('-d') ? [] : ['--debug']),
        ...extraArgs,
      ]);
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

  test('createCloseOnce runs cleanup once', async () => {
    let calls = 0;
    const close = createCloseOnce(async () => { calls += 1; });

    await close();
    await close();
    await close();

    expect(calls).toBe(1);
  });

  test('createCloseOnce waits for in-flight cleanup', async () => {
    let calls = 0;
    let releaseCleanup!: () => void;
    const cleanupReleased = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    const close = createCloseOnce(async () => {
      calls += 1;
      await cleanupReleased;
    });

    const firstClose = close();
    const secondClose = close();
    let secondSettled = false;
    void secondClose.then(() => {
      secondSettled = true;
    });

    await Bun.sleep(0);
    expect(secondSettled).toBe(false);
    expect(calls).toBe(1);

    releaseCleanup();
    await Promise.all([firstClose, secondClose]);
    expect(secondSettled).toBe(true);
    expect(calls).toBe(1);
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

  test('startTmuxWebServer forwards child output after readiness', async () => {
    const chunks: Array<{ stream: 'stdout' | 'stderr'; text: string }> = [];
    const server = await startTmuxWebServer({
      ...(await bunScriptLaunch(`
        process.stdout.write('tmux-web listening on http://127.0.0.1:38123\\n');
        setTimeout(() => {
          process.stderr.write('[debug] HTTP GET /dist/client/xterm.js\\n');
        }, 10);
        setInterval(() => {}, 1_000);
      `)),
      onOutput: (stream, text) => chunks.push({ stream, text }),
    });

    try {
      await waitForText(
        () => chunks.filter(c => c.stream === 'stderr').map(c => c.text).join(''),
        '[debug] HTTP GET /dist/client/xterm.js',
      );
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
    const startupTimeoutMs = 1_000;

    await Bun.write(pidFile, '');
    const pendingServer = startTmuxWebServer({
      ...(await bunScriptLaunch(
        `
          process.on('SIGTERM', () => {});
          await Bun.write(${JSON.stringify(pidFile)}, String(process.pid));
          setInterval(() => {}, 1_000);
        `,
        startupTimeoutMs,
      )),
      closeGraceMs: 50,
    });

    const pid = await waitForPidFile(pidFile, 3_000);
    await expect(pendingServer).rejects.toThrow(
      `tmux-web did not report readiness within ${startupTimeoutMs}ms`,
    );
    await waitForPidExit(pid, 3_000);
  });

  test('close terminates a child after readiness', async () => {
    const marker = `/tmp/tmux-web-close-${crypto.randomUUID()}`;
    const server = await startTmuxWebServer(
      await bunScriptLaunch(`
        process.on('SIGTERM', () => {
          require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'closed');
          process.exit(0);
        });
        process.stdout.write('tmux-web listening on http://127.0.0.1:38123\\n');
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
