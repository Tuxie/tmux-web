import { describe, expect, test } from "bun:test";
import {
  DEFAULT_BACKGROUND_HUE,
  DEFAULT_BACKGROUND_SATURATION,
  DEFAULT_BACKGROUND_BRIGHTEST,
  DEFAULT_BACKGROUND_DARKEST,
  DEFAULT_THEME_HUE,
  BASE_BACKGROUND_SATURATION_PCT,
  DEFAULT_THEME_SAT,
  DEFAULT_THEME_LTN,
  DEFAULT_THEME_CONTRAST,
  DEFAULT_DEPTH,
  applyBackgroundHue,
  applyBackgroundSaturation,
  applyBackgroundBrightest,
  applyBackgroundDarkest,
  applyThemeHue,
  clampBackgroundHue,
  clampBackgroundSaturation,
  clampBackgroundBrightest,
  clampBackgroundDarkest,
  clampThemeHue,
  clampThemeSat,
  clampThemeLtn,
  clampThemeContrast,
  clampDepth,
  applyThemeSat,
  applyThemeLtn,
  applyThemeContrast,
  applyDepth,
} from "../../../src/client/background-hue.ts";

function mockElement(): HTMLElement {
  const props = new Map<string, string>();
  return {
    style: {
      setProperty: (name: string, value: string) => props.set(name, value),
      getPropertyValue: (name: string) => props.get(name) ?? "",
    },
  } as unknown as HTMLElement;
}

describe("background hue", () => {
  test("defaults to the Scene petrol hue", () => {
    expect(DEFAULT_BACKGROUND_HUE).toBe(183);
  });

  test("clamps hue to the slider range", () => {
    expect(clampBackgroundHue(-1)).toBe(0);
    expect(clampBackgroundHue(42.7)).toBe(43);
    expect(clampBackgroundHue(361)).toBe(360);
    expect(clampBackgroundHue(Number.NaN)).toBe(DEFAULT_BACKGROUND_HUE);
  });

  test("applies only the hue CSS variable", () => {
    const props = new Map<string, string>([["--unrelated", "keep"]]);
    const el = {
      style: {
        setProperty: (name: string, value: string) => props.set(name, value),
        getPropertyValue: (name: string) => props.get(name) ?? "",
      },
    } as unknown as HTMLElement;

    applyBackgroundHue(210, el);

    expect(el.style.getPropertyValue("--tw-background-hue")).toBe("210");
    expect(el.style.getPropertyValue("--unrelated")).toBe("keep");
  });
});

describe("background saturation (delta semantics)", () => {
  test("defaults to 0 (no delta from theme base)", () => {
    // 0 means "use the theme's natural saturation". Mirrors the
    // Terminal Saturation slider's identity-at-zero semantics so the
    // two sliders feel consistent.
    expect(DEFAULT_BACKGROUND_SATURATION).toBe(0);
  });

  test("clamps delta to [-100, +100]", () => {
    expect(clampBackgroundSaturation(-150)).toBe(-100);
    expect(clampBackgroundSaturation(-100)).toBe(-100);
    expect(clampBackgroundSaturation(0)).toBe(0);
    expect(clampBackgroundSaturation(50.4)).toBe(50);
    expect(clampBackgroundSaturation(100)).toBe(100);
    expect(clampBackgroundSaturation(150)).toBe(100);
    expect(clampBackgroundSaturation(Number.NaN)).toBe(DEFAULT_BACKGROUND_SATURATION);
  });

  test("delta=0 writes the theme base saturation percent to CSS", () => {
    const el = mockElement();
    applyBackgroundSaturation(0, el);
    expect(el.style.getPropertyValue("--tw-background-saturation"))
      .toBe(String(BASE_BACKGROUND_SATURATION_PCT));
  });

  test("delta=-100 writes 0 (greyscale)", () => {
    const el = mockElement();
    applyBackgroundSaturation(-100, el);
    expect(el.style.getPropertyValue("--tw-background-saturation")).toBe("0");
  });

  test("delta=+100 doubles the base, clamped to 100", () => {
    const el = mockElement();
    applyBackgroundSaturation(100, el);
    const expected = Math.min(100, BASE_BACKGROUND_SATURATION_PCT * 2);
    expect(el.style.getPropertyValue("--tw-background-saturation"))
      .toBe(String(expected));
  });

  test("delta=-50 scales base by 0.5", () => {
    const el = mockElement();
    applyBackgroundSaturation(-50, el);
    const expected = Math.max(0, Math.min(100, Math.round(BASE_BACKGROUND_SATURATION_PCT * 0.5)));
    expect(el.style.getPropertyValue("--tw-background-saturation"))
      .toBe(String(expected));
  });
});

