import { describe, test, expect } from 'bun:test';
import {
  listSessionsViaTmux,
  listWindowsViaTmux,
  getPaneTitleViaTmux,
  TITLES_FORMAT,
  parseTitlesValue,
  parseTitlesSnapshot,
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
  test('queries with TAB-separated session_id/session_name/session_windows and parses output', async () => {
    let receivedArgs: readonly string[] | null = null;
    const control = stubControl(async (args) => {
      receivedArgs = args;
      return '$0\tmain\t3\n$1\tdev\t1\n';
    });
    const out = await listSessionsViaTmux({ tmuxControl: control, tmuxBin: '/bin/false', preferControl: true });
    expect(receivedArgs).toEqual(['list-sessions', '-F', '#{session_id}\t#{session_name}\t#{session_windows}']);
    expect(out).toEqual([
      { id: '0', name: 'main', windows: 3 },
      { id: '1', name: 'dev', windows: 1 },
    ]);
  });

  test('preserves colons inside session names (regression: would have been mis-split with `:`)', async () => {
    const control = stubControl(async () => '$2\tnode:server\t5\n');
    const out = await listSessionsViaTmux({ tmuxControl: control, tmuxBin: '/bin/false', preferControl: true });
    expect(out).toEqual([{ id: '2', name: 'node:server', windows: 5 }]);
  });

  test('parses session names containing tabs (the windows count is the trailing field)', () => {
    /* Names with embedded tabs are unusual but legal in tmux — the
     * parser pops the trailing `#{session_windows}` and re-joins the
     * middle to recover the name. */
    // Synthesise via the real parser (parseSessionLines is the workhorse).
    // We don't expose it via the listSessionsViaTmux call shape; instead
    // we round-trip a session whose name contains a tab.
    const control = stubControl(async () => '$3\twith\ttab\t7\n');
    return listSessionsViaTmux({ tmuxControl: control, tmuxBin: '/bin/false', preferControl: true })
      .then((out) => {
        expect(out).toEqual([{ id: '3', name: 'with\ttab', windows: 7 }]);
      });
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

/* ---------------------------------------------------------------------
 * Regression: tmux-side window switches must update the active win-tab
 *
 * `tmux refresh-client -B name::FORMAT` only re-fires `%subscription-
 * changed` when the format string's *value* differs between evaluations.
 * There is no dedicated `%active-window-changed` notification in tmux
 * control mode, so the only way to detect a `prefix n`/`prefix p` style
 * window switch is to encode the active flag *into the subscription
 * format itself* — flipping which window's `#{window_active}` is `1`
 * forces the value to differ and the notification fires.
 *
 * This regressed before because the original format was
 * `#{W:#{window_index}\t#{pane_title}\x1f}` — neither of those fields
 * changes when the active window switches within a session, so tmux
 * silently suppressed the notification and the client kept showing the
 * old active tab until something else (add/close/rename) triggered a
 * refetch.
 *
 * The two assertions below pin both halves of the invariant: the format
 * literally contains `#{window_active}`, AND simulated outputs that
 * differ only in which window is active produce different raw strings
 * (so tmux WILL fire) while parsing to the same titles map (so the
 * client doesn't see spurious title churn).
 * ------------------------------------------------------------------- */
describe('tmux-listings: TITLES_FORMAT (active-window subscription regression)', () => {
  test('format includes #{window_active} so active switches re-fire', () => {
    expect(TITLES_FORMAT).toContain('#{window_active}');
  });

  test('switching active flag changes the raw value but not the parsed titles', () => {
    /* Simulated tmux outputs from two snapshots of the same session:
     * window 0 ("zsh") and window 1 ("vim") with stable titles, with
     * the only delta being which one carries `#{window_active}` = 1. */
    const aActive = '0\t1\tzsh prompt\x1f1\t0\tvim - file.txt\x1f';
    const bActive = '0\t0\tzsh prompt\x1f1\t1\tvim - file.txt\x1f';

    expect(aActive).not.toEqual(bActive); // tmux fires %subscription-changed
    expect(parseTitlesValue(aActive)).toEqual(parseTitlesValue(bActive)); // same titles
    expect(parseTitlesValue(aActive)).toEqual({
      '0': 'zsh prompt',
      '1': 'vim - file.txt',
    });
  });

  test('parser exposes the active window index from the subscription payload', () => {
    const raw = '0\t0\tzsh prompt\x1f1\t1\tvim - file.txt\x1f';
    expect(parseTitlesSnapshot(raw)).toEqual({
      titles: {
        '0': 'zsh prompt',
        '1': 'vim - file.txt',
      },
      activeIndex: '1',
    });
  });

  test('parser preserves tabs inside titles (only the first two are field separators)', () => {
    const raw = '5\t1\tcol\twith\ttabs\x1f';
    expect(parseTitlesValue(raw)).toEqual({ '5': 'col\twith\ttabs' });
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
