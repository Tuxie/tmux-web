import { describe, test, expect } from "bun:test";
import { isValidPackRelPath } from "../../../src/server/themes.ts";

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
