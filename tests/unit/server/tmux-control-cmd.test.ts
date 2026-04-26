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

  test('debug log records command queue, dispatch, begin, and response timing', async () => {
    const { writes, stdout, proc } = makeStdio();
    const logs: string[] = [];
    const client = new ControlClient(proc as any, () => {}, { log: (line) => logs.push(line) });
    const p = client.run(['list-sessions']);
    await Promise.resolve();
    expect(writes).toEqual(['list-sessions\n']);
    stdout.emit('%begin 1 77 1\nok\n%end 1 77 1\n');
    expect(await p).toBe('ok');

    expect(logs.some(line => line.includes('command queued') && line.includes('args=list-sessions'))).toBe(true);
    expect(logs.some(line => line.includes('command dispatch') && line.includes('args=list-sessions'))).toBe(true);
    expect(logs.some(line => line.includes('command begin') && line.includes('tmuxCmdnum=77'))).toBe(true);
    expect(logs.some(line => line.includes('command response') && line.includes('tmuxCmdnum=77'))).toBe(true);
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

  test('flags=1 %begin (tmux 3.6a: user stdin commands) is correctly attributed to pending', async () => {
    // Regression: d3e02eb added flags & 1 → stale, but in tmux 3.6a flags=1
    // means a user-sent stdin command (not internal bookkeeping). The stray
    // internal envelope at attach time has flags=0 and is already handled by
    // the !head guard and probe(). Marking flags=1 as stale discards every
    // response and causes probe to timeout after 10 iterations.
    const { stdout, proc } = makeStdio();
    const client = new ControlClient(proc as any, () => {}, { commandTimeoutMs: 100 });
    const p = client.run(['list-windows']);
    await Promise.resolve();
    stdout.emit('%begin 1 42 1\nwindow-data\n%end 1 42 1\n');
    expect(await p).toBe('window-data');
  });

  test('head timeout immediately drains the entire backlog (regression: N queued callers each waited N×5s)', async () => {
    // When multiple HTTP requests pile up behind a stuck control client, only
    // the head command is dispatched. On head timeout the backlog must be
    // rejected immediately — not after N × commandTimeoutMs — so every caller
    // falls back to execFileAsync within one timeout window.
    const { proc } = makeStdio();
    const client = new ControlClient(proc as any, () => {}, { commandTimeoutMs: 20 });

    const results = await Promise.allSettled([
      client.run(['cmd-1']),
      client.run(['cmd-2']),
      client.run(['cmd-3']),
      client.run(['cmd-4']),
      client.run(['cmd-5']),
    ]);

    // All five must be rejected with 'timeout', not 'control client exited'.
    for (const r of results) {
      expect(r.status).toBe('rejected');
      expect((r as PromiseRejectedResult).reason).toMatchObject({ stderr: 'timeout' });
    }
    // Only 1 head dispatch timed out — below kill threshold of 3.
    expect(client.isAlive()).toBe(true);
  });

  test('kills proc after 3 consecutive single-command timeouts with no successful response', async () => {
    // Circuit-breaker: after CONSECUTIVE_TIMEOUT_KILL_THRESHOLD (3) consecutive
    // dispatched-command timeouts the client kills its proc so the pool evicts
    // it and callers can fall through to execFileAsync. Each command is run
    // alone so it is actually dispatched (backlog drain doesn't count).
    const { proc } = makeStdio();
    let killed = false;
    const origKill = proc.kill;
    proc.kill = () => { killed = true; origKill(); };
    const client = new ControlClient(proc as any, () => {}, { commandTimeoutMs: 10 });

    await Promise.allSettled([client.run(['cmd-a'])]);
    expect(killed).toBe(false);
    await Promise.allSettled([client.run(['cmd-b'])]);
    expect(killed).toBe(false);
    await Promise.allSettled([client.run(['cmd-c'])]);
    expect(killed).toBe(true);
  });

  test('resets consecutive timeout count after a successful response', async () => {
    // The circuit-breaker counter must return to zero when a command succeeds,
    // so intermittent slowness does not permanently kill a healthy client.
    const { proc, stdout } = makeStdio();
    let killed = false;
    const origKill = proc.kill;
    proc.kill = () => { killed = true; origKill(); };
    const client = new ControlClient(proc as any, () => {}, { commandTimeoutMs: 10 });

    // 2 timeouts (below the kill threshold of 3)
    await expect(client.run(['a'])).rejects.toMatchObject({ stderr: 'timeout' });
    // Drain the pendingStaleBegins left by cmd-a's timeout so subsequent
    // %begin frames are attributed correctly (mirrors the existing timeout test).
    stdout.emit('%begin 1 1 0\nlate-a\n%end 1 1 0\n');
    await expect(client.run(['b'])).rejects.toMatchObject({ stderr: 'timeout' });
    stdout.emit('%begin 1 2 0\nlate-b\n%end 1 2 0\n');

    // One successful response — resets consecutiveTimeouts to 0.
    const succ = client.run(['c']);
    await Promise.resolve(); // let dispatch() write to stdin
    stdout.emit('%begin 1 3 0\nok\n%end 1 3 0\n');
    await expect(succ).resolves.toBe('ok');

    // 2 more timeouts — counter is back at 2, still below threshold.
    await expect(client.run(['d'])).rejects.toMatchObject({ stderr: 'timeout' });
    stdout.emit('%begin 1 4 0\nlate-d\n%end 1 4 0\n');
    await expect(client.run(['e'])).rejects.toMatchObject({ stderr: 'timeout' });

    expect(killed).toBe(false);
    expect(client.isAlive()).toBe(true);
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
    expect(args).toContain('new-session');
    expect(args).toContain('-A');
    expect(args).toContain('-s');
    expect(args[args.length - 1]).toBe('main');
  });
});

