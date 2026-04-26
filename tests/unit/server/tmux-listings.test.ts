import { describe, test, expect } from 'bun:test';
import {
  listSessionsViaTmux,
  listWindowsViaTmux,
  getPaneTitleViaTmux,
} from '../../../src/server/tmux-listings.ts';
import { TmuxCommandError, type TmuxControl } from '../../../src/server/tmux-control.ts';

/** Build a stub TmuxControl whose `run` is scripted by `respond`. */
function stubControl(respond: (args: readonly string[]) => Promise<string>): TmuxControl {
  return {
    attachSession: async () => {},
    detachSession: () => {},
    run: (args) => respond(args),
    on: () => () => {},
    hasSession: () => false,
    close: async () => {},
  };
}

describe('tmux-listings: listSessionsViaTmux', () => {
  test('queries with TAB-separated session_id/session_name and parses output', async () => {
    let receivedArgs: readonly string[] | null = null;
    const control = stubControl(async (args) => {
      receivedArgs = args;
      return '$0\tmain\n$1\tdev\n';
    });
    const out = await listSessionsViaTmux({ tmuxControl: control, tmuxBin: '/bin/false', preferControl: true });
    expect(receivedArgs).toEqual(['list-sessions', '-F', '#{session_id}\t#{session_name}']);
    expect(out).toEqual([
      { id: '0', name: 'main' },
      { id: '1', name: 'dev' },
    ]);
  });

  test('preserves colons inside session names (regression: would have been mis-split with `:`)', async () => {
    const control = stubControl(async () => '$2\tnode:server\n');
    const out = await listSessionsViaTmux({ tmuxControl: control, tmuxBin: '/bin/false', preferControl: true });
    expect(out).toEqual([{ id: '2', name: 'node:server' }]);
  });

  test('falls back to execFileAsync when control client throws TmuxCommandError', async () => {
    // Use /bin/echo as the fallback binary; under the fallback path the helper
    // calls execFileAsync(tmuxBin, args). /bin/echo prints its argv,
    // producing a single output line. We just need the fallback path to fire
    // (not to produce sensible parsed output) — assert the parse runs without
    // throwing and that we return *something* derived from execFileAsync.
    if (process.platform !== 'linux') return; // /bin/echo path differs on macOS act envs
    const control = stubControl(() =>
      Promise.reject(new TmuxCommandError(['list-sessions', '-F', '...'], 'timeout')),
    );
    const out = await listSessionsViaTmux({ tmuxControl: control, tmuxBin: '/bin/echo', preferControl: true });
    // Echo prints the args back as one line. Whatever the exact parse, the
    // helper must produce a non-throwing array result.
    expect(Array.isArray(out)).toBe(true);
  });

  test('returns null when both control and fallback fail', async () => {
    const control = stubControl(() =>
      Promise.reject(new TmuxCommandError(['list-sessions'], 'timeout')),
    );
    const out = await listSessionsViaTmux({ tmuxControl: control, tmuxBin: '/bin/false', preferControl: true });
    expect(out).toBeNull();
  });

  test('returns null when result is empty', async () => {
    const control = stubControl(async () => '');
    const out = await listSessionsViaTmux({ tmuxControl: control, tmuxBin: '/bin/false', preferControl: true });
    expect(out).toBeNull();
  });

  test('preferControl=false skips control and goes straight to execFileAsync', async () => {
    let controlCalled = false;
    const control = stubControl(async () => {
      controlCalled = true;
      return '$0\tshouldnotuse\n';
    });
    // /bin/false fails; the result should be null without ever consulting control.
    const out = await listSessionsViaTmux({ tmuxControl: control, tmuxBin: '/bin/false', preferControl: false });
    expect(controlCalled).toBe(false);
    expect(out).toBeNull();
  });
});

describe('tmux-listings: listWindowsViaTmux', () => {
  test('queries list-windows with TAB-separated index/name/active and parses', async () => {
    let receivedArgs: readonly string[] | null = null;
    const control = stubControl(async (args) => {
      receivedArgs = args;
      return '0\tone\t1\n1\ttwo\t0\n';
    });
    const out = await listWindowsViaTmux('main', { tmuxControl: control, tmuxBin: '/bin/false', preferControl: true });
    expect(receivedArgs).toEqual([
      'list-windows', '-t', 'main', '-F', '#{window_index}\t#{window_name}\t#{window_active}',
    ]);
    expect(out).toEqual([
      { index: '0', name: 'one', active: true },
      { index: '1', name: 'two', active: false },
    ]);
  });

  test('returns null on empty output', async () => {
    const control = stubControl(async () => '');
    const out = await listWindowsViaTmux('main', { tmuxControl: control, tmuxBin: '/bin/false', preferControl: true });
    expect(out).toBeNull();
  });

  test('trims trailing newline so no empty parse entry survives', async () => {
    // Real tmux output ends with \n. The parser must trim that off so we
    // don't emit a stray { index: undefined, … } record.
    const control = stubControl(async () => '0\tonly\t1\n');
    const out = await listWindowsViaTmux('main', { tmuxControl: control, tmuxBin: '/bin/false', preferControl: true });
    expect(out).toEqual([{ index: '0', name: 'only', active: true }]);
  });
});

describe('tmux-listings: getPaneTitleViaTmux', () => {
  test('queries display-message with #{pane_title} and trims the result', async () => {
    let receivedArgs: readonly string[] | null = null;
    const control = stubControl(async (args) => {
      receivedArgs = args;
      return 'fake-title\n';
    });
    const out = await getPaneTitleViaTmux('main', { tmuxControl: control, tmuxBin: '/bin/false', preferControl: true });
    expect(receivedArgs).toEqual(['display-message', '-t', 'main', '-p', '#{pane_title}']);
    expect(out).toBe('fake-title');
  });

  test('returns undefined when both control and fallback fail', async () => {
    const control = stubControl(() => Promise.reject(new TmuxCommandError(['display-message'], 'fail')));
    const out = await getPaneTitleViaTmux('main', { tmuxControl: control, tmuxBin: '/bin/false', preferControl: true });
    expect(out).toBeUndefined();
  });
});
