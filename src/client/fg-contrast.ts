/**
 * FG Contrast transform.
 *
 * Pushes a foreground colour's OKLab lightness *away* from a reference
 * lightness (the cell's visible bg L, optionally shifted by a bias) so
 * TUI text that sits on a background of similar brightness doesn't
 * disappear. Runs on every fg colour the atlas sees — P16, P256, and
 * truecolor alike — via the glyph-renderer hook in
 * `src/client/adapters/xterm.ts`.
 *
 * Curve:
 *
 *   d    = fgL - (bgL + bias)
 *   push = k × d × exp(-d² / σ²)
 *   fgL' = clamp(fgL + push, 0, 1)
 *
 * - `k` grows with the user's strength slider (0..100 → 0..2).
 * - `σ` is fixed at 0.3 — wide enough that mid-tones move, pure
 *   black/white stay put.
 * - `bias` is the user's bias slider (-50..+50 → -0.5..+0.5), shifting
 *   the repulsion midpoint so the user can prefer darker or brighter
 *   fg colours in ambiguous regions.
 *
 * The hue/chroma components of OKLab (a, b) pass through untouched —
 * only lightness moves. Colours far from the reference (pure black on
 * light bg, pure white on dark bg, etc.) get a near-zero push thanks
 * to the Gaussian decay, so extremes stay extreme.
 */

export const DEFAULT_FG_CONTRAST_STRENGTH = 0;   // 0..100
export const DEFAULT_FG_CONTRAST_BIAS = 0;       // -50..+50
const SIGMA = 0.3;
const MAX_K = 2;

export function clampFgContrastStrength(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_FG_CONTRAST_STRENGTH;
  return Math.max(0, Math.min(100, Math.round(v)));
}

export function clampFgContrastBias(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_FG_CONTRAST_BIAS;
  return Math.max(-50, Math.min(50, Math.round(v)));
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c: number): number {
  const x = Math.max(0, Math.min(1, c));
  return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

/** OKLab L component only — cheaper when we don't need chroma. */
function srgbByteLightness(r: number, g: number, b: number): number {
  const rL = srgbToLinear(r / 255);
  const gL = srgbToLinear(g / 255);
  const bL = srgbToLinear(b / 255);
  const l = 0.4122214708 * rL + 0.5363325363 * gL + 0.0514459929 * bL;
  const m = 0.2119034982 * rL + 0.6806995451 * gL + 0.1073969566 * bL;
  const s = 0.0883024619 * rL + 0.2817188376 * gL + 0.6299787005 * bL;
  return 0.2104542553 * Math.cbrt(l) + 0.7936177850 * Math.cbrt(m) - 0.0040720468 * Math.cbrt(s);
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
 * Repel `(fgR, fgG, fgB)` away from the reference lightness defined by
 * `(bgR, bgG, bgB)` + `biasPct/100`. At `strengthPct=0` this is the
 * identity; higher strength pushes harder. Hue/chroma are preserved.
 *
 * `strengthPct` is the user-facing 0..100 slider value.
 * `biasPct` is the user-facing -50..+50 slider value.
 *
 * Returns new `[r, g, b]` bytes in 0..255.
 */
export function pushFgLightness(
  fgR: number, fgG: number, fgB: number,
  bgR: number, bgG: number, bgB: number,
  strengthPct: number,
  biasPct: number,
): [number, number, number] {
  if (strengthPct <= 0) return [fgR, fgG, fgB];
  const k = (strengthPct / 100) * MAX_K;
  const bias = biasPct / 100;
  const [fgL, fa, fb] = srgbByteToOklab(fgR, fgG, fgB);
  const bgL = srgbByteLightness(bgR, bgG, bgB);
  const refL = Math.max(0, Math.min(1, bgL + bias));
  const d = fgL - refL;
  const push = k * d * Math.exp(-(d * d) / (SIGMA * SIGMA));
  const newL = Math.max(0, Math.min(1, fgL + push));
  return oklabToSrgbByte(newL, fa, fb);
}