describe('ControlClient UTF-8 chunk handling', () => {
  /** Same scripted-stdio scaffold as makeStdio(), but lets the test split
   *  arbitrary byte payloads at chosen boundaries. */
  function makeBufferStdio() {
    const writes: string[] = [];
    const stdin = {
      write: (s: string) => { writes.push(s); return true; },
      end: () => {},
    };
    type Listener = (chunk: Buffer) => void;
    const listeners: Listener[] = [];
    const stdout = {
      on: (_e: string, cb: Listener) => { listeners.push(cb); },
      emitBytes: (bytes: Buffer | Uint8Array) => {
        const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
        for (const l of listeners) l(buf);
      },
    };
    let exitCb: (() => void) | null = null;
    const proc = {
      stdin, stdout,
      exited: new Promise<void>(resolve => { exitCb = resolve; }),
      kill: () => { exitCb?.(); },
    };
    return { writes, stdout, proc, exit: () => exitCb?.() };
  }

  test('reassembles multi-byte UTF-8 codepoints split across chunk boundaries (no U+FFFD)', async () => {
    // The bug this regression-tests: tmux control output contains a
    // window name with a non-ASCII glyph (here: katakana ナ which is
    // 0xE3 0x83 0x8A in UTF-8). Bun's stdout reads can hand the bytes
    // to us across a chunk boundary; the previous `chunk.toString('utf8')`
    // would decode each chunk independently and emit U+FFFD for the
    // incomplete trailing byte sequence. The streaming TextDecoder
    // path must produce the original codepoint intact.
    const { stdout, proc } = makeBufferStdio();
    const client = new ControlClient(proc as any);
    const p = client.run(['display-message', '-p', '#{window_name}']);
    await Promise.resolve();
    // Build one logical %begin/payload/%end frame, then split it at a
    // byte boundary that lands inside the multi-byte 'ナ' sequence
    // (between 0xE3 and 0x83 0x8A).
    const head = Buffer.from('%begin 1 1 0\n', 'utf8');
    const nameStart = Buffer.from('win-', 'utf8');
    const naBytes = Buffer.from([0xE3, 0x83, 0x8A]); // 'ナ'
    const tail = Buffer.from('\n%end 1 1 0\n', 'utf8');
    // Chunk 1 ends one byte into 'ナ'; chunk 2 has the remaining two.
    const chunk1 = Buffer.concat([head, nameStart, naBytes.slice(0, 1)]);
    const chunk2 = Buffer.concat([naBytes.slice(1), tail]);
    stdout.emitBytes(chunk1);
    stdout.emitBytes(chunk2);
    expect(await p).toBe('win-ナ');
  });
});
