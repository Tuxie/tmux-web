import { describe, test, expect } from "bun:test";
import { composeBgColor, composeTheme, fetchColours } from "../../../src/client/colours.ts";

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

  test("blends with bodyBg when rgb() body is opaque and opacity < 100", () => {
    const t = { background: "#ffffff" } as any;
    // 50% blend of white(255,255,255) with body red(255,0,0)
    const result = composeTheme(t, 50, "rgb(255, 0, 0)").background;
    // (255*0.5 + 255*0.5) = 255, (255*0.5 + 0*0.5) = 128, (255*0.5 + 0*0.5) = 128
    expect(result).toBe("rgba(255,128,128,0)");
  });

  test("blends with bodyBg rgba() too", () => {
    const t = { background: "#ffffff" } as any;
    const result = composeTheme(t, 50, "rgba(0, 0, 0, 1)").background;
    expect(result).toBe("rgba(128,128,128,0)");
  });

  test("skips blending when body alpha is 0", () => {
    const t = { background: "#ffffff" } as any;
    expect(composeTheme(t, 50, "rgba(0, 0, 0, 0)").background).toBe("rgba(255,255,255,0)");
  });

  test("skips blending at 100% opacity", () => {
    const t = { background: "#112233" } as any;
    expect(composeTheme(t, 100, "rgb(0, 0, 0)").background).toBe("rgba(17,34,51,0)");
  });

  test("skips blending for non-rgb bodyBg (e.g. 'transparent')", () => {
    const t = { background: "#112233" } as any;
    expect(composeTheme(t, 50, "transparent").background).toBe("rgba(17,34,51,0)");
  });
});

describe("fetchColours", () => {
  test("returns parsed body on success", async () => {
    const body = [{ name: "Gruvbox", theme: { background: "#282828" } }];
    (globalThis as any).fetch = async () => ({ ok: true, json: async () => body });
    const result = await fetchColours();
    expect(result).toEqual(body as any);
  });

  test("returns empty array on non-ok", async () => {
    (globalThis as any).fetch = async () => ({ ok: false, json: async () => { throw new Error('no'); } });
    expect(await fetchColours()).toEqual([]);
  });
});
