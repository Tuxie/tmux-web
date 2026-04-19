import { describe, expect, test } from "bun:test";
import {
  DEFAULT_BACKGROUND_HUE,
  DEFAULT_BACKGROUND_SATURATION,
  BASE_BACKGROUND_SATURATION_PCT,
  applyBackgroundHue,
  applyBackgroundSaturation,
  clampBackgroundHue,
  clampBackgroundSaturation,
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
