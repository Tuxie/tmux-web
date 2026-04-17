import { describe, test, expect } from "bun:test";
import { formatBracketedPasteForDrop } from "../../../src/server/drop-paste.ts";

const ESC = "\x1b";
const BP_OPEN = `${ESC}[200~`;
const BP_CLOSE = `${ESC}[201~`;

describe("formatBracketedPasteForDrop", () => {
  test("always ends with a trailing space followed by bracketed-paste close", () => {
    // Sentinel test for the "space after path" requirement — multi-file
    // drops rely on this to concatenate as `p1 p2 p3 ` for e.g.
    // `cp <drop several> ~/Downloads/`.
    const out = formatBracketedPasteForDrop(null, "/tmp/foo.png");
    expect(out.endsWith(` ${BP_CLOSE}`)).toBe(true);
  });

  test("Claude / unknown foreground: raw path, no quoting", () => {
    expect(formatBracketedPasteForDrop(null, "/tmp/hello world.png"))
      .toBe(`${BP_OPEN}/tmp/hello world.png ${BP_CLOSE}`);
    expect(formatBracketedPasteForDrop("/home/x/.claude/bin/claude", "/tmp/foo"))
      .toBe(`${BP_OPEN}/tmp/foo ${BP_CLOSE}`);
  });

  test("shell foreground: path is single-quoted so spaces stay one argument", () => {
    expect(formatBracketedPasteForDrop("/bin/bash", "/tmp/hello world.png"))
      .toBe(`${BP_OPEN}'/tmp/hello world.png' ${BP_CLOSE}`);
  });

  test("shell foreground + single quote in path: POSIX-escaped", () => {
    expect(formatBracketedPasteForDrop("/bin/zsh", "/tmp/it's mine.txt"))
      .toBe(`${BP_OPEN}'/tmp/it'\\''s mine.txt' ${BP_CLOSE}`);
  });

  test("bracketed-paste markers wrap the payload (no auto-execute risk)", () => {
    const out = formatBracketedPasteForDrop(null, "/tmp/x");
    expect(out.startsWith(BP_OPEN)).toBe(true);
    expect(out.endsWith(BP_CLOSE)).toBe(true);
  });

  test("non-shell basenames (vim, helix, node, custom TUI) get raw paths", () => {
    for (const fg of ["/usr/bin/vim", "/usr/bin/helix", "/usr/bin/node", "/opt/mytui"]) {
      expect(formatBracketedPasteForDrop(fg, "/tmp/spaces here"))
        .toBe(`${BP_OPEN}/tmp/spaces here ${BP_CLOSE}`);
    }
  });
});
