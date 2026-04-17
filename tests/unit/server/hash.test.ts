import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { hashFile } from "../../../src/server/hash.ts";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tw-hash-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("hashFile (blake3)", () => {
  test("empty file hashes to the known BLAKE3 empty digest", async () => {
    const p = path.join(tmp, "empty");
    fs.writeFileSync(p, "");
    expect(await hashFile(p)).toBe(
      "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262",
    );
  });

  test("identical content yields identical digests", async () => {
    const a = path.join(tmp, "a");
    const b = path.join(tmp, "b");
    fs.writeFileSync(a, "hello world");
    fs.writeFileSync(b, "hello world");
    expect(await hashFile(a)).toBe(await hashFile(b));
  });

  test("differing content yields differing digests", async () => {
    const a = path.join(tmp, "a");
    const b = path.join(tmp, "b");
    fs.writeFileSync(a, "hello");
    fs.writeFileSync(b, "hello!");
    expect(await hashFile(a)).not.toBe(await hashFile(b));
  });
});
