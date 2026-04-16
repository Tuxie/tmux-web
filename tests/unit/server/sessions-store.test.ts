import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import {
  applyPatch,
  emptyConfig,
  loadConfig,
  mergeConfig,
  saveConfig,
} from "../../../src/server/sessions-store.ts";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tw-store-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const SAMPLE = {
  theme: "Default",
  colours: "Gruvbox Dark",
  fontFamily: "Iosevka",
  fontSize: 18,
  spacing: 0.85,
  opacity: 0,
};

describe("sessions-store", () => {
  test("loadConfig returns empty when file missing", () => {
    const cfg = loadConfig(path.join(tmp, "nope.json"));
    expect(cfg).toEqual(emptyConfig());
  });

  test("loadConfig returns empty on malformed JSON", () => {
    const file = path.join(tmp, "bad.json");
    fs.writeFileSync(file, "not json");
    expect(loadConfig(file)).toEqual(emptyConfig());
  });

  test("saveConfig writes atomically via .part rename", () => {
    const file = path.join(tmp, "sub", "sessions.json");
    saveConfig(file, { version: 1, lastActive: "main", sessions: { main: SAMPLE } });
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.existsSync(file + ".part")).toBe(false);
    const round = loadConfig(file);
    expect(round.lastActive).toBe("main");
    expect(round.sessions.main!.colours).toBe("Gruvbox Dark");
  });

  test("mergeConfig merges sessions per-name and replaces lastActive when provided", () => {
    const current = { version: 1 as const, lastActive: "a", sessions: { a: SAMPLE } };
    const next = mergeConfig(current, { lastActive: "b", sessions: { b: { ...SAMPLE, colours: "Nord" } } });
    expect(next.lastActive).toBe("b");
    expect(next.sessions.a).toBeDefined();
    expect(next.sessions.b!.colours).toBe("Nord");
  });

  test("mergeConfig keeps existing lastActive when patch omits it", () => {
    const current = { version: 1 as const, lastActive: "a", sessions: {} };
    const next = mergeConfig(current, { sessions: { x: SAMPLE } });
    expect(next.lastActive).toBe("a");
  });

  test("loadConfig drops sessions with garbage keys (e.g. '[object HTMLSpanElement]')", () => {
    const file = path.join(tmp, "sessions.json");
    fs.writeFileSync(file, JSON.stringify({
      version: 1,
      lastActive: "main",
      sessions: {
        main: SAMPLE,
        "[object HTMLSpanElement]": SAMPLE,
        "": SAMPLE,
        "  ": SAMPLE,
      },
    }));
    const cfg = loadConfig(file);
    expect(Object.keys(cfg.sessions)).toEqual(["main"]);
  });

  test("mergeConfig drops garbage keys from incoming patch", () => {
    const current = { version: 1 as const, lastActive: "a", sessions: { a: SAMPLE } };
    const next = mergeConfig(current, { sessions: { "[object HTMLSpanElement]": SAMPLE, b: SAMPLE } });
    expect(next.sessions["[object HTMLSpanElement]"]).toBeUndefined();
    expect(next.sessions.b).toBeDefined();
  });

  test("applyPatch persists merged result", () => {
    const file = path.join(tmp, "sessions.json");
    applyPatch(file, { sessions: { one: SAMPLE } });
    applyPatch(file, { lastActive: "one", sessions: { two: { ...SAMPLE, opacity: 50 } } });
    const cfg = loadConfig(file);
    expect(cfg.lastActive).toBe("one");
    expect(cfg.sessions.one).toBeDefined();
    expect(cfg.sessions.two!.opacity).toBe(50);
  });
});
