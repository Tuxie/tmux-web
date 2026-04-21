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

import { srgbByteToOklab, oklabToSrgbByte } from './oklab.js';

export { rgbToOklabL } from './oklab.js';

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
