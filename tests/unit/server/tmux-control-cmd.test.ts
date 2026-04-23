import { describe, test, expect } from 'bun:test';
import { ControlClient, buildControlSpawnArgs, quoteTmuxArg } from '../../../src/server/tmux-control.ts';

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

  test('quotes args containing whitespace before joining (regression: list-windows -F "...\\t...")', async () => {
    const { writes, stdout, proc } = makeStdio();
    const client = new ControlClient(proc as any);
    const fmt = '#{window_index}\t#{window_name}\t#{window_active}';
    const p = client.run(['list-windows', '-t', 'main', '-F', fmt]);
    await Promise.resolve();
    // Args with whitespace must be quoted so tmux's own command parser
    // doesn't tokenise the format string into separate -F arguments.
    expect(writes).toEqual([`list-windows -t main -F "${fmt}"\n`]);
    stdout.emit('%begin 1 1 0\n0\tone\t1\n%end 1 1 0\n');
    expect(await p).toBe('0\tone\t1');
  });

  test('quoteTmuxArg passes safe tokens through, escapes the rest', () => {
    expect(quoteTmuxArg('list-sessions')).toBe('list-sessions');
    expect(quoteTmuxArg('main')).toBe('main');
    expect(quoteTmuxArg('@17')).toBe('@17');
    // Whitespace → wrap in double quotes.
    expect(quoteTmuxArg('a b')).toBe('"a b"');
    // Existing quotes / backslashes / $ get escaped inside the wrapper.
    expect(quoteTmuxArg('a"b')).toBe('"a\\"b"');
    expect(quoteTmuxArg('a\\b')).toBe('"a\\\\b"');
    expect(quoteTmuxArg('a$b')).toBe('"a\\$b"');
  });

  test('rejects with "timeout" after commandTimeoutMs but keeps the client alive', async () => {
    const { stdout, proc } = makeStdio();
    const client = new ControlClient(proc as any, () => {}, { commandTimeoutMs: 20 });
    const p = client.run(['sleeps-forever']);
    await expect(p).rejects.toMatchObject({ stderr: 'timeout' });
    expect(client.isAlive()).toBe(true);

    // Late `%begin/%end` for the timed-out command is dropped via the
    // pendingStaleBegins counter (no head-cmdnum was assigned yet because
    // tmux hadn't echoed `%begin` before the timeout fired).
    stdout.emit('%begin 1 1 0\nlate\n%end 1 1 0\n');
    const p2 = client.run(['list-sessions']);
    await Promise.resolve();
    stdout.emit('%begin 2 2 0\nok\n%end 2 2 0\n');
    expect(await p2).toBe('ok');
  });

  test('matches responses by tmux-server cmdnum from %begin (regression: empty windows when tmux echoes a server-global id)', async () => {
    // Real tmux uses a server-global cmd-id, often a large number that
    // bears no relation to the order of writes from a given client. Before
    // this fix ControlClient assumed cmdnum 1, 2, 3, … and silently dropped
    // every real response — which made `attachSession` hang forever and
    // `/api/windows` return [].
    const { writes, stdout, proc } = makeStdio();
    const client = new ControlClient(proc as any);
    const p = client.run(['list-windows', '-t', 'main', '-F', '#{window_index}\t#{window_name}\t#{window_active}']);
    await Promise.resolve();
    expect(writes.length).toBe(1);
    // tmux echoes its own cmd-id (here 75792) — ControlClient must capture
    // it from %begin and use it to match the trailing %end.
    stdout.emit('%begin 1776925932 75792 0\n0\tone\t1\n1\ttwo\t0\n%end 1776925932 75792 0\n');
    expect(await p).toBe('0\tone\t1\n1\ttwo\t0');
  });

  test('subsequent commands receive distinct tmux cmdnums, each matched independently', async () => {
    const { stdout, proc } = makeStdio();
    const client = new ControlClient(proc as any);
    const p1 = client.run(['list-sessions']);
    await Promise.resolve();
    stdout.emit('%begin 100 75792 0\nalpha\n%end 100 75792 0\n');
    expect(await p1).toBe('alpha');
    const p2 = client.run(['list-windows']);
    await Promise.resolve();
    stdout.emit('%begin 101 75900 0\nbeta\n%end 101 75900 0\n');
    expect(await p2).toBe('beta');
  });

  test('%error carries tmux cmdnum and rejects the matching pending', async () => {
    const { stdout, proc } = makeStdio();
    const client = new ControlClient(proc as any);
    const p = client.run(['bogus']);
    await Promise.resolve();
    stdout.emit('%begin 9 42424 0\nunknown command: bogus\n%error 9 42424 0\n');
    await expect(p).rejects.toMatchObject({ name: 'TmuxCommandError', stderr: 'unknown command: bogus' });
  });

  test('buildControlSpawnArgs forces UTF-8 via -u (regression: LANG=C parents made tmux replace tabs and non-ASCII with "_")', () => {
    // Without `-u`, tmux autodetects UTF-8 from LC_ALL / LC_CTYPE / LANG.
    // A bun process started with LANG=C (systemd units, login shells with
    // no locale configured) makes tmux fall back to safe-string output —
    // tabs and any non-ASCII byte in a format-string result are replaced
    // by `_`, which the browser sees as "1_claude_1: undefined" because
    // `line.split('\t')` finds nothing to split on. `-u` is more robust
    // than relying on the spawn-time environment.
    const args = buildControlSpawnArgs('tmux', '/etc/tmux.conf', 'main');
    expect(args).toContain('-u');
    // Sanity: the rest of the invocation is intact.
    expect(args[0]).toBe('tmux');
    expect(args).toContain('-C');
    expect(args).toContain('attach-session');
    expect(args[args.length - 1]).toBe('main');
  });
});
