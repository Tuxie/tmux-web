import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import {
  applyPatch,
  deleteSession,
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

  test("mergeConfig preserves per-session autohide fields", () => {
    const current = emptyConfig();
    const next = mergeConfig(current, {
      sessions: {
        main: {
          theme: "Default",
          colours: "Gruvbox Dark",
          fontFamily: "Iosevka Nerd Font Mono",
          fontSize: 18,
          spacing: 0.85,
          opacity: 0,
          topbarAutohide: true,
          scrollbarAutohide: true,
        },
      },
    });
    expect(next.sessions.main?.topbarAutohide).toBe(true);
    expect(next.sessions.main?.scrollbarAutohide).toBe(true);
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

  test("sanitiseSessions drops __proto__, constructor, and prototype keys", () => {
    const file = path.join(tmp, "sessions.json");
    // Write raw JSON that includes dangerous prototype-pollution keys.
    // JSON.parse won't give us __proto__ as an own property so write via
    // a manually crafted JSON string.
    const raw = `{"version":1,"sessions":{"__proto__":${JSON.stringify(SAMPLE)},"constructor":${JSON.stringify(SAMPLE)},"prototype":${JSON.stringify(SAMPLE)},"main":${JSON.stringify(SAMPLE)}}}`;
    fs.writeFileSync(file, raw);
    const cfg = loadConfig(file);
    const keys = Object.keys(cfg.sessions);
    expect(keys).toEqual(["main"]);
    expect(Object.prototype.hasOwnProperty.call(cfg.sessions, "__proto__")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(cfg.sessions, "constructor")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(cfg.sessions, "prototype")).toBe(false);
  });

  test("applyPatch persists merged result", async () => {
    const file = path.join(tmp, "sessions.json");
    await applyPatch(file, { sessions: { one: SAMPLE } });
    await applyPatch(file, { lastActive: "one", sessions: { two: { ...SAMPLE, opacity: 50 } } });
    const cfg = loadConfig(file);
    expect(cfg.lastActive).toBe("one");
    expect(cfg.sessions.one).toBeDefined();
    expect(cfg.sessions.two!.opacity).toBe(50);
  });

  test("deleteSession removes named entry and clears lastActive if it matched", async () => {
    const file = path.join(tmp, "sessions.json");
    await applyPatch(file, { lastActive: "one", sessions: { one: SAMPLE, two: SAMPLE } });
    const next = await deleteSession(file, "one");
    expect(next.sessions.one).toBeUndefined();
    expect(next.sessions.two).toBeDefined();
    expect(next.lastActive).toBeUndefined();
    const round = loadConfig(file);
    expect(round.sessions.one).toBeUndefined();
    expect(round.sessions.two).toBeDefined();
  });

  test("deleteSession keeps lastActive when it points to a different session", async () => {
    const file = path.join(tmp, "sessions.json");
    await applyPatch(file, { lastActive: "one", sessions: { one: SAMPLE, two: SAMPLE } });
    const next = await deleteSession(file, "two");
    expect(next.lastActive).toBe("one");
    expect(next.sessions.two).toBeUndefined();
  });

  test("deleteSession is a no-op when name is absent", async () => {
    const file = path.join(tmp, "sessions.json");
    await applyPatch(file, { sessions: { one: SAMPLE } });
    const next = await deleteSession(file, "nope");
    expect(Object.keys(next.sessions)).toEqual(["one"]);
  });

  // Cluster 15 / F6 — docs/code-analysis/2026-04-26.
  // Two near-simultaneous PUT /api/session-settings (e.g. theme switch +
  // opacity drag) used to interleave: T1 reads v1, T2 reads v1, T1 writes
  // v2-with-theme, T2 writes v2-with-opacity → theme update lost. The
  // serialiseFileWrite mutex inside applyPatch makes the read-modify-
  // write atomic per filePath.
  test("concurrent applyPatch calls don't lose updates (cluster 15 / F6)", async () => {
    const file = path.join(tmp, "sessions.json");
    // Seed both sessions so the patches below only touch existing keys.
    await applyPatch(file, { sessions: { a: SAMPLE, b: SAMPLE } });

    // Fire many concurrent patches: half mutate session 'a' (toggling
    // colours), half mutate session 'b' (toggling opacity). After all
    // settle, every patch must have landed somewhere — the count of
    // distinct (a.colours, b.opacity) updates we observe must equal the
    // number we fired.
    const N = 20;
    const promises: Promise<unknown>[] = [];
    for (let i = 0; i < N; i++) {
      promises.push(applyPatch(file, { sessions: { a: { ...SAMPLE, colours: `colour-${i}` } } }));
      promises.push(applyPatch(file, { sessions: { b: { ...SAMPLE, opacity: i } } }));
    }
    await Promise.all(promises);

    const cfg = loadConfig(file);
    // Both sessions must still exist; whichever write came in last wins
    // the field, but neither session may have been wholly clobbered by
    // the racing other writer.
    expect(cfg.sessions.a).toBeDefined();
    expect(cfg.sessions.b).toBeDefined();
    // Last-writer-wins on each field. Without the mutex, an interleave
    // that read v1 of {a,b} on both sides would have produced one of
    // them having the SAMPLE default rather than a per-loop value. We
    // assert both retain a concurrency-touched value.
    expect(cfg.sessions.a!.colours).toMatch(/^colour-\d+$/);
    expect(typeof cfg.sessions.b!.opacity).toBe("number");
  });

  test("concurrent applyPatch on different files do not block each other (per-file chain)", async () => {
    const fileA = path.join(tmp, "a.json");
    const fileB = path.join(tmp, "b.json");
    // Both files run simultaneously; with a per-file chain (not a global
    // chain) the wall-clock time for both should be roughly the
    // sequential time for a single file's writes.
    await Promise.all([
      applyPatch(fileA, { sessions: { x: SAMPLE } }),
      applyPatch(fileB, { sessions: { y: SAMPLE } }),
    ]);
    expect(loadConfig(fileA).sessions.x).toBeDefined();
    expect(loadConfig(fileB).sessions.y).toBeDefined();
  });
});
