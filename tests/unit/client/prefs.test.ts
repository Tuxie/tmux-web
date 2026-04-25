import { describe, test, expect, beforeEach } from "bun:test";
import {
  getFontSubpixelAA,
  setFontSubpixelAA,
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

  // --- subpixel AA (per-font) ---
  test("getFontSubpixelAA defaults to true when unset", () => {
    installLocalStorage();
    expect(getFontSubpixelAA('Iosevka Nerd Font Mono')).toBe(true);
    expect(getFontSubpixelAA('Topaz8 Amiga1200 Nerd Font')).toBe(true);
  });

  test("getFontSubpixelAA honors '0' (off) and '1' (on) per font", () => {
    installLocalStorage({
      'tmux-web-subpixel-aa:mOsOul Nerd Font': '0',
      'tmux-web-subpixel-aa:Iosevka Nerd Font Mono': '1',
    });
    expect(getFontSubpixelAA('mOsOul Nerd Font')).toBe(false);
    expect(getFontSubpixelAA('Iosevka Nerd Font Mono')).toBe(true);
    // Unrelated font name falls back to the default.
    expect(getFontSubpixelAA('Something Else')).toBe(true);
  });

  test("getFontSubpixelAA returns true on storage error", () => {
    installLocalStorage({}, { throwOnGet: true });
    expect(getFontSubpixelAA('any-font')).toBe(true);
  });

  test("setFontSubpixelAA persists per-font key", () => {
    const storage = installLocalStorage();
    setFontSubpixelAA('mOsOul Nerd Font', false);
    expect(storage['tmux-web-subpixel-aa:mOsOul Nerd Font']).toBe('0');
    setFontSubpixelAA('mOsOul Nerd Font', true);
    expect(storage['tmux-web-subpixel-aa:mOsOul Nerd Font']).toBe('1');
  });

  test("setFontSubpixelAA swallows storage errors", () => {
    installLocalStorage({}, { throwOnSet: true });
    expect(() => setFontSubpixelAA('any-font', false)).not.toThrow();
  });

});
