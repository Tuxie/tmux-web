import { describe, expect, test } from "bun:test";
import path from "path";
import { listFonts, listPacks, listThemes } from "../../../src/server/themes";

const THEMES = path.resolve(import.meta.dir, "../../../themes");

describe("bundled themes", () => {
  test("Amiga pack includes Amiga Scene 2000 with demoscene fonts and Dracula defaults", () => {
    const packs = listPacks(THEMES, null);

    const themes = listThemes(packs);
    const scene = themes.find(theme => theme.name === "Amiga Scene 2000");
    expect(scene).toBeDefined();
    expect(scene!.pack).toBe("amiga");
    expect(scene!.css).toBe("scene.css");
    expect(scene!.defaultColours).toBe("Dracula");
    expect(scene!.defaultFont).toBe("mOsOul Nerd Font");
    expect(scene!.defaultTuiBgOpacity).toBe(70);

    const fonts = listFonts(packs);
    expect(fonts).toContainEqual({
      family: "MicroKnight Nerd Font",
      file: "MicroKnight Nerd Font.woff2",
      pack: "amiga",
      packDir: path.join(THEMES, "amiga"),
    });
    expect(fonts).toContainEqual({
      family: "mOsOul Nerd Font",
      file: "mOsOul Nerd Font.woff2",
      pack: "amiga",
      packDir: path.join(THEMES, "amiga"),
    });
  });
});
