/**
 * FG Contrast transform.
 *
 * Reshapes every foreground colour's OKLab lightness around a
 * user-chosen bias, from "collapse everything to bias" at -100 through
 * "identity" at 0 to "hard black/white threshold at bias" at +100.
 * Hue and chroma (OKLab a, b) always pass through untouched.
 *
 * Piecewise by `t = strength / 100 ∈ [-1, +1]` and `B = bias / 100 ∈ [0, 1]`:
 *
 *   t < 0  → linear lerp toward bias:
 *            L' = L × (1+t) + B × (-t)
 *            (t=-1 collapses every L to B; t=0 is identity.)
 *
 *   t = 0  → identity; bias is ignored.
 *
 *   t > 0  → "gap" around the bias. Half-widths scale with the bias's
 *            distance to each extreme so the gap always covers [0,1]
 *            at t=1 even for off-centre biases:
 *              lower = B × (1 - t)
 *              upper = B + t × (1 - B)
 *            Colours inside the gap snap to the nearest edge; colours
 *            outside stay put. At t=1 everything collapses to 0 or 1
 *            with B as the hard threshold — matching the user's
 *            "maximum brightness or minimum brightness" description.
 *
 * Runs on every fg colour the atlas sees (P16, P256, truecolor,
 * inverse — all of them) via the glyph-renderer hook in
 * `src/client/adapters/xterm.ts`.
 */

export const DEFAULT_FG_CONTRAST_STRENGTH = 0;   // -100..+100
export const DEFAULT_FG_CONTRAST_BIAS = 50;      // 0..100 (50 = middle)

export function clampFgContrastStrength(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_FG_CONTRAST_STRENGTH;
  return Math.max(-100, Math.min(100, Math.round(v)));
}

export function clampFgContrastBias(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_FG_CONTRAST_BIAS;
  return Math.max(0, Math.min(100, Math.round(v)));
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
 * Reshape `(fgR, fgG, fgB)` per the strength/bias curve. See the
 * module-level comment for the piecewise formula. Identity at
 * `strengthPct === 0`; at ±100 the output either collapses to the
 * bias lightness (negative) or snaps each colour to the nearest of
 * black or white with the bias as threshold (positive).
 *
 * `strengthPct` is the -100..+100 slider value.
 * `biasPct` is the 0..100 slider value (50 = middle grey).
 *
 * Returns new `[r, g, b]` bytes in 0..255.
 */
export function pushFgLightness(
  fgR: number, fgG: number, fgB: number,
  strengthPct: number,
  biasPct: number,
): [number, number, number] {
  if (strengthPct === 0) return [fgR, fgG, fgB];
  const t = Math.max(-1, Math.min(1, strengthPct / 100));
  const B = Math.max(0, Math.min(1, biasPct / 100));
  const [fgL, fa, fb] = srgbByteToOklab(fgR, fgG, fgB);

  let newL: number;
  if (t < 0) {
    const mag = -t;
    newL = fgL * (1 - mag) + B * mag;
  } else {
    // Gap half-widths scale so at t=1 the dead zone covers the whole
    // [0, 1] range regardless of where B sits. Below bias, width is
    // B·t (so it reaches 0 at t=1); above bias, width is (1-B)·t
    // (so it reaches 1 at t=1).
    const lower = B * (1 - t);
    const upper = B + t * (1 - B);
    if (fgL < lower) {
      newL = fgL;                              // below the gap — stays
    } else if (fgL < B) {
      newL = lower;                            // in the gap, below bias — snap to lower edge
    } else if (fgL <= upper) {
      newL = upper;                            // in the gap, above bias — snap to upper edge
    } else {
      newL = fgL;                              // above the gap — stays
    }
  }

  newL = Math.max(0, Math.min(1, newL));
  return oklabToSrgbByte(newL, fa, fb);
}
