import { describe, test, expect } from "bun:test";
import { composeBgColor, composeTheme } from "../../../src/client/colours.ts";

describe("composeBgColor", () => {
  test("applies opacity to #RRGGBB background", () => {
    expect(composeBgColor({ foreground: "#ffffff", background: "#112233" } as any, 50)).toBe("rgba(17,34,51,0.5)");
  });

  test("opacity 0 is fully transparent", () => {
    expect(composeBgColor({ background: "#abcdef" } as any, 0)).toBe("rgba(171,205,239,0)");
  });

  test("opacity 100 is fully opaque", () => {
    expect(composeBgColor({ background: "#abcdef" } as any, 100)).toBe("rgba(171,205,239,1)");
  });

  test("#RRGGBBAA background: uses only RGB portion", () => {
    expect(composeBgColor({ background: "#11223380" } as any, 50)).toBe("rgba(17,34,51,0.5)");
  });
});

describe("composeTheme", () => {
  test("default bg is always fully transparent (opacity lives on #page)", () => {
    const t = { foreground: "#ffffff", background: "#112233" } as any;
    expect(composeTheme(t, 0).background).toBe("rgba(17,34,51,0)");
    expect(composeTheme(t, 50).background).toBe("rgba(17,34,51,0)");
    expect(composeTheme(t, 100).background).toBe("rgba(17,34,51,0)");
  });

  test("foreground is preserved", () => {
    const t = { foreground: "#abcdef", background: "#112233" } as any;
    expect(composeTheme(t, 50).foreground).toBe("#abcdef");
  });

  test("missing background falls back to black", () => {
    const t = { foreground: "#fff" } as any;
    expect(composeTheme(t, 100).background).toBe("rgba(0,0,0,0)");
  });
});
