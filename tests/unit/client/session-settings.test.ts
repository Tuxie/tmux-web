import { describe, test, expect, beforeEach } from "bun:test";
import {
  DEFAULT_SESSION_SETTINGS,
  deleteSessionSettings,
  initSessionStore,
  loadSessionSettings,
  saveSessionSettings,
  getStoredSessionNames,
  getLiveSessionSettings,
  sessionSettingsKey,
  setLastActiveSession,
  getKnownRemoteServers,
  recordKnownRemoteServer,
  applyThemeDefaults,
  flushPersist,
  _resetPersistDebounce,
  _resetSessionStore,
} from "../../../src/client/session-settings.ts";

interface FakeFetchCall { url: string; init?: RequestInit }

function setupFakeFetch(
  initialConfig: { lastActive?: string; sessions: Record<string, any> } | null,
  opts: {
    getOk?: boolean;
    getThrow?: boolean;
    getReturnsNonObject?: boolean;
    initialSettings?: { knownServers?: string[] };
  } = {},
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
    if (url === '/api/settings' && (!init || init.method === 'GET' || init.method === undefined)) {
      return { ok: true, json: async () => ({ version: 1, knownServers: opts.initialSettings?.knownServers ?? [] }) } as any;
    }
    // PUT
    return { ok: true, json: async () => ({}) } as any;
  };
  return calls;
}

/** Drain the debounced PUT pipeline. Tests that previously asserted on
 *  a queued PUT after `setTimeout(0)` now have to flush the 300 ms
 *  debounce explicitly; calling `flushPersist()` cancels the timer
 *  and fires the queued fetch synchronously, the microtask wait then
 *  lets the (mock) Promise resolve so the test can read `calls`. */
async function drainPersist(): Promise<void> {
  flushPersist();
  await new Promise((r) => setTimeout(r, 0));
}

