import { describe, test, expect } from 'bun:test';
import {
  ControlPool,
  NoControlClientError,
  type ControlProc,
  type TmuxNotification,
} from '../../../src/server/tmux-control.ts';

function fakeProc(): { proc: ControlProc; stdout: { emit: (s: string) => void }; writes: string[]; exit: () => void } {
  const writes: string[] = [];
  const stdin = { write: (s: string) => { writes.push(s); return true; }, end: () => {} };
  type L = (c: Buffer) => void; const ls: L[] = [];
  const stdout = {
    on: (_: string, cb: L) => { ls.push(cb); },
    emit: (s: string) => { for (const l of ls) l(Buffer.from(s, 'utf8')); },
  };
  let exitCb: (() => void) | null = null;
  const proc: ControlProc = {
    stdin, stdout: stdout as any,
    exited: new Promise(resolve => { exitCb = resolve; }),
    kill: () => { exitCb?.(); },
  };
  return { proc, stdout, writes, exit: () => exitCb?.() };
}

function extractProbeToken(write: string): string {
  const m = write.match(/^display-message -p (.+)\n$/);
  if (!m) throw new Error(`Not a probe write: ${JSON.stringify(write)}`);
  return m[1]!;
}

/** Drive the handshake for a freshly-started session.
 *  With a size hint: emits refresh-client response, waits a tick, then
 *  emits the probe response with the token extracted from the write log.
 *  Without a hint: only the probe phase (one emit). */
async function driveHandshake(p: Promise<void>, fake: ReturnType<typeof fakeProc>): Promise<void> {
  await Promise.resolve();
  if (fake.writes[0]?.startsWith('refresh-client')) {
    // tmux 3.6a: user stdin commands get flags=1 in their %begin envelope.
    fake.stdout.emit('%begin 1 1 1\n%end 1 1 1\n');
    await Promise.resolve();
    const token = extractProbeToken(fake.writes[1]!);
    fake.stdout.emit(`%begin 2 2 1\n${token}\n%end 2 2 1\n`);
  } else {
    const token = extractProbeToken(fake.writes[0]!);
    fake.stdout.emit(`%begin 1 1 1\n${token}\n%end 1 1 1\n`);
  }
  await p;
}

/** Attach a session and complete its handshake. The spawn callback must push
 *  into `spawns` so we can capture the proc the pool actually uses. */
async function attachHappy(pool: ControlPool, name: string, spawns: ReturnType<typeof fakeProc>[]) {
  const lenBefore = spawns.length;
  const p = pool.attachSession(name);
  // spawn was called synchronously — spawns has a new entry now.
  const fake = spawns[lenBefore]!;
  await driveHandshake(p, fake);
}

