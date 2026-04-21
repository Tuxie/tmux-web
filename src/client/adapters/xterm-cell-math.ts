/**
 * Pure per-cell colour math lifted out of `src/client/adapters/xterm.ts`'s
 * `_patchWebglExplicitBackgroundOpacity` closure.
 *
 * The parent function runs on every rendered cell on every frame, so
 * everything in here is deliberately flat (no class, no shared mutable
 * state, no WebGL). That makes each piece unit-testable in isolation —
 * the adapter file itself is hard to cover because the xterm WebGL
 * renderer can't boot without a live `WebGL2RenderingContext` (see
 * `docs/ideas/webgl-mock-harness-for-xterm-adapter.md`). By moving the
 * math out here, the pieces that matter for visible colour output carry
 * their own tests without needing a WebGL stub; only the patcher
 * plumbing around them stays in `xterm.ts`.
 *
 * Attribute word layout (xterm's internal encoding, replicated because
 * xterm.js doesn't export these as a public constant):
 *
 *    bits 31..28   reserved
 *    bits 27..26   XTERM_FG_FLAG_INVERSE at 26; other fg flags above
 *    bits 25..24   colour-mode field (DEFAULT / P16 / P256 / RGB)
 *    bits 23..0    RGB or palette index depending on the mode
 */

export const XTERM_COLOR_MODE_MASK = 0x3000000;
export const XTERM_COLOR_MODE_P16  = 0x1000000;
export const XTERM_COLOR_MODE_P256 = 0x2000000;
export const XTERM_COLOR_MODE_RGB  = 0x3000000;
export const XTERM_FG_FLAG_INVERSE = 0x4000000;
export const XTERM_RGB_MASK        = 0xffffff;

/** The xterm theme palette is sparse: any index may be undefined if the
 *  theme didn't declare that ANSI slot. Matches the shape of
 *  `renderer._themeService.colors.ansi[i]` in xterm.js. */
export type AnsiPalette = ReadonlyArray<{ rgba: number } | undefined> | undefined;

/** Theme-level RGBA values the cell-math needs:
 *  - `bgDefaultRgba` / `fgDefaultRgba` are what xterm uses for cells
 *    that don't carry an explicit colour attribute (`CM_DEFAULT`).
 *  - `ansi` is the 16/256 palette lookup used when the attribute's
 *    colour-mode is P16 or P256. */
export interface XtermCellTheme {
  bgDefaultRgba: number;
  fgDefaultRgba: number;
  ansi: AnsiPalette;
}

/** Adapter-level settings that flow into the per-cell transforms. All
 *  already-clamped / already-normalised (no further range-checking
 *  happens inside the math). */
export interface XtermCellState {
  /** 0..1. 0 = glyph collapses to cell bg (invisible); 1 = untouched. */
  tuiFgAlpha: number;
  /** 0..1. Alpha used when pre-blending an explicit cell bg against
   *  theme.background so the rect and atlas meet on the same colour. */
  tuiBgAlpha: number;
  /** -100..+100. Contrast-push strength fed to `pushLightness`. */
  fgContrastStrength: number;
  /** -100..+100. Independent output-shift bias. */
  fgContrastBias: number;
  /** 0..1. OKLab L of the rendered background — cutoff for the
   *  contrast transform. */
  bgOklabL: number;
  /** -100..+100. Saturation scalar fed to `adjustSaturation`. */
  tuiSaturation: number;
}

import { pushLightness } from '../fg-contrast.js';
import { adjustSaturation } from '../tui-saturation.js';

/** xterm swaps fg/bg roles for the INVERSE flag — the "visible bg"
 *  of an inverse cell is its fg attribute. */
export function effectiveBackgroundAttr(fg: number, bg: number): number {
  return (fg & XTERM_FG_FLAG_INVERSE) ? fg : bg;
}

/** Decode an attribute word into an RGBA literal. Falls back to
 *  `defaultRgba` when the attribute's colour-mode is DEFAULT or the
 *  palette lookup misses (sparse `ansi[i] === undefined`). */
