import { describe, expect, test } from "bun:test";
import {
  DEFAULT_BACKGROUND_HUE,
  applyBackgroundHue,
  clampBackgroundHue,
} from "../../../src/client/background-hue.ts";

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