describe('ControlPool', () => {
  test('attachSession is idempotent and first attach becomes primary', async () => {
    const spawns: ReturnType<typeof fakeProc>[] = [];
    const pool = new ControlPool({ spawn: (_session) => {
      const p = fakeProc();
      spawns.push(p);
      return p.proc;
    } });

    const a1 = pool.attachSession('main');
    // spawn was called synchronously — spawns[0] is the proc.
    await driveHandshake(a1, spawns[0]!);

    // Idempotent: second call returns the cached promise, no new spawn.
    await pool.attachSession('main');
    expect(spawns.length).toBe(1);
  });

  test('primary = oldest-alive; promotes next on primary death', async () => {
    const spawns: ReturnType<typeof fakeProc>[] = [];
    const pool = new ControlPool({ spawn: () => { const p = fakeProc(); spawns.push(p); return p.proc; } });

    await attachHappy(pool, 'main', spawns);  // spawns[0]
    await attachHappy(pool, 'dev',  spawns);  // spawns[1]

    // Fire a notification from BOTH; only the primary should fan out.
    const notes: TmuxNotification[] = [];
    pool.on('sessionsChanged', (n) => notes.push(n));
    spawns[0]!.stdout.emit('%sessions-changed\n');   // primary — delivered
    spawns[1]!.stdout.emit('%sessions-changed\n');   // non-primary — dropped
    expect(notes).toHaveLength(1);

    // Kill primary. Next-oldest promotes.
    spawns[0]!.exit();
    await Promise.resolve();
    spawns[1]!.stdout.emit('%sessions-changed\n');
    expect(notes).toHaveLength(2);
  });

  test('window notifications from non-primary sessions are delivered with their session name', async () => {
    const spawns: ReturnType<typeof fakeProc>[] = [];
    const pool = new ControlPool({ spawn: () => { const p = fakeProc(); spawns.push(p); return p.proc; } });

    await attachHappy(pool, 'main', spawns);
    await attachHappy(pool, 'dev', spawns);

    const adds: TmuxNotification[] = [];
    const closes: TmuxNotification[] = [];
    const renames: TmuxNotification[] = [];
    pool.on('windowAdd', (n) => adds.push(n));
    pool.on('windowClose', (n) => closes.push(n));
    pool.on('windowRenamed', (n) => renames.push(n));

    spawns[1]!.stdout.emit('%window-add @7\n');
    spawns[1]!.stdout.emit('%window-close @8\n');
    spawns[1]!.stdout.emit('%window-renamed @9 devname\n');

    expect(adds).toEqual([{ type: 'windowAdd', window: '@7', session: 'dev' }]);
    expect(closes).toEqual([{ type: 'windowClose', window: '@8', session: 'dev' }]);
    expect(renames).toEqual([{ type: 'windowRenamed', window: '@9', name: 'devname', session: 'dev' }]);
  });

  test('run() rejects NoControlClientError when the pool is empty', async () => {
    const pool = new ControlPool({ spawn: () => fakeProc().proc });
    await expect(pool.run(['list-sessions'])).rejects.toBeInstanceOf(NoControlClientError);
  });

  test('detachSession kills the client and removes it from primary tracking', async () => {
    const spawns: ReturnType<typeof fakeProc>[] = [];
    const pool = new ControlPool({ spawn: () => { const p = fakeProc(); spawns.push(p); return p.proc; } });
    await attachHappy(pool, 'main', spawns);
    pool.detachSession('main');
    await expect(pool.run(['list-sessions'])).rejects.toBeInstanceOf(NoControlClientError);
  });

  test('hasSession reflects fully-attached sessions only', async () => {
    const spawns: ReturnType<typeof fakeProc>[] = [];
    const pool = new ControlPool({ spawn: () => { const p = fakeProc(); spawns.push(p); return p.proc; } });
    expect(pool.hasSession('main')).toBe(false);
    await attachHappy(pool, 'main', spawns);
    expect(pool.hasSession('main')).toBe(true);
    expect(pool.hasSession('other')).toBe(false);
    pool.detachSession('main');
    expect(pool.hasSession('main')).toBe(false);
  });

  test('refresh-client uses the cols/rows hint from attachSession (regression: huge default bounced layout to 10000x10000 then back)', async () => {
    const spawns: ReturnType<typeof fakeProc>[] = [];
    const pool = new ControlPool({ spawn: () => { const p = fakeProc(); spawns.push(p); return p.proc; } });
    const p = pool.attachSession('main', { cols: 200, rows: 60 });
    await Promise.resolve();
    // First write must be refresh-client -C 200x60 — matching the sibling
    // PTY client's size — so under `window-size latest` the control
    // client's attach doesn't make tmux jump the layout to a different
    // size than the PTY client.
    expect(spawns[0]!.writes[0]).toBe('refresh-client -C 200x60\n');
    await driveHandshake(p, spawns[0]!);
  });

  test('attachSession without a size hint skips refresh-client entirely (lets tmux resolve size)', async () => {
    const spawns: ReturnType<typeof fakeProc>[] = [];
    const pool = new ControlPool({ spawn: () => { const p = fakeProc(); spawns.push(p); return p.proc; } });
    const p = pool.attachSession('main');
    await Promise.resolve();
    // No `refresh-client` write — first command is the probe.
    expect(spawns[0]!.writes[0]).toMatch(/^display-message -p /);
    const token = extractProbeToken(spawns[0]!.writes[0]!);
    // One-phase handshake: only the display-message probe.
    await Promise.resolve();
    spawns[0]!.stdout.emit(`%begin 1 1 1\n${token}\n%end 1 1 1\n`);
    await p;
  });

  test('detach-before-probe kills the spawned client rather than leaking it', async () => {
    let killed = false;
    const spawns: ReturnType<typeof fakeProc>[] = [];
    const pool = new ControlPool({
      spawn: () => {
        const p = fakeProc();
        const origKill = p.proc.kill;
        p.proc.kill = () => { killed = true; origKill(); };
        spawns.push(p);
        return p.proc;
      },
    });

    // Probe is dispatched synchronously inside pool.attachSession.
    const attach = pool.attachSession('main');
    await Promise.resolve();

    // Detach while startSession is awaiting the probe.
    pool.detachSession('main');

    // Resolve the probe with the correct token. The wasCancelled guard
    // fires and kills the client instead of inserting it into the pool.
    const token = extractProbeToken(spawns[0]!.writes[0]!);
    spawns[0]!.stdout.emit(`%begin 1 1 1\n${token}\n%end 1 1 1\n`);
    await attach;

    expect(killed).toBe(true);
    await expect(pool.run(['list-sessions'])).rejects.toBeInstanceOf(NoControlClientError);
  });

  test('probe drains stray %begin/%end and pendingStaleBegins prevents next command from getting the floating response', async () => {
    // Regression: tmux emits stray %begin/%end during attach-session bookkeeping.
    // The stray is attributed to the first probe DM (probe resolves with "").
    // probe() re-sends DM and gets the real response; but the re-sent DM's real
    // response is still in transit. pendingStaleBegins must absorb it so the
    // next pool.run() command gets its own response rather than the probe echo.
    const spawns: ReturnType<typeof fakeProc>[] = [];
    const pool = new ControlPool({ spawn: () => { const p = fakeProc(); spawns.push(p); return p.proc; } });

    const attach = pool.attachSession('main');
    const fake = spawns[0]!;
    await Promise.resolve();

    // Stray %begin/%end from tmux attach-session bookkeeping (flags=0 in
    // tmux 3.6a for internal envelopes). Attributed to writes[0]'s pending;
    // probe() gets "" back.
    fake.stdout.emit('%begin 1 1 0\n%end 1 1 0\n');
    // probe() sees "" ≠ token, sends a second DM (writes[1]).
    await Promise.resolve();

    // Real response for writes[0] arrives (flags=1: user stdin command) and is
    // attributed to writes[1]'s pending (writes[0]'s pending was already resolved).
    const token = extractProbeToken(fake.writes[1]!);
    fake.stdout.emit(`%begin 2 2 1\n${token}\n%end 2 2 1\n`);
    // probe(): token matches, iterations=2 → pendingStaleBegins += 1.
    await attach;

    // Issue a real command after attach.
    const runP = pool.run(['list-windows']);
    await Promise.resolve();

    // Floating real response for writes[1] arrives. pendingStaleBegins=1
    // absorbs the %begin so it is NOT attributed to the list-windows pending.
    fake.stdout.emit(`%begin 3 3 1\n${token}\n%end 3 3 1\n`);
    await Promise.resolve();

    // list-windows now gets its own %begin and resolves with the correct data.
    fake.stdout.emit('%begin 4 4 1\nwindow-data\n%end 4 4 1\n');

    expect(await runP).toBe('window-data');
  });

  test('tmux 3.6a: flags=1 %begin (user stdin command) is correctly attributed to in-flight command', async () => {
    // In tmux 3.6a, stdin-sent commands receive flags=1 in their %begin line
    // (flags=0 is the internal stray at attach time, handled by !head guard
    // and probe()). The pool must attribute flags=1 %begin to the pending head.
    const spawns: ReturnType<typeof fakeProc>[] = [];
    const pool = new ControlPool({ spawn: () => { const p = fakeProc(); spawns.push(p); return p.proc; } });
    await attachHappy(pool, 'main', spawns);

    const fake = spawns[0]!;
    const runP = pool.run(['list-windows']);
    await Promise.resolve();  // list-windows dispatched, tmuxCmdnum=null

    // Real tmux 3.6a response: flags=1 for user stdin command.
    fake.stdout.emit('%begin 1 88260 1\nwindow-data\n%end 1 88260 1\n');

    expect(await runP).toBe('window-data');
  });

  test('close kills clients that are still completing their attach probe', async () => {
    let killed = false;
    const spawns: ReturnType<typeof fakeProc>[] = [];
    const pool = new ControlPool({
      spawn: () => {
        const p = fakeProc();
        const origKill = p.proc.kill;
        p.proc.kill = () => { killed = true; origKill(); };
        spawns.push(p);
        return p.proc;
      },
    });

    const attach = pool.attachSession('main');
    await Promise.resolve();

    await pool.close();

    expect(killed).toBe(true);
    await expect(attach).rejects.toMatchObject({ stderr: 'control client exited' });
  });
});
