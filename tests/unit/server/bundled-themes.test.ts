import { describe, expect, test } from "bun:test";
import path from "path";
import { listFonts, listPacks, listThemes } from "../../../src/server/themes";

// This test is an intentional live snapshot of the bundled theme
// directory (unlike the hermetic fixture at tests/fixtures/themes-
// bundled/). Renaming a shipped theme variant will fail this test by
// design — update the assertions together with the rename.
const THEMES = path.resolve(import.meta.dir, "../../../themes");

describe("bundled themes", () => {
  test("Amiga pack includes Amiga Scene 2000 with demoscene fonts and Dracula defaults", () => {
    const packs = listPacks(THEMES, null);

    const themes = listThemes(packs);
    const scene = themes.find(theme => theme.name === "Amiga Scene 2000");
    expect(scene).toBeDefined();
    expect(scene!.pack).toBe("amiga");
    expect(scene!.css).toBe("amigascene2k.css");
    expect(scene!.defaultColours).toBe("Dracula");
    expect(scene!.defaultFont).toBe("mOsOul");
    expect(scene!.defaultFontSize).toBe(17);
    expect(scene!.defaultSpacing).toBe(1.1);
    expect(scene!.defaultTuiBgOpacity).toBe(70);

    const defaultTheme = themes.find(theme => theme.name === "Default");
    expect(defaultTheme).toBeDefined();
    expect(defaultTheme!.defaultScrollbarAutohide).toBe(true);
    expect(defaultTheme!.defaultTopbarAutohide).toBeUndefined();

    const amiga = themes.find(theme => theme.name === "AmigaOS 3.1");
    expect(amiga).toBeDefined();
    expect(amiga!.css).toBe("amigaos31.css");
    expect(amiga!.defaultFont).toBe("Topaz8 Amiga1200");
    expect(amiga!.defaultFontSize).toBe(17);
    expect(amiga!.defaultSpacing).toBe(1.05);
    expect(amiga!.defaultScrollbarAutohide).toBeUndefined();

    const fonts = listFonts(packs);
    expect(fonts).toContainEqual({
      family: "MicroKnight",
      file: "MicroKnight.woff2",
      pack: "amiga",
      packDir: path.join(THEMES, "amiga"),
      copyright: "Niels Krogh \"Nölb/Grafictive\" Mortensen & dMG/t!s^dS!",
      fallbacks: ["Iosevka Amiga"],
    });
    expect(fonts).toContainEqual({
      family: "mOsOul",
      file: "mOsOul.woff2",
      pack: "amiga",
      packDir: path.join(THEMES, "amiga"),
      copyright: "Desoto/Mo'Soul & dMG/t!s^dS!",
      fallbacks: ["Iosevka Amiga"],
    });
  });
});