export function resolveAttrRgba(
  attr: number,
  defaultRgba: number,
  ansi: AnsiPalette,
): number {
  switch (attr & XTERM_COLOR_MODE_MASK) {
    case XTERM_COLOR_MODE_P16:
    case XTERM_COLOR_MODE_P256:
      return ansi?.[attr & 0xff]?.rgba ?? defaultRgba;
    case XTERM_COLOR_MODE_RGB:
      return ((attr & XTERM_RGB_MASK) << 8) | 0xff;
    default:
      return defaultRgba;
  }
}

/** Alpha-blend an RGBA foreground colour over an RGBA base (typically
 *  the theme's default background), returning a 24-bit RGB int. Used
 *  when the user's "TUI BG Opacity" slider fades explicit cell bgs
 *  toward the theme backdrop so the rect and atlas agree. */
export function blendRgbaOverDefaultBackground(
  rgba: number,
  baseRgba: number,
  tuiBgAlpha: number,
): number {
  const r = Math.round(((rgba >> 24) & 0xff) * tuiBgAlpha + ((baseRgba >> 24) & 0xff) * (1 - tuiBgAlpha));
  const g = Math.round(((rgba >> 16) & 0xff) * tuiBgAlpha + ((baseRgba >> 16) & 0xff) * (1 - tuiBgAlpha));
  const b = Math.round(((rgba >>  8) & 0xff) * tuiBgAlpha + ((baseRgba >>  8) & 0xff) * (1 - tuiBgAlpha));
  return (r << 16) | (g << 8) | b;
}

/** Resolve the 24-bit RGB bytes for what a cell's effective bg
 *  visually ends up at, after the TUI BG Opacity pre-blend:
 *
 *  - default-bg cells ⇒ the theme's default background (already
 *    composeTheme-blended with body elsewhere in the pipeline);
 *  - explicit-bg cells ⇒ `ansi × tuiBgAlpha + theme × (1 - tuiBgAlpha)`,
 *    which is the same colour the rect rasterises to. */
export function resolveCellBgRgb(
  fg: number,
  bg: number,
  theme: XtermCellTheme,
  tuiBgAlpha: number,
): number {
  const inverse = (fg & XTERM_FG_FLAG_INVERSE) !== 0;
  const effectiveBg = effectiveBackgroundAttr(fg, bg);
  const colorMode = effectiveBg & XTERM_COLOR_MODE_MASK;
  const known =
    colorMode === XTERM_COLOR_MODE_P16 ||
    colorMode === XTERM_COLOR_MODE_P256 ||
    colorMode === XTERM_COLOR_MODE_RGB;
  if (!known && !inverse) {
    return (theme.bgDefaultRgba >> 8) & 0xffffff;
  }
  const defaultRgba = inverse ? theme.fgDefaultRgba : theme.bgDefaultRgba;
  return blendRgbaOverDefaultBackground(
    resolveAttrRgba(effectiveBg, defaultRgba, theme.ansi),
    theme.bgDefaultRgba,
    tuiBgAlpha,
  );
}

/** Transform and blend the "visible fg" colour:
 *
 *    fg_transformed = pushLightness(fg, strength, bias, bgL)
 *    fg_saturated   = adjustSaturation(fg_transformed, pct)
 *    fg_final       = fg_saturated × α + cellBg_saturated × (1 - α)
 *
 *  Contrast runs first so the user's "push text away from bg"
 *  reshape happens before TUI FG Opacity fades it; the fg and cell-bg
 *  are both saturated before the alpha lerp so the glyph atlas and
 *  the rect meet on the same colour at any alpha. */
export function blendFgTowardCellBg(
  origFgAttr: number,
  cellBgRgb: number,
  fgDefaultRgba: number,
  state: XtermCellState,
  ansi: AnsiPalette,
): number {
  const α = state.tuiFgAlpha;
  const fgRgba = resolveAttrRgba(origFgAttr, fgDefaultRgba, ansi);
  let fgR = (fgRgba >> 24) & 0xff;
  let fgG = (fgRgba >> 16) & 0xff;
  let fgB = (fgRgba >>  8) & 0xff;
  let bgR = (cellBgRgb >> 16) & 0xff;
  let bgG = (cellBgRgb >>  8) & 0xff;
  let bgB =  cellBgRgb        & 0xff;
  if (state.fgContrastStrength !== 0 || state.fgContrastBias !== 0) {
    [fgR, fgG, fgB] = pushLightness(
      fgR, fgG, fgB,
      state.fgContrastStrength,
      state.fgContrastBias,
      state.bgOklabL,
    );
  }
  if (state.tuiSaturation !== 0) {
    [fgR, fgG, fgB] = adjustSaturation(fgR, fgG, fgB, state.tuiSaturation);
    [bgR, bgG, bgB] = adjustSaturation(bgR, bgG, bgB, state.tuiSaturation);
  }
  const r = Math.round(fgR * α + bgR * (1 - α));
  const g = Math.round(fgG * α + bgG * (1 - α));
  const b = Math.round(fgB * α + bgB * (1 - α));
  return (r << 16) | (g << 8) | b;
}

