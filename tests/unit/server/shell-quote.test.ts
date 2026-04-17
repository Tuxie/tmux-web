import { describe, test, expect } from "bun:test";
import { shellQuote, isShell } from "../../../src/server/shell-quote.ts";

describe("shellQuote", () => {
  test("wraps a plain path in single quotes", () => {
    expect(shellQuote("/tmp/foo.txt")).toBe("'/tmp/foo.txt'");
  });

  test("paths with spaces are safely quoted as one argument", () => {
    expect(shellQuote("/tmp/hello world.txt")).toBe("'/tmp/hello world.txt'");
  });

  test("embedded single quotes are escaped via '\\\\''", () => {
    expect(shellQuote("/tmp/it's.txt")).toBe("'/tmp/it'\\''s.txt'");
  });

  test("multiple single quotes round-trip", () => {
    expect(shellQuote("a'b'c")).toBe("'a'\\''b'\\''c'");
  });

  test("shell metacharacters stay literal", () => {
    // Things that would be interpreted outside quotes: $ ` * ? ~ | > < etc.
    expect(shellQuote("$PATH; rm -rf /"))
      .toBe("'$PATH; rm -rf /'");
  });

  test("empty string becomes '' (valid POSIX empty argument)", () => {
    expect(shellQuote("")).toBe("''");
  });

  test("newlines inside the path are preserved verbatim", () => {
    expect(shellQuote("/tmp/foo\nbar")).toBe("'/tmp/foo\nbar'");
  });
});

describe("isShell", () => {
  test("recognises common shells by basename", () => {
    for (const shell of ["/bin/bash", "/bin/zsh", "/usr/bin/fish", "/bin/sh", "/bin/dash", "/usr/local/bin/ksh"]) {
      expect(isShell(shell)).toBe(true);
    }
  });

  test("does not flag editors or TUIs", () => {
    for (const exe of ["/usr/bin/vim", "/usr/bin/nvim", "/usr/bin/emacs", "/home/x/.claude/bin/claude", "/usr/bin/node"]) {
      expect(isShell(exe)).toBe(false);
    }
  });

  test("null exe (unknown foreground) → not a shell", () => {
    expect(isShell(null)).toBe(false);
  });

  test("basename match is anchored, not a substring", () => {
    // "bashful" is not bash.
    expect(isShell("/usr/local/bin/bashful")).toBe(false);
    // "/notbash/" contains the word but the basename isn't bash.
    expect(isShell("/opt/notbash/mything")).toBe(false);
  });
});
