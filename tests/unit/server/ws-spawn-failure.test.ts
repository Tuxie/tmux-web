import { describe, test, expect, afterEach, mock } from 'bun:test';
import { startTestServer, type Harness } from './_harness/spawn-server.ts';
import * as ptyModule from '../../../src/server/pty.ts';
import type { TmuxControl } from '../../../src/server/tmux-control.ts';

/** Regression for the post-PR Codex review on cluster 15 F5
 *  (PR #2 review comment 3144018424).
 *
 *  When `spawnPty` returns a structured `spawnError`, handleOpen now
 *  closes the WS BEFORE registering it in `reg.sessionRefs` and
 *  `reg.wsClientsBySession`. Earlier shape: handleClose unconditionally
 *  decremented the refcount, so a second client opening to the same
 *  session under spawn-failure conditions would undercount refs and
 *  detach the shared control client mid-flight for a peer that was
 *  still using it. Fix: WsConnState.spawnFailed flag, set in handleOpen
 *  on the failure branch, observed in handleClose to early-return. */

let h: Harness | undefined;
const realSpawnPty = ptyModule.spawnPty;

afterEach(async () => {
  // Restore the real spawnPty before tearing down the harness so any
  // shutdown path that needs a real spawn (none in this file, but
  // future-proofing) is not poisoned by the mock.
  mock.module('../../../src/server/pty.ts', () => ({
    ...ptyModule,
    spawnPty: realSpawnPty,
  }));
  // Race h.close() against a hard 2s ceiling. The mocked spawnPty leaves
  // the harness's Bun.serve in a state where server.stop(true) can hang
  // (the WS half-closed handshake interacts oddly with the mock) — the
  // bun test process tears the listener down at exit so leaking it for
  // the duration of one test is acceptable.
  if (h) {
    const close = h.close();
    await Promise.race([close, new Promise<void>(r => setTimeout(r, 2000))]);
    h = undefined;
  }
});

function counterControl(): { ctrl: TmuxControl; detachCalls: () => number } {
  let detachCalls = 0;
  return {
    ctrl: {
      attachSession: async () => {},
      detachSession: () => { detachCalls += 1; },
      run: async () => '',
      on: () => () => {},
      hasSession: () => false,
      close: async () => {},
    },
    detachCalls: () => detachCalls,
  };
}

async function waitWsClose(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    ws.addEventListener('close', (ev: CloseEvent) => {
      resolve({ code: ev.code, reason: ev.reason });
    });
  });
}

describe('WS spawn-failure ref-count safety (cluster 15 F5 follow-up)', () => {
  test('spawn-failed open closes cleanly and does NOT detach the control client', async () => {
    // 30s ceiling — generous to absorb any slow server.stop on a busy CI host.
    // The body assertions complete in <100ms; the rest is teardown.
    // Mock spawnPty to return a structured spawnError without actually
    // spawning anything. testMode:true keeps the harness simple; the
    // production code path under test (handleOpen failure branch +
    // handleClose early-return) is exercised the same way regardless of
    // testMode.
    mock.module('../../../src/server/pty.ts', () => ({
      ...ptyModule,
      spawnPty: () => ({
        pid: 0,
        onData: () => {},
        onExit: () => {},
        write: () => {},
        resize: () => {},
        kill: () => {},
        spawnError: new Error('mocked spawn failure'),
      }),
    }));

    const { ctrl, detachCalls } = counterControl();
    h = await startTestServer({ tmuxControl: ctrl });

    const ws = new WebSocket(h.wsUrl + '/ws?session=main&cols=80&rows=24');
    ws.binaryType = 'arraybuffer';
    const messages: string[] = [];
    ws.addEventListener('message', (ev: MessageEvent) => {
      const buf = typeof ev.data === 'string'
        ? Buffer.from(ev.data, 'utf8')
        : Buffer.from(ev.data as ArrayBuffer);
      const s = buf.toString('utf8');
      if (s.startsWith('\x00TT:')) messages.push(s.slice(4));
    });
    ws.addEventListener('error', () => { /* swallow */ });

    const closeEv = await waitWsClose(ws);
    expect(closeEv.code).toBe(1011);
    expect(closeEv.reason).toBe('pty spawn failed');

    // Structured ptyExit frame must arrive before the close.
    expect(messages.length).toBeGreaterThan(0);
    const parsed = messages.map(m => { try { return JSON.parse(m); } catch { return null; } });
    const ptyExit = parsed.find(p => p && p.ptyExit === true);
    expect(ptyExit).toBeDefined();
    expect(ptyExit!.exitCode).toBe(-1);
    expect(ptyExit!.exitReason).toBe('mocked spawn failure');

    // The load-bearing assertion: handleClose's early-return on
    // state.spawnFailed prevents detachSession from being called on a
    // session this WS was never registered against. Without the fix,
    // detachCalls would be 1 (handleClose's `next <= 0` branch fires
    // because no prior increment landed and `?? 1` rolls 0 forward to
    // next = 0). A peer client on the same session would have observed
    // its shared control client torn down here.
    expect(detachCalls()).toBe(0);
  }, 30000);
});