/** Compute the (fg, bg) attribute pair to hand to the atlas, applying
 *  both:
 *    - TUI BG Opacity: bg (or fg, when inverse) pre-blended against
 *      theme.background so the rect's alpha-faded colour matches the
 *      atlas's halo backdrop.
 *    - TUI FG Opacity: the glyph colour (fg non-inverse, bg inverse)
 *      pre-blended toward the cell's effective bg so at α=0 the glyph
 *      collapses to bg and at α=1 stays at its original fg.
 *
 *  Inverse cells use xterm's swapped role assignment — the fg
 *  attribute carries the visible bg colour. */
export function withBlendedEffectiveBackground(
  fg: number,
  bg: number,
  theme: XtermCellTheme,
  state: XtermCellState,
): { fg: number; bg: number } {
  const inverse = (fg & XTERM_FG_FLAG_INVERSE) !== 0;
  const effectiveBg = effectiveBackgroundAttr(fg, bg);
  const colorMode = effectiveBg & XTERM_COLOR_MODE_MASK;
  const known =
    colorMode === XTERM_COLOR_MODE_P16 ||
    colorMode === XTERM_COLOR_MODE_P256 ||
    colorMode === XTERM_COLOR_MODE_RGB;
  let outFg = fg;
  let outBg = bg;
  if (known || inverse) {
    let blendedBgRgb = blendRgbaOverDefaultBackground(
      resolveAttrRgba(effectiveBg, inverse ? theme.fgDefaultRgba : theme.bgDefaultRgba, theme.ansi),
      theme.bgDefaultRgba,
      state.tuiBgAlpha,
    );
    if (state.fgContrastStrength !== 0 || state.fgContrastBias !== 0) {
      let cR = (blendedBgRgb >> 16) & 0xff;
      let cG = (blendedBgRgb >>  8) & 0xff;
      let cB =  blendedBgRgb        & 0xff;
      [cR, cG, cB] = pushLightness(cR, cG, cB, state.fgContrastStrength, state.fgContrastBias, state.bgOklabL);
      blendedBgRgb = (cR << 16) | (cG << 8) | cB;
    }
    if (inverse) {
      outFg = (fg & ~(XTERM_RGB_MASK | XTERM_COLOR_MODE_MASK)) | XTERM_COLOR_MODE_RGB | blendedBgRgb;
    } else {
      outBg = (bg & ~(XTERM_RGB_MASK | XTERM_COLOR_MODE_MASK)) | XTERM_COLOR_MODE_RGB | blendedBgRgb;
    }
  }
  // FG pre-blend. Skip only when every transform is at identity.
  if (
    state.tuiFgAlpha < 1 ||
    state.fgContrastStrength !== 0 ||
    state.fgContrastBias !== 0 ||
    state.tuiSaturation !== 0
  ) {
    const cellBgRgb = resolveCellBgRgb(fg, bg, theme, state.tuiBgAlpha);
    if (inverse) {
      const blendedFgRgb = blendFgTowardCellBg(bg, cellBgRgb, theme.bgDefaultRgba, state, theme.ansi);
      outBg = (bg & ~(XTERM_RGB_MASK | XTERM_COLOR_MODE_MASK)) | XTERM_COLOR_MODE_RGB | blendedFgRgb;
    } else {
      const blendedFgRgb = blendFgTowardCellBg(fg, cellBgRgb, theme.fgDefaultRgba, state, theme.ansi);
      outFg = (fg & ~(XTERM_RGB_MASK | XTERM_COLOR_MODE_MASK)) | XTERM_COLOR_MODE_RGB | blendedFgRgb;
    }
  }
  return { fg: outFg, bg: outBg };
}
