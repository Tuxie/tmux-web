import { describe, test, expect } from "bun:test";
import { composeTheme } from "../../../src/client/colours.ts";

describe("composeTheme", () => {
  test("applies opacity to #RRGGBB background", () => {
    const t = composeTheme({ foreground: "#ffffff", background: "#112233" } as any, 50);
    expect(t.background).toBe("rgba(17,34,51,0.5)");
  });

  test("opacity 0 is fully transparent", () => {
    const t = composeTheme({ background: "#abcdef" } as any, 0);
    expect(t.background).toBe("rgba(171,205,239,0)");
  });

  test("opacity 100 preserves full alpha", () => {
    const t = composeTheme({ background: "#abcdef" } as any, 100);
    expect(t.background).toBe("rgba(171,205,239,1)");
  });

  test("preserves foreground untouched", () => {
    const t = composeTheme({ foreground: "#ff0000", background: "#000000" } as any, 40);
    expect(t.foreground).toBe("#ff0000");
  });

  test("#RRGGBBAA background: replaces existing alpha with opacity", () => {
    const t = composeTheme({ background: "#11223380" } as any, 50);
    expect(t.background).toBe("rgba(17,34,51,0.5)");
  });
});