describe("session-settings", () => {
  beforeEach(() => {
    _resetSessionStore();
    _resetPersistDebounce();
    setupFakeFetch(null);
  });

  test("returns defaults when nothing stored and no live session", async () => {
    await initSessionStore();
    const s = loadSessionSettings("main", null, { defaults: DEFAULT_SESSION_SETTINGS });
    expect(s.fontSize).toBe(DEFAULT_SESSION_SETTINGS.fontSize);
    expect(s.backgroundHue).toBe(DEFAULT_SESSION_SETTINGS.backgroundHue);
    expect(s.tuiBgOpacity).toBe(100);
  });

  test("autohide settings default to false when missing", async () => {
    await initSessionStore();
    const s = loadSessionSettings("main", null, { defaults: DEFAULT_SESSION_SETTINGS });
    expect(s.topbarAutohide).toBe(false);
    expect(s.scrollbarAutohide).toBe(false);
  });

  test("stored autohide settings round-trip through cache and PUT body", async () => {
    const calls = setupFakeFetch({ sessions: {} });
    await initSessionStore();
    const s = {
      ...DEFAULT_SESSION_SETTINGS,
      topbarAutohide: true,
      scrollbarAutohide: true,
    };
    saveSessionSettings("main", s);
    const loaded = loadSessionSettings("main", null, { defaults: DEFAULT_SESSION_SETTINGS });
    expect(loaded.topbarAutohide).toBe(true);
    expect(loaded.scrollbarAutohide).toBe(true);
    await drainPersist();
    const put = calls.find(c => c.init?.method === "PUT");
    expect(put?.init?.method).toBe("PUT");
    const body = JSON.parse(put!.init!.body as string);
    expect(body.sessions.main.topbarAutohide).toBe(true);
    expect(body.sessions.main.scrollbarAutohide).toBe(true);
  });

  test("overlays theme defaults when no stored + no live", async () => {
    await initSessionStore();
    const s = loadSessionSettings("foo", null, {
      defaults: DEFAULT_SESSION_SETTINGS,
      themeDefaults: {
        colours: "Dracula",
        fontFamily: "X",
        fontSize: 14,
        spacing: 1.2,
        opacity: 25,
        tuiBgOpacity: 70,
        topbarAutohide: true,
        scrollbarAutohide: true,
      },
    });
    expect(s.colours).toBe("Dracula");
    expect(s.fontFamily).toBe("X");
    expect(s.fontSize).toBe(14);
    expect(s.spacing).toBe(1.2);
    expect(s.opacity).toBe(25);
    expect(s.tuiBgOpacity).toBe(70);
    expect(s.topbarAutohide).toBe(true);
    expect(s.scrollbarAutohide).toBe(true);
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
    expect(s.tuiBgOpacity).toBe(100);
  });

  test("saves to cache and pushes PUT to server", async () => {
    const calls = setupFakeFetch({ sessions: {} });
    await initSessionStore();
    const s = { ...DEFAULT_SESSION_SETTINGS, colours: "Monokai", opacity: 50, tuiBgOpacity: 65, backgroundHue: 210 };
    saveSessionSettings("x", s);
    const loaded = loadSessionSettings("x", null, { defaults: DEFAULT_SESSION_SETTINGS });
    expect(loaded.colours).toBe("Monokai");
    expect(loaded.opacity).toBe(50);
    expect(loaded.tuiBgOpacity).toBe(65);
    expect(loaded.backgroundHue).toBe(210);
    await drainPersist();
    const put = calls.find(c => c.init?.method === 'PUT');
    expect(put?.init?.method).toBe("PUT");
    const body = JSON.parse(put!.init!.body as string);
    expect(body.sessions.x.colours).toBe("Monokai");
    expect(body.sessions.x.tuiBgOpacity).toBe(65);
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

  test("getStoredSessionNames excludes remote session setting keys", async () => {
    setupFakeFetch({
      sessions: {
        alpha: { theme: "T", colours: "x", fontFamily: "f", fontSize: 1, spacing: 1, opacity: 0 },
        "/r/dev/alpha": { theme: "T", colours: "remote", fontFamily: "f", fontSize: 1, spacing: 1, opacity: 0 },
      },
    });
    await initSessionStore();
    expect(getStoredSessionNames()).toEqual(["alpha"]);
  });

  test("sessionSettingsKey namespaces remote sessions by host", () => {
    expect(sessionSettingsKey("main")).toBe("main");
    expect(sessionSettingsKey("main", "dev")).toBe("/r/dev/main");
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
    await drainPersist();
    const put = calls.find(c => c.init?.method === 'PUT');
    expect(put?.init?.method).toBe("PUT");
    const body = JSON.parse(put!.init!.body as string);
    expect(body.lastActive).toBe("dev");
  });

  test("setLastActiveSession is a no-op when unchanged", async () => {
    const calls = setupFakeFetch({ lastActive: "dev", sessions: {} });
    await initSessionStore();
    setLastActiveSession("dev");
    await drainPersist();
    // Only GET call, no PUT
    expect(calls.some(c => c.init?.method === 'PUT')).toBe(false);
  });

  test("applyThemeDefaults overwrites all fields when provided", async () => {
    const start = { ...DEFAULT_SESSION_SETTINGS, colours: "Old", fontFamily: "Old", fontSize: 10, spacing: 1.5, opacity: 30, tuiBgOpacity: 80 };
    const result = applyThemeDefaults(start, {
      colours: "New",
      fontFamily: "New",
      fontSize: 20,
      spacing: 0.9,
      opacity: 55,
      tuiBgOpacity: 70,
      topbarAutohide: true,
      scrollbarAutohide: true,
    });
    expect(result.colours).toBe("New");
    expect(result.fontFamily).toBe("New");
    expect(result.fontSize).toBe(20);
    expect(result.spacing).toBe(0.9);
    expect(result.opacity).toBe(55);
    expect(result.tuiBgOpacity).toBe(70);
    expect(result.topbarAutohide).toBe(true);
    expect(result.scrollbarAutohide).toBe(true);
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
    await drainPersist();
    expect(getStoredSessionNames()).toEqual(["x"]);
  });

  test("_resetSessionStore accepts initial state", () => {
    _resetSessionStore({ sessions: { seeded: { ...DEFAULT_SESSION_SETTINGS } }, lastActive: "seeded", knownServers: ["dev"] });
    expect(getStoredSessionNames()).toEqual(["seeded"]);
    expect(getKnownRemoteServers()).toEqual(["dev"]);
  });

  test("initSessionStore loads known remote servers from /api/settings", async () => {
    setupFakeFetch({ sessions: {} }, { initialSettings: { knownServers: ["dev", "prod"] } });
    await initSessionStore();
    expect(getKnownRemoteServers()).toEqual(["dev", "prod"]);
  });

  test("recordKnownRemoteServer appends a valid host once and persists to settings.json", async () => {
    const calls = setupFakeFetch({ sessions: {} }, { initialSettings: { knownServers: ["dev"] } });
    await initSessionStore();

    recordKnownRemoteServer("prod");
    recordKnownRemoteServer("prod");
    recordKnownRemoteServer("-Jbad");

    expect(getKnownRemoteServers()).toEqual(["dev", "prod"]);
    const puts = calls.filter(c => c.url === "/api/settings" && c.init?.method === "PUT");
    expect(puts).toHaveLength(1);
    expect(JSON.parse(puts[0]!.init!.body as string)).toEqual({ knownServers: ["prod"] });
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
    expect(del?.url).toBe('/api/session-settings?name=a');
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

describe("persist debounce", () => {
  beforeEach(() => {
    _resetSessionStore();
    _resetPersistDebounce();
  });

  test("coalesces a slider-drag burst into a single PUT", async () => {
    const calls = setupFakeFetch({ sessions: {} });
    await initSessionStore();
    // Simulate the worst-case slider drag: 360 commits in tight
    // succession (Hue 0→360). Without the debounce this would fire
    // 360 PUTs; with it we expect exactly one once we drain.
    for (let i = 0; i < 360; i++) {
      saveSessionSettings("main", {
        ...DEFAULT_SESSION_SETTINGS,
        backgroundHue: i,
      });
    }
    // Before the debounce fires: no PUT yet.
    expect(calls.some((c) => c.init?.method === "PUT")).toBe(false);

    flushPersist();
    await new Promise((r) => setTimeout(r, 0));

    const puts = calls.filter((c) => c.init?.method === "PUT");
    expect(puts).toHaveLength(1);
    const body = JSON.parse(puts[0]!.init!.body as string);
    // Latest write wins: the body reflects the final commit (359).
    expect(body.sessions.main.backgroundHue).toBe(359);
  });

  test("merges interleaved lastActive + sessions patches into one PUT", async () => {
    const calls = setupFakeFetch({ sessions: {} });
    await initSessionStore();
    saveSessionSettings("a", { ...DEFAULT_SESSION_SETTINGS, fontSize: 14 });
    setLastActiveSession("a");
    saveSessionSettings("b", { ...DEFAULT_SESSION_SETTINGS, fontSize: 22 });

    flushPersist();
    await new Promise((r) => setTimeout(r, 0));

    const puts = calls.filter((c) => c.init?.method === "PUT");
    expect(puts).toHaveLength(1);
    const body = JSON.parse(puts[0]!.init!.body as string);
    expect(body.lastActive).toBe("a");
    expect(body.sessions.a.fontSize).toBe(14);
    expect(body.sessions.b.fontSize).toBe(22);
  });

  test("flushPersist is a no-op when nothing is pending", async () => {
    const calls = setupFakeFetch({ sessions: {} });
    await initSessionStore();
    flushPersist();
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.some((c) => c.init?.method === "PUT")).toBe(false);
  });

  test("debounce timer fires the PUT after the 300 ms idle window", async () => {
    const calls = setupFakeFetch({ sessions: {} });
    await initSessionStore();
    saveSessionSettings("x", { ...DEFAULT_SESSION_SETTINGS, fontSize: 19 });
    // Wait past the 300 ms debounce window (plus a small buffer for
    // the fetch microtask). We can't use fake timers here without
    // restructuring the module; the small extra real-time wait is
    // acceptable for one test.
    await new Promise((r) => setTimeout(r, 350));
    const puts = calls.filter((c) => c.init?.method === "PUT");
    expect(puts).toHaveLength(1);
    const body = JSON.parse(puts[0]!.init!.body as string);
    expect(body.sessions.x.fontSize).toBe(19);
  });
});

describe("clamp helpers", () => {
  test("clampFontSize enforces 8..30 and defaults NaN to 18", async () => {
    const { clampFontSize } = await import("../../../src/client/session-settings.ts");
    expect(clampFontSize(0)).toBe(8);
    expect(clampFontSize(100)).toBe(30);
    expect(clampFontSize(14.5)).toBe(14.5);
    expect(clampFontSize(NaN)).toBe(18);
    expect(clampFontSize(Infinity)).toBe(18);
  });

  test("clampSpacing enforces 0.5..2 and defaults NaN to 0.85", async () => {
    const { clampSpacing } = await import("../../../src/client/session-settings.ts");
    expect(clampSpacing(0.2)).toBe(0.5);
    expect(clampSpacing(5)).toBe(2);
    expect(clampSpacing(1.25)).toBe(1.25);
    expect(clampSpacing(NaN)).toBe(0.85);
  });

  test("clampPercent0to100 rounds and clamps to 0..100, defaults NaN to 0", async () => {
    const { clampPercent0to100 } = await import("../../../src/client/session-settings.ts");
    expect(clampPercent0to100(-5)).toBe(0);
    expect(clampPercent0to100(250)).toBe(100);
    expect(clampPercent0to100(42.6)).toBe(43);
    expect(clampPercent0to100(NaN)).toBe(0);
  });
});
