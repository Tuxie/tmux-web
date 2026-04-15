import { describe, test, expect } from "bun:test";
import { composeBgColor, composeTheme } from "../../../src/client/colours.ts";

describe("composeBgColor", () => {
  test("applies opacity to #RRGGBB background", () => {
    expect(composeBgColor({ foreground: "#ffffff", background: "#112233" } as any, 50)).toBe("rgba(17,34,51,0.5)");
  });

  test("opacity 0 is fully transparent", () => {
    expect(composeBgColor({ background: "#abcdef" } as any, 0)).toBe("rgba(171,205,239,0)");
  });

  test("opacity 100 preserves full alpha", () => {
    expect(composeBgColor({ background: "#abcdef" } as any, 100)).toBe("rgba(171,205,239,1)");
  });

  test("#RRGGBBAA background: uses only RGB portion", () => {
    expect(composeBgColor({ background: "#11223380" } as any, 50)).toBe("rgba(17,34,51,0.5)");
  });
});

describe("composeTheme", () => {
  test("sets background to transparent", () => {
    const t = composeTheme({ foreground: "#ffffff", background: "#112233" } as any);
    expect(t.background).toBe("transparent");
  });

  test("preserves foreground untouched", () => {
    const t = composeTheme({ foreground: "#ff0000", background: "#000000" } as any);
    expect(t.foreground).toBe("#ff0000");
  });

  test("preserves other theme colours", () => {
    const t = composeTheme({ background: "#000", cursor: "#fff" } as any);
    expect(t.cursor).toBe("#fff");
  });
});
