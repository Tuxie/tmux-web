import { describe, test, expect, beforeEach } from "bun:test";

describe("session-settings", () => {
  beforeEach(() => {
    // Simulate localStorage
    const store: Record<string, string> = {};
    (globalThis as any).localStorage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
      clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    };
  });

  test("returns defaults when nothing stored and no live session", async () => {
    const { loadSessionSettings, DEFAULT_SESSION_SETTINGS } =
      await import("../../../src/client/session-settings.ts?v=" + Math.random());
    const s = loadSessionSettings("main", null, { defaults: DEFAULT_SESSION_SETTINGS });
    expect(s.fontSize).toBe(DEFAULT_SESSION_SETTINGS.fontSize);
  });

  test("overlays theme defaults when no stored + no live", async () => {
    const mod = await import("../../../src/client/session-settings.ts?v=" + Math.random());
    const s = mod.loadSessionSettings("foo", null, {
      defaults: mod.DEFAULT_SESSION_SETTINGS,
      themeDefaults: { colours: "Dracula", fontFamily: "X", fontSize: 14, lineHeight: 1.2 },
    });
    expect(s.colours).toBe("Dracula");
    expect(s.fontFamily).toBe("X");
    expect(s.fontSize).toBe(14);
    expect(s.lineHeight).toBe(1.2);
  });

  test("inherits from live session when no stored", async () => {
    const mod = await import("../../../src/client/session-settings.ts?v=" + Math.random());
    const live = { ...mod.DEFAULT_SESSION_SETTINGS, colours: "Nord", opacity: 40, fontSize: 20 };
    const s = mod.loadSessionSettings("new-sess", live, { defaults: mod.DEFAULT_SESSION_SETTINGS });
    expect(s.colours).toBe("Nord");
    expect(s.opacity).toBe(40);
    expect(s.fontSize).toBe(20);
  });

  test("saves and loads round-trip", async () => {
    const mod = await import("../../../src/client/session-settings.ts?v=" + Math.random());
    const s = { ...mod.DEFAULT_SESSION_SETTINGS, colours: "Monokai", opacity: 50 };
    mod.saveSessionSettings("x", s);
    const loaded = mod.loadSessionSettings("x", null, { defaults: mod.DEFAULT_SESSION_SETTINGS });
    expect(loaded.colours).toBe("Monokai");
    expect(loaded.opacity).toBe(50);
  });

  test("applyThemeDefaults overwrites all four fields when provided", async () => {
    const mod = await import("../../../src/client/session-settings.ts?v=" + Math.random());
    const start = { ...mod.DEFAULT_SESSION_SETTINGS, colours: "Old", fontFamily: "Old", fontSize: 10, lineHeight: 1.5, opacity: 30 };
    const result = mod.applyThemeDefaults(start, { colours: "New", fontFamily: "New", fontSize: 20, lineHeight: 0.9 });
    expect(result.colours).toBe("New");
    expect(result.fontFamily).toBe("New");
    expect(result.fontSize).toBe(20);
    expect(result.lineHeight).toBe(0.9);
    expect(result.opacity).toBe(30);  // opacity not in theme defaults — unchanged
  });

  test("applyThemeDefaults leaves fields unchanged when theme has no default", async () => {
    const mod = await import("../../../src/client/session-settings.ts?v=" + Math.random());
    const start = { ...mod.DEFAULT_SESSION_SETTINGS, colours: "Keep" };
    const result = mod.applyThemeDefaults(start, {});
    expect(result.colours).toBe("Keep");
  });
});
