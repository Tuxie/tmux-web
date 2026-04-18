import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { installKeyboardHandler } from '../../../../src/client/ui/keyboard.js';

function fakeKeyEvent(init: {
  key: string;
  shift?: boolean; ctrl?: boolean; alt?: boolean; meta?: boolean;
}): KeyboardEvent {
  let prevented = false;
  let propagated = true;
  return {
    key: init.key,
    shiftKey: !!init.shift,
    ctrlKey: !!init.ctrl,
    altKey: !!init.alt,
    metaKey: !!init.meta,
    preventDefault() { prevented = true; },
    stopPropagation() { propagated = false; },
    get _prevented() { return prevented; },
    get _propagated() { return propagated; },
  } as unknown as KeyboardEvent;
}

describe('keyboard handler', () => {
  let sent: string[];
  let uninstall: () => void;
  let fired: ((ev: KeyboardEvent) => void)[];
  let origAdd: typeof document.addEventListener;
  let origRem: typeof document.removeEventListener;

  beforeEach(() => {
    sent = [];
    fired = [];
    // Minimal document shim so the handler can register its listener.
    if (typeof globalThis.document === 'undefined') {
      (globalThis as any).document = {};
    }
    origAdd = document.addEventListener;
    origRem = document.removeEventListener;
    (document as any).addEventListener = (type: string, fn: (ev: KeyboardEvent) => void) => {
      if (type === 'keydown') fired.push(fn);
    };
    (document as any).removeEventListener = () => {};
    uninstall = installKeyboardHandler({
      terminalElement: null as any,
      send: (s) => sent.push(s),
      toggleFullscreen: () => {},
    });
  });

  afterEach(() => {
    uninstall();
    (document as any).addEventListener = origAdd;
    (document as any).removeEventListener = origRem;
  });

  const dispatch = (ev: KeyboardEvent) => fired.forEach((fn) => fn(ev));

  test('Shift+Enter emits CSI-u with modifier 2 (distinguishes it from plain Enter)', () => {
    const ev = fakeKeyEvent({ key: 'Enter', shift: true });
    dispatch(ev);
    expect(sent).toEqual(['\x1b[13;2u']);
    expect((ev as any)._prevented).toBe(true);
    expect((ev as any)._propagated).toBe(false);
  });

  test('Ctrl+Enter emits CSI-u with modifier 5', () => {
    const ev = fakeKeyEvent({ key: 'Enter', ctrl: true });
    dispatch(ev);
    expect(sent).toEqual(['\x1b[13;5u']);
  });

  test('plain Enter is left alone (no intercept)', () => {
    dispatch(fakeKeyEvent({ key: 'Enter' }));
    expect(sent).toEqual([]);
  });

  test('Shift+Ctrl+Enter is NOT handled (modifier combos fall through to xterm)', () => {
    dispatch(fakeKeyEvent({ key: 'Enter', shift: true, ctrl: true }));
    expect(sent).toEqual([]);
  });

  test('Cmd+R stops propagation (passthrough to browser)', () => {
    const ev = fakeKeyEvent({ key: 'R', meta: true });
    dispatch(ev);
    expect((ev as any)._propagated).toBe(false);
    expect(sent).toEqual([]);
  });

  test('Cmd+F calls toggleFullscreen and prevents default', () => {
    let toggled = 0;
    uninstall(); // tear down the pre-installed one
    fired = [];
    uninstall = installKeyboardHandler({
      terminalElement: null as any,
      send: (s) => sent.push(s),
      toggleFullscreen: () => { toggled++; },
    });
    const ev = fakeKeyEvent({ key: 'f', meta: true });
    dispatch(ev);
    expect(toggled).toBe(1);
    expect((ev as any)._prevented).toBe(true);
    expect((ev as any)._propagated).toBe(false);
  });

  test('Ctrl+R (with Cmd too) does NOT intercept as browser shortcut', () => {
    // branch: metaKey && ctrlKey → skip
    const ev = fakeKeyEvent({ key: 'r', meta: true, ctrl: true });
    dispatch(ev);
    expect((ev as any)._propagated).toBe(true);
  });

  test('uninstall removes the listener', () => {
    let removed = 0;
    (document as any).removeEventListener = () => { removed++; };
    uninstall();
    expect(removed).toBe(1);
    // Re-install one for afterEach tear-down
    uninstall = installKeyboardHandler({
      terminalElement: null as any,
      send: (s) => sent.push(s),
      toggleFullscreen: () => {},
    });
  });
});
