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

/** Drive the two-phase handshake for a freshly-started session.
 *  The pool dispatches refresh-client synchronously (before the first await),
 *  so after `pool.attachSession` returns a promise, `fake` is already the
 *  active proc. We emit refresh-client response, wait a tick for display-message
 *  to be dispatched, then emit its response. */
async function driveHandshake(p: Promise<void>, fake: ReturnType<typeof fakeProc>): Promise<void> {
  // Tick 1: refresh-client has been dispatched synchronously. Resolve it.
  await Promise.resolve();
  fake.stdout.emit('%begin 1 1 0\n%end 1 1 0\n');
  // Tick 2: display-message is now dispatched. Resolve it.
  await Promise.resolve();
  fake.stdout.emit('%begin 2 2 0\nok\n%end 2 2 0\n');
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
});
