import { describe, test, expect } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";
import { isValidPackRelPath, readPackFile } from "../../../src/server/themes.ts";

describe("isValidPackRelPath", () => {
  test("accepts simple filename", () => {
    expect(isValidPackRelPath("default.css")).toBe(true);
  });
  test("accepts subdirectory path", () => {
    expect(isValidPackRelPath("colours/gruvbox-dark.toml")).toBe(true);
  });
  test("rejects empty string", () => {
    expect(isValidPackRelPath("")).toBe(false);
  });
  test("rejects parent traversal", () => {
    expect(isValidPackRelPath("../evil")).toBe(false);
    expect(isValidPackRelPath("colours/../evil.toml")).toBe(false);
  });
  test("rejects leading slash", () => {
    expect(isValidPackRelPath("/abs.toml")).toBe(false);
  });
  test("rejects backslash", () => {
    expect(isValidPackRelPath("colours\\evil.toml")).toBe(false);
  });
  test("rejects leading dot segment", () => {
    expect(isValidPackRelPath(".hidden/file.toml")).toBe(false);
  });
});

describe("readPackFile subdirectory support", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tw-pack-"));
  fs.mkdirSync(path.join(tmp, "colours"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "colours", "foo.toml"), "# empty\n");
  const packs = [{ dir: "x", fullPath: tmp, source: "bundled" as const, manifest: {} }];

  test("reads subdir path", () => {
    const r = readPackFile("x", "colours/foo.toml", packs);
    expect(r?.fullPath).toBe(path.join(tmp, "colours", "foo.toml"));
  });
  test("rejects traversal", () => {
    expect(readPackFile("x", "../escape", packs)).toBeNull();
  });
});
