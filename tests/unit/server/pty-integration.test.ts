import { describe, test, expect } from 'bun:test';
import { spawnPty, buildPtyCommand, buildPtyEnv } from '../../../src/server/pty.ts';

describe('spawnPty (test-mode cat)', () => {
  test('onData sees echoed bytes; onExit fires on kill; resize does not throw', async () => {
    const cmd = buildPtyCommand({ testMode: true, session: 'x', tmuxConfPath: '/ignored', tmuxBin: 'tmux' });
    const pty = spawnPty({ command: cmd, env: buildPtyEnv(), cols: 80, rows: 24 });

    const chunks: string[] = [];
    pty.onData(d => chunks.push(d));
    const exited = new Promise<void>(r => pty.onExit(() => r()));

    pty.write('hello\n');
    await new Promise(r => setTimeout(r, 80));
    expect(chunks.join('')).toContain('hello');

    pty.resize(100, 30);
    pty.kill();
    await exited;
  });

  test('default onData/onExit closures run when callbacks never registered', async () => {
    // Spawn a short-lived process (/bin/true) and write a byte to it before
    // registering any callbacks. This exercises the default no-op closures
    // on lines 64–65 of pty.ts (the `let onDataCallback = () => {}` /
    // `let onExitCallback = () => {}` defaults).
    const pty = spawnPty({
      command: { file: '/bin/sh', args: ['-c', 'echo hi'] },
      env: buildPtyEnv(),
      cols: 80,
      rows: 24,
    });
    // Poke the terminal so data arrives before any onData(cb) is registered.
    pty.write(' ');
    // Give the process time to exit and data to flush through the default
    // no-op handlers.
    await new Promise(r => setTimeout(r, 150));
    // write/resize after exit must not throw even with no callbacks registered.
    pty.resize(81, 25);
    pty.write('ignored after exit');
  });
});
