import { describe, test, expect, beforeEach } from "bun:test";
import {
  getShowWindowTabs,
  setShowWindowTabs,
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

});
