import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { saveConfig } from "../../../src/server/sessions-store.ts";
import { resolvePolicy, recordGrant } from "../../../src/server/clipboard-policy.ts";
import { hashFile } from "../../../src/server/hash.ts";

let tmp: string;
let storePath: string;
let exePath: string;

const SESSION = "main";
const BASE_SESSION = {
  theme: "Default",
  colours: "Gruvbox Dark",
  fontFamily: "Iosevka",
  fontSize: 18,
  spacing: 0.85,
  opacity: 0,
};

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tw-clip-"));
  storePath = path.join(tmp, "sessions.json");
  exePath = path.join(tmp, "fakebin");
  fs.writeFileSync(exePath, "\x7fELF\x02\x01\x01");
  saveConfig(storePath, {
    version: 1,
    sessions: { [SESSION]: { ...BASE_SESSION } },
  });
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("resolvePolicy", () => {
  test("no entry -> prompt", async () => {
    expect(await resolvePolicy(storePath, SESSION, exePath, "read")).toBe("prompt");
  });

  test("unknown session -> prompt", async () => {
    expect(await resolvePolicy(storePath, "nope", exePath, "read")).toBe("prompt");
  });

  test("allow grant with no expiry and no hash pin -> allow", async () => {
    await recordGrant({
      filePath: storePath, session: SESSION, exePath, action: "read",
      allow: true, expiresAt: null, pinHash: false,
    });
    expect(await resolvePolicy(storePath, SESSION, exePath, "read")).toBe("allow");
  });

  test("deny grant -> deny", async () => {
    await recordGrant({
      filePath: storePath, session: SESSION, exePath, action: "read",
      allow: false, expiresAt: null, pinHash: false,
    });
    expect(await resolvePolicy(storePath, SESSION, exePath, "read")).toBe("deny");
  });

  test("expired grant -> prompt", async () => {
    await recordGrant({
      filePath: storePath, session: SESSION, exePath, action: "read",
      allow: true, expiresAt: new Date(Date.now() - 1000).toISOString(), pinHash: false,
    });
    expect(await resolvePolicy(storePath, SESSION, exePath, "read")).toBe("prompt");
  });

  test("future expiry honoured -> allow", async () => {
    await recordGrant({
      filePath: storePath, session: SESSION, exePath, action: "read",
      allow: true, expiresAt: new Date(Date.now() + 60_000).toISOString(), pinHash: false,
    });
    expect(await resolvePolicy(storePath, SESSION, exePath, "read")).toBe("allow");
  });

  test("pinned hash matches current file -> allow", async () => {
    await recordGrant({
      filePath: storePath, session: SESSION, exePath, action: "read",
      allow: true, expiresAt: null, pinHash: true,
    });
    expect(await resolvePolicy(storePath, SESSION, exePath, "read")).toBe("allow");
  });

  test("pinned hash mismatch (binary swapped) -> prompt", async () => {
    await recordGrant({
      filePath: storePath, session: SESSION, exePath, action: "read",
      allow: true, expiresAt: null, pinHash: true,
    });
    fs.writeFileSync(exePath, "different content");
    expect(await resolvePolicy(storePath, SESSION, exePath, "read")).toBe("prompt");
  });

  test("read and write grants are independent", async () => {
    await recordGrant({
      filePath: storePath, session: SESSION, exePath, action: "read",
      allow: true, expiresAt: null, pinHash: false,
    });
    expect(await resolvePolicy(storePath, SESSION, exePath, "read")).toBe("allow");
    expect(await resolvePolicy(storePath, SESSION, exePath, "write")).toBe("prompt");
  });
});

describe("recordGrant", () => {
  test("writes to sessions.json atomically and preserves sibling fields", async () => {
    await recordGrant({
      filePath: storePath, session: SESSION, exePath, action: "read",
      allow: true, expiresAt: null, pinHash: true,
    });
    const raw = JSON.parse(fs.readFileSync(storePath, "utf-8"));
    const entry = raw.sessions[SESSION].clipboard[exePath];
    expect(entry.blake3).toBe(await hashFile(exePath));
    expect(entry.read.allow).toBe(true);
    expect(entry.read.expiresAt).toBeNull();
    expect(typeof entry.read.grantedAt).toBe("string");
    // Settings from before the grant are still there.
    expect(raw.sessions[SESSION].theme).toBe("Default");
    expect(fs.existsSync(storePath + ".part")).toBe(false);
  });

  test("recording a new action keeps the previous action's grant", async () => {
    await recordGrant({
      filePath: storePath, session: SESSION, exePath, action: "read",
      allow: true, expiresAt: null, pinHash: false,
    });
    await recordGrant({
      filePath: storePath, session: SESSION, exePath, action: "write",
      allow: false, expiresAt: null, pinHash: false,
    });
    const raw = JSON.parse(fs.readFileSync(storePath, "utf-8"));
    const entry = raw.sessions[SESSION].clipboard[exePath];
    expect(entry.read.allow).toBe(true);
    expect(entry.write.allow).toBe(false);
  });

  test("recording without pinHash preserves an earlier hash pin", async () => {
    await recordGrant({
      filePath: storePath, session: SESSION, exePath, action: "read",
      allow: true, expiresAt: null, pinHash: true,
    });
    const hashBefore = JSON.parse(fs.readFileSync(storePath, "utf-8"))
      .sessions[SESSION].clipboard[exePath].blake3;
    expect(hashBefore).not.toBeNull();

    await recordGrant({
      filePath: storePath, session: SESSION, exePath, action: "write",
      allow: true, expiresAt: null, pinHash: false,
    });
    const hashAfter = JSON.parse(fs.readFileSync(storePath, "utf-8"))
      .sessions[SESSION].clipboard[exePath].blake3;
    expect(hashAfter).toBe(hashBefore);
  });

  test("recording for a session that doesn't exist is a no-op", async () => {
    await recordGrant({
      filePath: storePath, session: "missing", exePath, action: "read",
      allow: true, expiresAt: null, pinHash: false,
    });
    const raw = JSON.parse(fs.readFileSync(storePath, "utf-8"));
    expect(raw.sessions.missing).toBeUndefined();
  });
});
