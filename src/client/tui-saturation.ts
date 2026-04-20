/**
 * TUI Saturation transform.
 *
 * Scales every terminal colour's OKLab chroma (a, b) by a user-chosen
 * factor; lightness (L) is preserved. At -100 chroma collapses to 0
 * (full greyscale), at 0 the transform is identity, at +100 chroma is
 * doubled (colours pushed toward their hue's most saturated
 * representable form, then sRGB-clamped).
 *
 *   factor = 1 + pct/100   ∈ [0, 2]
 *
 * Runs after `pushLightness` in the FG path and after the BG rect's
 * alpha premultiply in the BG path — see `src/client/adapters/xterm.ts`.
 * Greys are natural fixed points at any setting because their input
 * chroma is already zero.
 */

export const DEFAULT_TUI_SATURATION = 0;  // -100..+100, 0 = identity

export function clampTuiSaturation(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_TUI_SATURATION;
  return Math.max(-100, Math.min(100, Math.round(v)));
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c: number): number {
  const x = Math.max(0, Math.min(1, c));
  return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

function srgbByteToOklab(r: number, g: number, b: number): [number, number, number] {
  const rL = srgbToLinear(r / 255);
  const gL = srgbToLinear(g / 255);
  const bL = srgbToLinear(b / 255);
  const l = 0.4122214708 * rL + 0.5363325363 * gL + 0.0514459929 * bL;
  const m = 0.2119034982 * rL + 0.6806995451 * gL + 0.1073969566 * bL;
  const s = 0.0883024619 * rL + 0.2817188376 * gL + 0.6299787005 * bL;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return [
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  ];
}

function oklabToSrgbByte(L: number, a: number, b: number): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const lin = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  const rL = 4.0767416621 * lin - 3.3077115913 * m + 0.2309699292 * s;
  const gL = -1.2684380046 * lin + 2.6097574011 * m - 0.3413193965 * s;
  const bL = -0.0041960863 * lin - 0.7034186147 * m + 1.7076147010 * s;
  return [
    Math.round(linearToSrgb(rL) * 255),
    Math.round(linearToSrgb(gL) * 255),
    Math.round(linearToSrgb(bL) * 255),
  ];
}

/**
 * Scale `(r, g, b)`'s OKLab chroma by `1 + pct/100`, preserving
 * lightness and hue direction. See module comment for the curve.
 *
 * `pct` is the -100..+100 slider value. Out-of-range inputs are
 * clamped. At `pct === 0` returns the input bytes unchanged.
 */
export function adjustSaturation(r: number, g: number, b: number, pct: number): [number, number, number] {
  if (pct === 0) return [r, g, b];
  const clamped = Math.max(-100, Math.min(100, pct));
  const factor = 1 + clamped / 100;
  const [L, a, bb] = srgbByteToOklab(r, g, b);
  return oklabToSrgbByte(L, a * factor, bb * factor);
}
