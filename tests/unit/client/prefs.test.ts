import { describe, test, expect, beforeEach } from "bun:test";
import {
  getTopbarAutohide,
  setTopbarAutohide,
  getShowWindowTabs,
  setShowWindowTabs,
  getWebglEnabled,
  setWebglEnabled,
} from "../../../src/client/prefs.ts";

function installLocalStorage(initial: Record<string, string> = {}, opts: { throwOnGet?: boolean; throwOnSet?: boolean } = {}) {
  const storage: Record<string, string> = { ...initial };
  (globalThis as any).localStorage = {
    getItem(k: string) {
      if (opts.throwOnGet) throw new Error('no');
      return k in storage ? storage[k] : null;
    },
    setItem(k: string, v: string) {
      if (opts.throwOnSet) throw new Error('no');
      storage[k] = String(v);
    },
    removeItem(k: string) { delete storage[k]; },
    clear() { for (const k of Object.keys(storage)) delete storage[k]; },
  };
  return storage;
}

function setCookie(cookie: string) {
  (globalThis as any).document = { cookie };
}

describe("prefs", () => {
  beforeEach(() => {
    installLocalStorage();
    setCookie("");
  });

  // --- topbar autohide ---
  test("getTopbarAutohide defaults to true when unset and no cookie", () => {
    expect(getTopbarAutohide()).toBe(true);
  });

  test("getTopbarAutohide honors '1' in storage", () => {
    installLocalStorage({ 'tmux-web-topbar-autohide': '1' });
    expect(getTopbarAutohide()).toBe(true);
  });

  test("getTopbarAutohide honors '0' in storage", () => {
    installLocalStorage({ 'tmux-web-topbar-autohide': '0' });
    expect(getTopbarAutohide()).toBe(false);
  });

  test("getTopbarAutohide migrates legacy cookie true value", () => {
    const storage = installLocalStorage();
    setCookie('tmux-web-settings=' + encodeURIComponent(JSON.stringify({ topbarAutohide: true })));
    expect(getTopbarAutohide()).toBe(true);
    expect(storage['tmux-web-topbar-autohide']).toBe('1');
  });

  test("getTopbarAutohide migrates legacy cookie false value", () => {
    const storage = installLocalStorage();
    setCookie('tmux-web-settings=' + encodeURIComponent(JSON.stringify({ topbarAutohide: false })));
    expect(getTopbarAutohide()).toBe(false);
    expect(storage['tmux-web-topbar-autohide']).toBe('0');
  });

  test("getTopbarAutohide ignores cookies with other names", () => {
    setCookie('foo=bar; unrelated=xyz');
    expect(getTopbarAutohide()).toBe(true);
  });

  test("getTopbarAutohide ignores legacy cookie with non-boolean value", () => {
    setCookie('tmux-web-settings=' + encodeURIComponent(JSON.stringify({ topbarAutohide: 'yes' })));
    expect(getTopbarAutohide()).toBe(true);
  });

  test("getTopbarAutohide tolerates malformed cookie JSON", () => {
    setCookie('tmux-web-settings=not-json');
    expect(getTopbarAutohide()).toBe(true);
  });

  test("getTopbarAutohide returns true when storage throws", () => {
    installLocalStorage({}, { throwOnGet: true });
    expect(getTopbarAutohide()).toBe(true);
  });

  test("setTopbarAutohide writes '1' or '0'", () => {
    const storage = installLocalStorage();
    setTopbarAutohide(true);
    expect(storage['tmux-web-topbar-autohide']).toBe('1');
    setTopbarAutohide(false);
    expect(storage['tmux-web-topbar-autohide']).toBe('0');
  });

  test("setTopbarAutohide swallows storage errors", () => {
    installLocalStorage({}, { throwOnSet: true });
    expect(() => setTopbarAutohide(true)).not.toThrow();
  });

  // --- show window tabs ---
  test("getShowWindowTabs defaults to true", () => {
    expect(getShowWindowTabs()).toBe(true);
  });

  test("getShowWindowTabs returns false when '0'", () => {
    installLocalStorage({ 'tmux-web-show-window-tabs': '0' });
    expect(getShowWindowTabs()).toBe(false);
  });

  test("getShowWindowTabs returns true on storage error", () => {
    installLocalStorage({}, { throwOnGet: true });
    expect(getShowWindowTabs()).toBe(true);
  });

  test("setShowWindowTabs persists value", () => {
    const storage = installLocalStorage();
    setShowWindowTabs(false);
    expect(storage['tmux-web-show-window-tabs']).toBe('0');
    setShowWindowTabs(true);
    expect(storage['tmux-web-show-window-tabs']).toBe('1');
  });

  test("setShowWindowTabs swallows storage errors", () => {
    installLocalStorage({}, { throwOnSet: true });
    expect(() => setShowWindowTabs(false)).not.toThrow();
  });

  // --- webgl ---
  test("getWebglEnabled defaults to true", () => {
    expect(getWebglEnabled()).toBe(true);
  });

  test("getWebglEnabled returns false when '0'", () => {
    installLocalStorage({ 'tmux-web-webgl': '0' });
    expect(getWebglEnabled()).toBe(false);
  });

  test("getWebglEnabled returns true on storage error", () => {
    installLocalStorage({}, { throwOnGet: true });
    expect(getWebglEnabled()).toBe(true);
  });

  test("setWebglEnabled persists value", () => {
    const storage = installLocalStorage();
    setWebglEnabled(false);
    expect(storage['tmux-web-webgl']).toBe('0');
    setWebglEnabled(true);
    expect(storage['tmux-web-webgl']).toBe('1');
  });

  test("setWebglEnabled swallows storage errors", () => {
    installLocalStorage({}, { throwOnSet: true });
    expect(() => setWebglEnabled(true)).not.toThrow();
  });
});
