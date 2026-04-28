import { describe, test, expect, beforeAll } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";
import { listPacks, listColours, listThemes } from "../../../src/server/themes.ts";

let tmp: string;
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tw-coltest-"));
  const pack = path.join(tmp, "p1");
  fs.mkdirSync(path.join(pack, "colours"), { recursive: true });
  fs.writeFileSync(path.join(pack, "colours", "a.toml"),
    `[colors.primary]\nforeground="#ffffff"\nbackground="#000000"\n`);
  fs.writeFileSync(path.join(pack, "theme.json"), JSON.stringify({
    author: "t", version: "1",
    colours: [{ file: "colours/a.toml", name: "A", variant: "dark" }],
    themes: [{ name: "T1", css: "t.css",
      defaultColours: "A", defaultFont: "F", defaultFontSize: 14, defaultSpacing: 1.1,
      defaultTopbarAutohide: true, defaultScrollbarAutohide: true }],
  }));
  fs.writeFileSync(path.join(pack, "t.css"), "/* */");
});

describe("listColours / listThemes", () => {
  test("enumerates colours with parsed ITheme", () => {
    const packs = listPacks(null, tmp);
    const cols = listColours(packs);
    expect(cols).toHaveLength(1);
    expect(cols[0]!.name).toBe("A");
    expect(cols[0]!.variant).toBe("dark");
    expect(cols[0]!.theme.foreground).toBe("#ffffff");
  });

  test("theme info carries defaultColours, defaultFontSize, defaultSpacing", () => {
    const packs = listPacks(null, tmp);
    const themes = listThemes(packs);
    const t1 = themes.find(x => x.name === "T1")!;
    expect(t1.defaultColours).toBe("A");
    expect(t1.defaultFontSize).toBe(14);
    expect(t1.defaultSpacing).toBe(1.1);
    expect(t1.defaultTopbarAutohide).toBe(true);
    expect(t1.defaultScrollbarAutohide).toBe(true);
  });

  test("skips colour entry with invalid rel path", () => {
    const bad = path.join(tmp, "p2");
    fs.mkdirSync(bad);
    fs.writeFileSync(path.join(bad, "theme.json"), JSON.stringify({
      colours: [{ file: "../evil.toml", name: "BAD" }], themes: [],
    }));
    const packs = listPacks(null, tmp);
    const cols = listColours(packs);
    expect(cols.find(c => c.name === "BAD")).toBeUndefined();
  });
});
