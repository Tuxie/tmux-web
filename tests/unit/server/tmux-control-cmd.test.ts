import { describe, test, expect } from 'bun:test';
import { ControlClient } from '../../../src/server/tmux-control.ts';

/** Scripted stdio pair: stdin is a MemoryWritable that records every
 *  write; stdout is a pushable readable the test drives frame-by-frame. */
function makeStdio() {
  const writes: string[] = [];
  const stdin = {
    write: (s: string) => { writes.push(s); return true; },
    end: () => {},
  };
  type Listener = (chunk: Buffer) => void;
  const listeners: Listener[] = [];
  const stdout = {
    on: (_e: string, cb: Listener) => { listeners.push(cb); },
    emit: (s: string) => { for (const l of listeners) l(Buffer.from(s, 'utf8')); },
  };
  let exitCb: (() => void) | null = null;
  const proc = {
    stdin, stdout,
    exited: new Promise<void>(resolve => { exitCb = resolve; }),
    kill: () => { exitCb?.(); },
  };
  return { writes, stdout, proc, exit: () => exitCb?.() };
}

describe('ControlClient', () => {
  test('serialises commands: writes one line then awaits %end', async () => {
    const { writes, stdout, proc } = makeStdio();
    const client = new ControlClient(proc as any);
    const p = client.run(['list-sessions']);
    // Give the microtask loop a tick so the client wrote stdin.
    await Promise.resolve();
    expect(writes).toEqual(['list-sessions\n']);
    stdout.emit('%begin 1 1 0\nfoo\nbar\n%end 1 1 0\n');
    expect(await p).toBe('foo\nbar');
  });

  test('advances the backlog after each response', async () => {
    const { writes, stdout, proc } = makeStdio();
    const client = new ControlClient(proc as any);
    const p1 = client.run(['list-sessions']);
    const p2 = client.run(['list-windows', '-t', 'main']);
    await Promise.resolve();
    // Only the first command is on the wire.
    expect(writes).toEqual(['list-sessions\n']);
    stdout.emit('%begin 1 1 0\none\n%end 1 1 0\n');
    expect(await p1).toBe('one');
    await Promise.resolve();
    expect(writes).toEqual(['list-sessions\n', 'list-windows -t main\n']);
    stdout.emit('%begin 2 2 0\ntwo\n%end 2 2 0\n');
    expect(await p2).toBe('two');
  });

  test('rejects with TmuxCommandError on %error', async () => {
    const { stdout, proc } = makeStdio();
    const client = new ControlClient(proc as any);
    const p = client.run(['bogus-command']);
    await Promise.resolve();
    stdout.emit('%begin 1 1 0\nunknown command: bogus-command\n%error 1 1 0\n');
    await expect(p).rejects.toMatchObject({
      name: 'TmuxCommandError',
      stderr: 'unknown command: bogus-command',
      args: ['bogus-command'],
    });
  });

  test('rejects in-flight + queued commands on process exit', async () => {
    const { proc, exit } = makeStdio();
    const client = new ControlClient(proc as any);
    const p1 = client.run(['list-sessions']);
    const p2 = client.run(['list-windows']);
    await Promise.resolve();
    exit();
    await Promise.resolve();
    await expect(p1).rejects.toMatchObject({ stderr: 'control client exited' });
    await expect(p2).rejects.toMatchObject({ stderr: 'control client exited' });
    expect(client.isAlive()).toBe(false);
  });

  test('rejects with "timeout" after commandTimeoutMs but keeps the client alive', async () => {
    const { stdout, proc } = makeStdio();
    const client = new ControlClient(proc as any, () => {}, { commandTimeoutMs: 20 });
    const p = client.run(['sleeps-forever']);
    await expect(p).rejects.toMatchObject({ stderr: 'timeout' });
    expect(client.isAlive()).toBe(true);

    // After timeout: a late-arriving stale response for cmdnum 1 is
    // dropped on the cmdnum-mismatch guard (next real cmdnum is 2).
    stdout.emit('%begin 1 1 0\nlate\n%end 1 1 0\n');
    const p2 = client.run(['list-sessions']);
    await Promise.resolve();
    stdout.emit('%begin 2 2 0\nok\n%end 2 2 0\n');
    expect(await p2).toBe('ok');
  });
});
