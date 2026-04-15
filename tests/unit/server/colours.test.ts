import { describe, test, expect } from "bun:test";
import { alacrittyTomlToITheme } from "../../../src/server/colours.ts";

const minimal = `
[colors.primary]
foreground = "#d4d4d4"
background = "#1e1e1e"

[colors.normal]
black   = "#000000"
red     = "#cc0000"
green   = "#00cc00"
yellow  = "#cccc00"
blue    = "#0000cc"
magenta = "#cc00cc"
cyan    = "#00cccc"
white   = "#cccccc"

[colors.bright]
black   = "#555555"
red     = "#ff5555"
green   = "#55ff55"
yellow  = "#ffff55"
blue    = "#5555ff"
magenta = "#ff55ff"
cyan    = "#55ffff"
white   = "#ffffff"

[colors.cursor]
cursor = "#aabbcc"
text   = "#112233"

[colors.selection]
background = "#334455"
text       = "#665544"
`;

describe("alacrittyTomlToITheme", () => {
  test("maps all primary/normal/bright/cursor/selection", () => {
    const t = alacrittyTomlToITheme(minimal);
    expect(t.foreground).toBe("#d4d4d4");
    expect(t.background).toBe("#1e1e1e");
    expect(t.black).toBe("#000000");
    expect(t.white).toBe("#cccccc");
    expect(t.brightBlack).toBe("#555555");
    expect(t.brightWhite).toBe("#ffffff");
    expect(t.cursor).toBe("#aabbcc");
    expect(t.cursorAccent).toBe("#112233");
    expect(t.selectionBackground).toBe("#334455");
    expect(t.selectionForeground).toBe("#665544");
  });

  test("passes through #RRGGBBAA unchanged", () => {
    const t = alacrittyTomlToITheme(`
[colors.primary]
foreground = "#ff00ff80"
background = "#00000000"
`);
    expect(t.foreground).toBe("#ff00ff80");
    expect(t.background).toBe("#00000000");
  });

  test("normalizes 0x prefix to #", () => {
    const t = alacrittyTomlToITheme(`
[colors.primary]
foreground = "0xaabbcc"
background = "0x112233"
`);
    expect(t.foreground).toBe("#aabbcc");
    expect(t.background).toBe("#112233");
  });

  test("missing sections fall back to undefined (xterm defaults)", () => {
    const t = alacrittyTomlToITheme(`
[colors.primary]
foreground = "#ffffff"
background = "#000000"
`);
    expect(t.black).toBeUndefined();
    expect(t.cursor).toBeUndefined();
  });

  test("throws on invalid TOML", () => {
    expect(() => alacrittyTomlToITheme("this = is [broken")).toThrow();
  });

  test("throws if neither foreground nor background present", () => {
    expect(() => alacrittyTomlToITheme(`[colors.normal]\nblack = "#000"\n`)).toThrow(/primary/);
  });
});
