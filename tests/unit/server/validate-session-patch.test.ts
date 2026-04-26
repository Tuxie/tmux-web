import { describe, test, expect } from "bun:test";
import { validateSessionPatch } from "../../../src/server/http.ts";

const SAMPLE_SETTINGS = {
  theme: "Default",
  colours: "Nord",
  fontFamily: "Iosevka",
  fontSize: 18,
  spacing: 0.85,
  opacity: 0,
};

describe("validateSessionPatch (cluster 15 / F7)", () => {
  describe("accepts well-formed patches", () => {
    test("empty object", () => {
      const r = validateSessionPatch({});
      expect(r.ok).toBe(true);
    });

    test("lastActive only", () => {
      const r = validateSessionPatch({ lastActive: "main" });
      expect(r.ok).toBe(true);
    });

    test("sessions only", () => {
      const r = validateSessionPatch({ sessions: { main: SAMPLE_SETTINGS } });
      expect(r.ok).toBe(true);
    });

    test("both lastActive and sessions", () => {
      const r = validateSessionPatch({
        lastActive: "main",
        sessions: { main: SAMPLE_SETTINGS, dev: SAMPLE_SETTINGS },
      });
      expect(r.ok).toBe(true);
    });

    test("explicit undefined for optional fields is permitted", () => {
      const r = validateSessionPatch({ lastActive: undefined, sessions: undefined });
      expect(r.ok).toBe(true);
    });
  });

  describe("rejects malformed patches", () => {
    test("non-object root", () => {
      expect(validateSessionPatch(null).ok).toBe(false);
      expect(validateSessionPatch(undefined).ok).toBe(false);
      expect(validateSessionPatch("string").ok).toBe(false);
      expect(validateSessionPatch(42).ok).toBe(false);
      expect(validateSessionPatch(true).ok).toBe(false);
    });

    test("array root rejected (Object.values would lie)", () => {
      const r = validateSessionPatch([1, 2, 3]);
      expect(r.ok).toBe(false);
    });

    test("non-string lastActive", () => {
      const r = validateSessionPatch({ lastActive: 42 });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/lastActive/);
    });

    test("non-object sessions", () => {
      const r = validateSessionPatch({ sessions: "not an object" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/sessions/);
    });

    test("array sessions rejected", () => {
      const r = validateSessionPatch({ sessions: [{ ...SAMPLE_SETTINGS }] });
      expect(r.ok).toBe(false);
    });

    test("session entry that's not a plain object", () => {
      const r = validateSessionPatch({ sessions: { main: "string-not-object" } });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/main/);
    });

    test("session entry as an array", () => {
      const r = validateSessionPatch({ sessions: { main: [1, 2, 3] } });
      expect(r.ok).toBe(false);
    });
  });

  describe("rejects clipboard fields (consent-only)", () => {
    test("clipboard field on a session patch is rejected", () => {
      const r = validateSessionPatch({
        sessions: {
          main: {
            ...SAMPLE_SETTINGS,
            clipboard: {
              "/usr/bin/tmux": { blake3: null, read: { allow: true } },
            },
          },
        },
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/clipboard/);
    });

    test("clipboard field on one of multiple sessions is rejected", () => {
      const r = validateSessionPatch({
        sessions: {
          main: SAMPLE_SETTINGS,
          dev: { ...SAMPLE_SETTINGS, clipboard: {} },
        },
      });
      expect(r.ok).toBe(false);
    });
  });

  describe("rejects unknown top-level keys (fail-closed)", () => {
    test("unknown top-level key", () => {
      const r = validateSessionPatch({ sessions: {}, mystery: 1 });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/mystery/);
    });

    test("attempt to inject __proto__ at the top level is rejected", () => {
      // Using JSON.parse with a literal so the __proto__ key is real
      // (not the prototype assignment).
      const obj = JSON.parse('{"__proto__":{"polluted":true}, "sessions":{}}');
      const r = validateSessionPatch(obj);
      expect(r.ok).toBe(false);
    });
  });
});
