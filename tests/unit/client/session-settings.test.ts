import { describe, test, expect, beforeEach } from "bun:test";
import {
  DEFAULT_SESSION_SETTINGS,
  deleteSessionSettings,
  initSessionStore,
  loadSessionSettings,
  saveSessionSettings,
  getStoredSessionNames,
  getLiveSessionSettings,
  setLastActiveSession,
  applyThemeDefaults,
  _resetSessionStore,
} from "../../../src/client/session-settings.ts";

interface FakeFetchCall { url: string; init?: RequestInit }

function setupFakeFetch(
  initialConfig: { lastActive?: string; sessions: Record<string, any> } | null,
  opts: { getOk?: boolean; getThrow?: boolean; getReturnsNonObject?: boolean } = {},
) {
  const calls: FakeFetchCall[] = [];
  (globalThis as any).fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const isGet = url === '/api/session-settings' && (!init || init.method === 'GET' || init.method === undefined);
    if (isGet) {
      if (opts.getThrow) throw new Error('network');
      if (opts.getOk === false) return { ok: false, json: async () => ({}) } as any;
      if (opts.getReturnsNonObject) return { ok: true, json: async () => null } as any;
      if (!initialConfig) return { ok: true, json: async () => ({ version: 1, sessions: {} }) } as any;
      return { ok: true, json: async () => ({ version: 1, ...initialConfig }) } as any;
    }
    // PUT
    return { ok: true, json: async () => ({}) } as any;
  };
  return calls;
}

