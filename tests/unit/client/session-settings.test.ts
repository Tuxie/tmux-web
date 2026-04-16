import { describe, test, expect, beforeEach } from "bun:test";

interface FakeFetchCall { url: string; init?: RequestInit }

function setupFakeFetch(initialConfig: { lastActive?: string; sessions: Record<string, any> } | null) {
  const calls: FakeFetchCall[] = [];
  (globalThis as any).fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url === '/api/session-settings' && (!init || init.method === 'GET' || init.method === undefined)) {
      if (!initialConfig) {
        return { ok: false, json: async () => ({}) } as any;
      }
      return {
        ok: true,
        json: async () => ({ version: 1, ...initialConfig }),
      } as any;
    }
    return { ok: true, json: async () => ({}) } as any;
  };
  return calls;
}

async function fresh() {
  return await import("../../../src/client/session-settings.ts?v=" + Math.random());
}

describe("session-settings", () => {
  beforeEach(() => {
    setupFakeFetch(null);
  });

  test("returns defaults when nothing stored and no live session", async () => {
    const mod = await fresh();
    await mod.initSessionStore();
    const s = mod.loadSessionSettings("main", null, { defaults: mod.DEFAULT_SESSION_SETTINGS });
    expect(s.fontSize).toBe(mod.DEFAULT_SESSION_SETTINGS.fontSize);
  });

  test("overlays theme defaults when no stored + no live", async () => {
    const mod = await fresh();
    await mod.initSessionStore();
    const s = mod.loadSessionSettings("foo", null, {
      defaults: mod.DEFAULT_SESSION_SETTINGS,
      themeDefaults: { colours: "Dracula", fontFamily: "X", fontSize: 14, spacing: 1.2 },
    });
    expect(s.colours).toBe("Dracula");
    expect(s.fontFamily).toBe("X");
    expect(s.fontSize).toBe(14);
    expect(s.spacing).toBe(1.2);
  });

  test("inherits from live session when no stored", async () => {
    const mod = await fresh();
    await mod.initSessionStore();
    const live = { ...mod.DEFAULT_SESSION_SETTINGS, colours: "Nord", opacity: 40, fontSize: 20 };
    const s = mod.loadSessionSettings("new-sess", live, { defaults: mod.DEFAULT_SESSION_SETTINGS });
    expect(s.colours).toBe("Nord");
    expect(s.opacity).toBe(40);
    expect(s.fontSize).toBe(20);
  });

  test("saves to cache and pushes PUT to server", async () => {
    const calls = setupFakeFetch({ sessions: {} });
    const mod = await fresh();
    await mod.initSessionStore();
    const s = { ...mod.DEFAULT_SESSION_SETTINGS, colours: "Monokai", opacity: 50 };
    mod.saveSessionSettings("x", s);
    const loaded = mod.loadSessionSettings("x", null, { defaults: mod.DEFAULT_SESSION_SETTINGS });
    expect(loaded.colours).toBe("Monokai");
    expect(loaded.opacity).toBe(50);
    // Allow microtask queue for fire-and-forget PUT
    await new Promise(r => setTimeout(r, 0));
    const put = calls.find(c => c.init?.method === 'PUT');
    expect(put).toBeDefined();
    const body = JSON.parse(put!.init!.body as string);
    expect(body.sessions.x.colours).toBe("Monokai");
  });

  test("loads pre-existing settings from server", async () => {
    setupFakeFetch({
      lastActive: "alpha",
      sessions: { alpha: { theme: "T", colours: "Solarized", fontFamily: "F", fontSize: 22, spacing: 1, opacity: 10 } },
    });
    const mod = await fresh();
    await mod.initSessionStore();
    const s = mod.loadSessionSettings("alpha", null, { defaults: mod.DEFAULT_SESSION_SETTINGS });
    expect(s.colours).toBe("Solarized");
    expect(s.fontSize).toBe(22);
  });

  test("getLiveSessionSettings returns lastActive's stored settings", async () => {
    setupFakeFetch({
      lastActive: "old",
      sessions: { old: { theme: "T", colours: "Old", fontFamily: "F", fontSize: 18, spacing: 1, opacity: 0 } },
    });
    const mod = await fresh();
    await mod.initSessionStore();
    const live = mod.getLiveSessionSettings("new");
    expect(live).not.toBeNull();
    expect(live!.colours).toBe("Old");
  });

  test("getLiveSessionSettings returns null when current === lastActive", async () => {
    setupFakeFetch({
      lastActive: "self",
      sessions: { self: { theme: "T", colours: "X", fontFamily: "F", fontSize: 18, spacing: 1, opacity: 0 } },
    });
    const mod = await fresh();
    await mod.initSessionStore();
    expect(mod.getLiveSessionSettings("self")).toBeNull();
  });

  test("setLastActiveSession PUTs lastActive patch", async () => {
    const calls = setupFakeFetch({ sessions: {} });
    const mod = await fresh();
    await mod.initSessionStore();
    mod.setLastActiveSession("dev");
    await new Promise(r => setTimeout(r, 0));
    const put = calls.find(c => c.init?.method === 'PUT');
    expect(put).toBeDefined();
    const body = JSON.parse(put!.init!.body as string);
    expect(body.lastActive).toBe("dev");
  });

  test("applyThemeDefaults overwrites all four fields when provided", async () => {
    const mod = await fresh();
    const start = { ...mod.DEFAULT_SESSION_SETTINGS, colours: "Old", fontFamily: "Old", fontSize: 10, spacing: 1.5, opacity: 30 };
    const result = mod.applyThemeDefaults(start, { colours: "New", fontFamily: "New", fontSize: 20, spacing: 0.9 });
    expect(result.colours).toBe("New");
    expect(result.fontFamily).toBe("New");
    expect(result.fontSize).toBe(20);
    expect(result.spacing).toBe(0.9);
    expect(result.opacity).toBe(30);
  });

  test("applyThemeDefaults leaves fields unchanged when theme has no default", async () => {
    const mod = await fresh();
    const start = { ...mod.DEFAULT_SESSION_SETTINGS, colours: "Keep" };
    const result = mod.applyThemeDefaults(start, {});
    expect(result.colours).toBe("Keep");
  });
});
