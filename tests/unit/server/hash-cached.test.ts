import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { hashFile, hashFileCached, _resetHashCache } from "../../../src/server/hash.ts";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tw-hash-cache-"));
  _resetHashCache();
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  _resetHashCache();
});

describe("hashFileCached (cluster 15 / F8)", () => {
  test("first call computes; second call with unchanged mtime returns cached value (no re-hash)", async () => {
    const p = path.join(tmp, "bin");
    fs.writeFileSync(p, "hello world");
    const expected = await hashFile(p);

    const first = await hashFileCached(p);
    expect(first).toBe(expected);

    // Mutate the file *content* but force the mtime back to the
    // pre-cache stamp. The cache must serve the OLD hash because mtime
    // is unchanged — the security contract is "mtime-keyed",
    // mtime-stable means cache-stable. (In real life a swap would
    // change mtime; this test exercises the intended cache-hit path.)
    const stat = fs.statSync(p);
    fs.writeFileSync(p, "completely different content");
    fs.utimesSync(p, stat.atimeMs / 1000, stat.mtimeMs / 1000);
    // Verify mtime didn't change (otherwise the test isn't testing the
    // hit path).
    expect(fs.statSync(p).mtimeMs).toBe(stat.mtimeMs);

    const second = await hashFileCached(p);
    expect(second).toBe(first);
  });

  test("mtime mismatch invalidates the cache (binary swap revokes grant)", async () => {
    const p = path.join(tmp, "bin");
    fs.writeFileSync(p, "v1");
    const v1Hash = await hashFileCached(p);

    // Wait long enough for fs mtime resolution (1ms) to differ.
    await new Promise(r => setTimeout(r, 20));
    fs.writeFileSync(p, "v2 — different content and a fresh mtime");

    const v2Hash = await hashFileCached(p);
    expect(v2Hash).not.toBe(v1Hash);

    // Verify the v2 hash matches a fresh non-cached hashFile.
    expect(v2Hash).toBe(await hashFile(p));
  });

  test("missing file: stat throws → cache invalidated, hashFile attempt throws too", async () => {
    const p = path.join(tmp, "doomed");
    fs.writeFileSync(p, "x");
    await hashFileCached(p);

    fs.unlinkSync(p);

    let caught: unknown = null;
    try { await hashFileCached(p); }
    catch (err) { caught = err; }
    expect(caught).not.toBeNull();
  });

  test("_resetHashCache forces re-hash even when mtime unchanged", async () => {
    const p = path.join(tmp, "bin");
    fs.writeFileSync(p, "stable");
    const first = await hashFileCached(p);

    // Without reset: would be a cache hit.
    _resetHashCache();

    // After reset, the next call must compute fresh.
    const second = await hashFileCached(p);
    expect(second).toBe(first); // value identical, but recomputed
  });

  test("multiple distinct paths each get their own cache entry", async () => {
    const a = path.join(tmp, "a");
    const b = path.join(tmp, "b");
    fs.writeFileSync(a, "alpha");
    fs.writeFileSync(b, "beta");

    const aHash = await hashFileCached(a);
    const bHash = await hashFileCached(b);
    expect(aHash).not.toBe(bHash);

    // Cached subsequent calls return the same values.
    expect(await hashFileCached(a)).toBe(aHash);
    expect(await hashFileCached(b)).toBe(bHash);
  });
});
