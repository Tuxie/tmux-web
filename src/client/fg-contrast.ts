/**
 * Contrast transform (FG + explicit cell BG).
 *
 * Reshapes every colour's OKLab lightness around a cutoff derived from
 * the actual rendered background luminance (bgL) plus a user bias.
 *
 * Two independent stages:
 *
 * 1. Contrast (strength): gap/pull around bgL.
 *    Cutoff is always bgL. Bias does not move it.
 *
 * 2. Bias: independent output shift applied after contrast.
 *    finalL = biasNorm >= 0
 *      ? newL + biasNorm × (1 - newL)   // shift toward white
 *      : newL + biasNorm × newL          // shift toward black
 *    bias +100 → always white, -100 → always black, 0 → no shift.
 *
 * Piecewise by t = strength / 100 ∈ [-1, +1]:
 *
 *   t < 0  → linear lerp toward cutoff:
 *            L' = L × (1+t) + cutoff × (-t)
 *
 *   t = 0  → identity; everything else ignored.
 *
 *   t > 0  → exclusion gap around cutoff. Half-widths scale with
 *            cutoff's distance to each extreme:
 *              lower = cutoff × (1 - t)
 *              upper = cutoff + t × (1 - cutoff)
 *            Colours inside snap to nearest edge; outside stay put.
 *            At t=1 everything → 0 or 1 with cutoff as hard threshold.
 *
 * Hue and chroma (OKLab a, b) always pass through untouched.
 */

export const DEFAULT_FG_CONTRAST_STRENGTH = 0;   // -100..+100
export const DEFAULT_FG_CONTRAST_BIAS = 0;        // -100..+100 (0 = bg luminance)

export function clampFgContrastStrength(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_FG_CONTRAST_STRENGTH;
  return Math.max(-100, Math.min(100, Math.round(v)));
}

export function clampFgContrastBias(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_FG_CONTRAST_BIAS;
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

export function rgbToOklabL(r: number, g: number, b: number): number {
  return srgbByteToOklab(r, g, b)[0];
}

/**
 * Reshape `(r, g, b)` via contrast (gap/pull around bgL) then bias
 * (independent output shift toward bright/dark). Applies to both FG
 * and explicit cell BG.
 *
 * `strengthPct` — -100..+100: gap (>0) or pull (<0) around bgL.
 * `biasPct` — -100..+100: output shift. +100 → white, -100 → black.
 * `bgL` — OKLab L of the rendered background (0..1).
 */
export function pushLightness(
  r: number, g: number, b: number,
  strengthPct: number,
  biasPct: number,
  bgL: number,
): [number, number, number] {
  if (strengthPct === 0 && biasPct === 0) return [r, g, b];
  const t = Math.max(-1, Math.min(1, strengthPct / 100));
  const biasNorm = Math.max(-1, Math.min(1, biasPct / 100));
  const [inL, ia, ib] = srgbByteToOklab(r, g, b);

  let newL = inL;
  if (t < 0) {
    const mag = -t;
    newL = inL * (1 - mag) + bgL * mag;
  } else if (t > 0) {
    const lower = bgL * (1 - t);
    const upper = bgL + t * (1 - bgL);
    if (inL < lower) {
      newL = inL;
    } else if (inL < bgL) {
      newL = lower;
    } else if (inL <= upper) {
      newL = upper;
    } else {
      newL = inL;
    }
  }

  if (biasNorm > 0) {
    newL = newL + biasNorm * (1 - newL);
  } else if (biasNorm < 0) {
    newL = newL + biasNorm * newL;
  }

  newL = Math.max(0, Math.min(1, newL));
  return oklabToSrgbByte(newL, ia, ib);
}