describe("background brightest", () => {
  test("defaults to 10", () => {
    expect(DEFAULT_BACKGROUND_BRIGHTEST).toBe(10);
  });

  test("clamps to 0..100", () => {
    expect(clampBackgroundBrightest(-5)).toBe(0);
    expect(clampBackgroundBrightest(0)).toBe(0);
    expect(clampBackgroundBrightest(10.6)).toBe(11);
    expect(clampBackgroundBrightest(100)).toBe(100);
    expect(clampBackgroundBrightest(150)).toBe(100);
    expect(clampBackgroundBrightest(NaN)).toBe(DEFAULT_BACKGROUND_BRIGHTEST);
  });

  test("applies --tw-background-brightest as integer", () => {
    const el = mockElement();
    applyBackgroundBrightest(15, el);
    expect(el.style.getPropertyValue("--tw-background-brightest")).toBe("15");
  });
});

describe("background darkest", () => {
  test("defaults to 5", () => {
    expect(DEFAULT_BACKGROUND_DARKEST).toBe(5);
  });

  test("clamps to 0..100", () => {
    expect(clampBackgroundDarkest(-1)).toBe(0);
    expect(clampBackgroundDarkest(0)).toBe(0);
    expect(clampBackgroundDarkest(7.8)).toBe(8);
    expect(clampBackgroundDarkest(100)).toBe(100);
    expect(clampBackgroundDarkest(200)).toBe(100);
    expect(clampBackgroundDarkest(NaN)).toBe(DEFAULT_BACKGROUND_DARKEST);
  });

  test("applies --tw-background-darkest as integer", () => {
    const el = mockElement();
    applyBackgroundDarkest(3, el);
    expect(el.style.getPropertyValue("--tw-background-darkest")).toBe("3");
  });
});

describe("theme hue", () => {
  test("defaults to 222", () => {
    expect(DEFAULT_THEME_HUE).toBe(222);
  });

  test("clamps to 0..360", () => {
    expect(clampThemeHue(-1)).toBe(0);
    expect(clampThemeHue(0)).toBe(0);
    expect(clampThemeHue(180.6)).toBe(181);
    expect(clampThemeHue(360)).toBe(360);
    expect(clampThemeHue(400)).toBe(360);
    expect(clampThemeHue(NaN)).toBe(DEFAULT_THEME_HUE);
  });

  test("applies --tw-theme-hue as integer", () => {
    const el = mockElement();
    applyThemeHue(270, el);
    expect(el.style.getPropertyValue("--tw-theme-hue")).toBe("270");
  });
});

describe("theme saturation", () => {
  test("defaults to 0%", () => {
    expect(DEFAULT_THEME_SAT).toBe(0);
  });

  test("clamps to 0..100", () => {
    expect(clampThemeSat(-10)).toBe(0);
    expect(clampThemeSat(0)).toBe(0);
    expect(clampThemeSat(50.7)).toBe(51);
    expect(clampThemeSat(100)).toBe(100);
    expect(clampThemeSat(150)).toBe(100);
    expect(clampThemeSat(NaN)).toBe(DEFAULT_THEME_SAT);
  });

  test("applies --tw-theme-sat as percentage", () => {
    const el = mockElement();
    applyThemeSat(38, el);
    expect(el.style.getPropertyValue("--tw-theme-sat")).toBe("38%");
  });
});

