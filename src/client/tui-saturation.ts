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

import { srgbByteToOklab, oklabToSrgbByte } from './oklab.js';

export const DEFAULT_TUI_SATURATION = 0;  // -100..+100, 0 = identity

export function clampTuiSaturation(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_TUI_SATURATION;
  return Math.max(-100, Math.min(100, Math.round(v)));
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
