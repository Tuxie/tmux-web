/**
 * sRGB ↔ OKLab colour-space helpers.
 *
 * Shared by `fg-contrast.ts` (contrast/bias transform in L) and
 * `tui-saturation.ts` (chroma scale in a/b). Both transforms run on
 * every rendered cell via `src/client/adapters/xterm.ts`; keeping the
 * math in one module avoids drift when one of the constants is tuned.
 */

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(c: number): number {
  const x = Math.max(0, Math.min(1, c));
  return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

export function srgbByteToOklab(r: number, g: number, b: number): [number, number, number] {
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

/** Convert OKLab → linear RGB, no clipping. Returned values can fall
 *  outside [0, 1] when the OKLab point is outside the sRGB gamut —
 *  that's what `oklabToSrgbByte` uses to detect the out-of-gamut case
 *  so it can gamut-map by chroma reduction instead of per-channel
 *  clipping (which would distort hue-preservation asymmetrically). */
function oklabToLinearRgb(L: number, a: number, b: number): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const lin = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return [
    4.0767416621 * lin - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * lin + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * lin - 0.7034186147 * m + 1.7076147010 * s,
  ];
}

/** Tolerance for "close enough to in-gamut" — `linearToSrgb` still
 *  clamps to [0, 1] at the end, so tiny overshoots from the cubic math
 *  shouldn't force the binary search to chase them. */
const GAMUT_EPS = 1e-6;

function inLinearRgbGamut(r: number, g: number, b: number): boolean {
  return (
    r >= -GAMUT_EPS && r <= 1 + GAMUT_EPS &&
    g >= -GAMUT_EPS && g <= 1 + GAMUT_EPS &&
    b >= -GAMUT_EPS && b <= 1 + GAMUT_EPS
  );
}

export function oklabToSrgbByte(L: number, a: number, b: number): [number, number, number] {
  // Fast path: direct OKLab point is already in sRGB gamut.
  let [rL, gL, bL] = oklabToLinearRgb(L, a, b);
  if (!inLinearRgbGamut(rL, gL, bL)) {
    // Out of gamut. Per-channel clipping (the pre-fix behaviour) would
    // distort hue asymmetrically — e.g. pure red at a dark L clips
    // rL>1 / gL<0 / bL<0 independently, leaving a muddy dark-red that
    // reads much dimmer than other hues at the same requested L.
    // Instead: preserve L + hue direction, binary-search for the
    // largest chroma scale c ∈ [0, 1] such that (L, c·a, c·b) is in
    // gamut. At extreme pulls (e.g. strength = -100 forcing every hue
    // to bgL) high-chroma colours collapse toward a neutral at that
    // same L, which matches the OKLab model's perceptual equality.
    //
    // L itself may be outside [0, 1] (strength -100 with bgL clamped
    // to ≤0 or ≥1); at the extremes no chroma can help, so pin to
    // the corresponding neutral.
    if (L <= 0) { rL = 0; gL = 0; bL = 0; }
    else if (L >= 1) { rL = 1; gL = 1; bL = 1; }
    else {
      let lo = 0;
      let hi = 1;
      // 16 iterations → chroma scale accurate to ~1.5e-5, well below
      // the 1/255 byte-quantisation floor.
      for (let i = 0; i < 16; i++) {
        const mid = (lo + hi) / 2;
        const [r2, g2, b2] = oklabToLinearRgb(L, a * mid, b * mid);
        if (inLinearRgbGamut(r2, g2, b2)) lo = mid;
        else hi = mid;
      }
      [rL, gL, bL] = oklabToLinearRgb(L, a * lo, b * lo);
    }
  }
  return [
    Math.round(linearToSrgb(rL) * 255),
    Math.round(linearToSrgb(gL) * 255),
    Math.round(linearToSrgb(bL) * 255),
  ];
}

export function rgbToOklabL(r: number, g: number, b: number): number {
  return srgbByteToOklab(r, g, b)[0];
}