describe("session-settings", () => {
  beforeEach(() => {
    _resetSessionStore();
    setupFakeFetch(null);
  });

  test("returns defaults when nothing stored and no live session", async () => {
    await initSessionStore();
    const s = loadSessionSettings("main", null, { defaults: DEFAULT_SESSION_SETTINGS });
    expect(s.fontSize).toBe(DEFAULT_SESSION_SETTINGS.fontSize);
    expect(s.backgroundHue).toBe(DEFAULT_SESSION_SETTINGS.backgroundHue);
    expect(s.tuiOpacity).toBe(100);
  });

  test("overlays theme defaults when no stored + no live", async () => {
    await initSessionStore();
    const s = loadSessionSettings("foo", null, {
      defaults: DEFAULT_SESSION_SETTINGS,
      themeDefaults: { colours: "Dracula", fontFamily: "X", fontSize: 14, spacing: 1.2, opacity: 25, tuiOpacity: 70 },
    });
    expect(s.colours).toBe("Dracula");
    expect(s.fontFamily).toBe("X");
    expect(s.fontSize).toBe(14);
    expect(s.spacing).toBe(1.2);
    expect(s.opacity).toBe(25);
    expect(s.tuiOpacity).toBe(70);
  });

  test("theme defaults overlay handles missing themeDefaults object", async () => {
    await initSessionStore();
    const s = loadSessionSettings("foo", null, { defaults: DEFAULT_SESSION_SETTINGS });
    expect(s).toEqual(DEFAULT_SESSION_SETTINGS);
  });

  test("inherits from live session when no stored", async () => {
    await initSessionStore();
    const live = { ...DEFAULT_SESSION_SETTINGS, colours: "Nord", opacity: 40, fontSize: 20 };
    const s = loadSessionSettings("new-sess", live, { defaults: DEFAULT_SESSION_SETTINGS });
    expect(s.colours).toBe("Nord");
    expect(s.opacity).toBe(40);
    expect(s.fontSize).toBe(20);
  });

  test("fills new defaults when inheriting legacy live session", async () => {
    await initSessionStore();
    const live = { theme: "Default", colours: "Nord", fontFamily: "F", fontSize: 20, spacing: 1, opacity: 40 } as any;
    const s = loadSessionSettings("new-sess", live, { defaults: DEFAULT_SESSION_SETTINGS });
    expect(s.backgroundHue).toBe(DEFAULT_SESSION_SETTINGS.backgroundHue);
    expect(s.tuiOpacity).toBe(100);
  });

  test("saves to cache and pushes PUT to server", async () => {
    const calls = setupFakeFetch({ sessions: {} });
    await initSessionStore();
    const s = { ...DEFAULT_SESSION_SETTINGS, colours: "Monokai", opacity: 50, tuiOpacity: 65, backgroundHue: 210 };
    saveSessionSettings("x", s);
    const loaded = loadSessionSettings("x", null, { defaults: DEFAULT_SESSION_SETTINGS });
    expect(loaded.colours).toBe("Monokai");
    expect(loaded.opacity).toBe(50);
    expect(loaded.tuiOpacity).toBe(65);
    expect(loaded.backgroundHue).toBe(210);
    await new Promise(r => setTimeout(r, 0));
    const put = calls.find(c => c.init?.method === 'PUT');
    expect(put).toBeDefined();
    const body = JSON.parse(put!.init!.body as string);
    expect(body.sessions.x.colours).toBe("Monokai");
    expect(body.sessions.x.tuiOpacity).toBe(65);
    expect(body.sessions.x.backgroundHue).toBe(210);
  });

  test("getStoredSessionNames returns names from cache", async () => {
    setupFakeFetch({
      sessions: {
        alpha: { theme: "T", colours: "x", fontFamily: "f", fontSize: 1, spacing: 1, opacity: 0 },
        beta: { theme: "T", colours: "x", fontFamily: "f", fontSize: 1, spacing: 1, opacity: 0 },
      },
    });
    await initSessionStore();
    expect(getStoredSessionNames().sort()).toEqual(["alpha", "beta"]);
  });

  test("loads pre-existing settings from server", async () => {
    setupFakeFetch({
      lastActive: "alpha",
      sessions: { alpha: { theme: "T", colours: "Solarized", fontFamily: "F", fontSize: 22, spacing: 1, opacity: 10 } },
    });
    await initSessionStore();
    const s = loadSessionSettings("alpha", null, { defaults: DEFAULT_SESSION_SETTINGS });
    expect(s.colours).toBe("Solarized");
    expect(s.fontSize).toBe(22);
  });

  test("getLiveSessionSettings returns lastActive's stored settings", async () => {
    setupFakeFetch({
      lastActive: "old",
      sessions: { old: { theme: "T", colours: "Old", fontFamily: "F", fontSize: 18, spacing: 1, opacity: 0 } },
    });
    await initSessionStore();
    const live = getLiveSessionSettings("new");
    expect(live).not.toBeNull();
    expect(live!.colours).toBe("Old");
  });

  test("getLiveSessionSettings returns null when current === lastActive", async () => {
    setupFakeFetch({
      lastActive: "self",
      sessions: { self: { theme: "T", colours: "X", fontFamily: "F", fontSize: 18, spacing: 1, opacity: 0 } },
    });
    await initSessionStore();
    expect(getLiveSessionSettings("self")).toBeNull();
  });

  test("getLiveSessionSettings returns null when no lastActive", async () => {
    await initSessionStore();
    expect(getLiveSessionSettings("anything")).toBeNull();
  });

  test("getLiveSessionSettings returns null when lastActive session missing", async () => {
    setupFakeFetch({ lastActive: "gone", sessions: {} });
    await initSessionStore();
    expect(getLiveSessionSettings("cur")).toBeNull();
  });

  test("setLastActiveSession PUTs lastActive patch", async () => {
    const calls = setupFakeFetch({ sessions: {} });
    await initSessionStore();
    setLastActiveSession("dev");
    await new Promise(r => setTimeout(r, 0));
    const put = calls.find(c => c.init?.method === 'PUT');
    expect(put).toBeDefined();
    const body = JSON.parse(put!.init!.body as string);
    expect(body.lastActive).toBe("dev");
  });

  test("setLastActiveSession is a no-op when unchanged", async () => {
    const calls = setupFakeFetch({ lastActive: "dev", sessions: {} });
    await initSessionStore();
    setLastActiveSession("dev");
    await new Promise(r => setTimeout(r, 0));
    // Only GET call, no PUT
    expect(calls.some(c => c.init?.method === 'PUT')).toBe(false);
  });

  test("applyThemeDefaults overwrites all fields when provided", async () => {
    const start = { ...DEFAULT_SESSION_SETTINGS, colours: "Old", fontFamily: "Old", fontSize: 10, spacing: 1.5, opacity: 30, tuiOpacity: 80 };
    const result = applyThemeDefaults(start, { colours: "New", fontFamily: "New", fontSize: 20, spacing: 0.9, opacity: 55, tuiOpacity: 70 });
    expect(result.colours).toBe("New");
    expect(result.fontFamily).toBe("New");
    expect(result.fontSize).toBe(20);
    expect(result.spacing).toBe(0.9);
    expect(result.opacity).toBe(55);
    expect(result.tuiOpacity).toBe(70);
  });

  test("applyThemeDefaults leaves fields unchanged when theme has no default", async () => {
    const start = { ...DEFAULT_SESSION_SETTINGS, colours: "Keep" };
    const result = applyThemeDefaults(start, {});
    expect(result.colours).toBe("Keep");
  });

  test("initSessionStore swallows fetch exceptions", async () => {
    setupFakeFetch(null, { getThrow: true });
    await initSessionStore();
    // Still returns defaults, cache intact
    expect(getStoredSessionNames()).toEqual([]);
  });

  test("initSessionStore ignores non-ok response", async () => {
    setupFakeFetch(null, { getOk: false });
    await initSessionStore();
    expect(getStoredSessionNames()).toEqual([]);
  });

  test("initSessionStore ignores non-object body", async () => {
    setupFakeFetch(null, { getReturnsNonObject: true });
    await initSessionStore();
    expect(getStoredSessionNames()).toEqual([]);
  });

  test("initSessionStore discards non-string lastActive", async () => {
    setupFakeFetch({ lastActive: 123 as any, sessions: { a: { theme: "T", colours: "x", fontFamily: "f", fontSize: 1, spacing: 1, opacity: 0 } } });
    await initSessionStore();
    expect(getLiveSessionSettings("other")).toBeNull();
  });

  test("persist PUT rejection is swallowed", async () => {
    (globalThis as any).fetch = async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') throw new Error('boom');
      return { ok: true, json: async () => ({ version: 1, sessions: {} }) } as any;
    };
    await initSessionStore();
    // Should not throw
    saveSessionSettings("x", { ...DEFAULT_SESSION_SETTINGS });
    await new Promise(r => setTimeout(r, 0));
    expect(getStoredSessionNames()).toEqual(["x"]);
  });

  test("_resetSessionStore accepts initial state", () => {
    _resetSessionStore({ sessions: { seeded: { ...DEFAULT_SESSION_SETTINGS } }, lastActive: "seeded" });
    expect(getStoredSessionNames()).toEqual(["seeded"]);
  });

  test("deleteSessionSettings removes cache entry and issues DELETE", async () => {
    const calls = setupFakeFetch({
      lastActive: "a",
      sessions: {
        a: { theme: "T", colours: "x", fontFamily: "f", fontSize: 1, spacing: 1, opacity: 0 },
        b: { theme: "T", colours: "x", fontFamily: "f", fontSize: 1, spacing: 1, opacity: 0 },
      },
    });
    await initSessionStore();
    await deleteSessionSettings("a");
    expect(getStoredSessionNames()).toEqual(["b"]);
    expect(getLiveSessionSettings("anything")).toBeNull();
    const del = calls.find(c => c.init?.method === 'DELETE');
    expect(del).toBeDefined();
    expect(del!.url).toBe('/api/session-settings?name=a');
  });

  test("deleteSessionSettings swallows fetch errors", async () => {
    (globalThis as any).fetch = async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') throw new Error('boom');
      return { ok: true, json: async () => ({ version: 1, sessions: { x: { ...DEFAULT_SESSION_SETTINGS } } }) } as any;
    };
    await initSessionStore();
    await deleteSessionSettings("x");
    expect(getStoredSessionNames()).toEqual([]);
  });
});