describe("theme lightness", () => {
  test("defaults to 15%", () => {
    expect(DEFAULT_THEME_LTN).toBe(15);
  });

  test("clamps to 0..100", () => {
    expect(clampThemeLtn(-5)).toBe(0);
    expect(clampThemeLtn(0)).toBe(0);
    expect(clampThemeLtn(62.3)).toBe(62);
    expect(clampThemeLtn(100)).toBe(100);
    expect(clampThemeLtn(200)).toBe(100);
    expect(clampThemeLtn(NaN)).toBe(DEFAULT_THEME_LTN);
  });

  test("applies --tw-theme-ltn as percentage", () => {
    const el = mockElement();
    applyThemeLtn(62, el);
    expect(el.style.getPropertyValue("--tw-theme-ltn")).toBe("62%");
  });
});

describe("theme contrast", () => {
  test("defaults to 0 (maps to 1.0x)", () => {
    expect(DEFAULT_THEME_CONTRAST).toBe(0);
  });

  test("clamps to -100..+100", () => {
    expect(clampThemeContrast(-150)).toBe(-100);
    expect(clampThemeContrast(-100)).toBe(-100);
    expect(clampThemeContrast(0)).toBe(0);
    expect(clampThemeContrast(50.4)).toBe(50);
    expect(clampThemeContrast(100)).toBe(100);
    expect(clampThemeContrast(150)).toBe(100);
    expect(clampThemeContrast(NaN)).toBe(DEFAULT_THEME_CONTRAST);
  });

  test("contrast 0 → factor 1 (theme default)", () => {
    const el = mockElement();
    applyThemeContrast(0, el);
    expect(el.style.getPropertyValue("--tw-theme-contrast")).toBe("1");
  });

  test("contrast -100 → factor 0 (flat)", () => {
    const el = mockElement();
    applyThemeContrast(-100, el);
    expect(el.style.getPropertyValue("--tw-theme-contrast")).toBe("0");
  });

  test("contrast +100 → factor 20 (5% base × 20 = 100%)", () => {
    const el = mockElement();
    applyThemeContrast(100, el);
    expect(el.style.getPropertyValue("--tw-theme-contrast")).toBe("20");
  });

  test("contrast +50 → factor 10.5 (midpoint)", () => {
    const el = mockElement();
    applyThemeContrast(50, el);
    expect(el.style.getPropertyValue("--tw-theme-contrast")).toBe("10.5");
  });

  test("contrast -50 → factor 0.5 (halved)", () => {
    const el = mockElement();
    applyThemeContrast(-50, el);
    expect(el.style.getPropertyValue("--tw-theme-contrast")).toBe("0.5");
  });
});

describe("depth", () => {
  test("defaults to 20", () => {
    expect(DEFAULT_DEPTH).toBe(20);
  });

  test("clamps to 0..100", () => {
    expect(clampDepth(-10)).toBe(0);
    expect(clampDepth(0)).toBe(0);
    expect(clampDepth(50)).toBe(50);
    expect(clampDepth(100)).toBe(100);
    expect(clampDepth(150)).toBe(100);
    expect(clampDepth(NaN)).toBe(DEFAULT_DEPTH);
  });

  test("depth 0 → --tw-depth 0 (invisible bevels)", () => {
    const el = mockElement();
    applyDepth(0, el);
    expect(el.style.getPropertyValue("--tw-depth")).toBe("0");
  });

  test("depth 50 → --tw-depth 0.5", () => {
    const el = mockElement();
    applyDepth(50, el);
    expect(el.style.getPropertyValue("--tw-depth")).toBe("0.5");
  });

  test("depth 100 → --tw-depth 1 (opaque B/W bevels)", () => {
    const el = mockElement();
    applyDepth(100, el);
    expect(el.style.getPropertyValue("--tw-depth")).toBe("1");
  });
});
