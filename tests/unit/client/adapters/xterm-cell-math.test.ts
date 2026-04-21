import { describe, it, expect } from 'bun:test';
import {
  effectiveBackgroundAttr,
  resolveAttrRgba,
  blendRgbaOverDefaultBackground,
  resolveCellBgRgb,
  blendFgTowardCellBg,
  withBlendedEffectiveBackground,
  XTERM_COLOR_MODE_P16,
  XTERM_COLOR_MODE_P256,
  XTERM_COLOR_MODE_RGB,
  XTERM_FG_FLAG_INVERSE,
  XTERM_RGB_MASK,
  type XtermCellTheme,
  type XtermCellState,
  type AnsiPalette,
} from '../../../../src/client/adapters/xterm-cell-math.ts';

const BLACK_RGBA = 0x000000ff;
const WHITE_RGBA = 0xffffffff;
const RED_RGBA   = 0xff0000ff;
const GREEN_RGBA = 0x00ff00ff;
const BLUE_RGBA  = 0x0000ffff;

const ansiPalette = (): AnsiPalette => {
  const a = new Array(256).fill(undefined);
  a[1] = { rgba: RED_RGBA };
  a[2] = { rgba: GREEN_RGBA };
  a[4] = { rgba: BLUE_RGBA };
  a[7] = { rgba: WHITE_RGBA };
  return a;
};

const theme = (overrides: Partial<XtermCellTheme> = {}): XtermCellTheme => ({
  bgDefaultRgba: BLACK_RGBA,
  fgDefaultRgba: WHITE_RGBA,
  ansi: ansiPalette(),
  ...overrides,
});

const idle = (overrides: Partial<XtermCellState> = {}): XtermCellState => ({
  tuiFgAlpha: 1,
  tuiBgAlpha: 1,
  fgContrastStrength: 0,
  fgContrastBias: 0,
  bgOklabL: 0,
  tuiSaturation: 0,
  ...overrides,
});

describe('effectiveBackgroundAttr', () => {
  it('returns bg when INVERSE is unset', () => {
    expect(effectiveBackgroundAttr(0, 0xabcdef)).toBe(0xabcdef);
  });

  it('returns fg when INVERSE is set', () => {
    expect(effectiveBackgroundAttr(XTERM_FG_FLAG_INVERSE | 0x12345, 0x6789a)).toBe(XTERM_FG_FLAG_INVERSE | 0x12345);
  });
});

describe('resolveAttrRgba', () => {
  it('RGB mode extracts low 24 bits + forces alpha=0xff', () => {
    const attr = XTERM_COLOR_MODE_RGB | 0x123456;
    expect(resolveAttrRgba(attr, 0, undefined)).toBe(0x123456ff);
  });

  it('P16 mode looks up the ansi palette', () => {
    expect(resolveAttrRgba(XTERM_COLOR_MODE_P16 | 1, BLACK_RGBA, ansiPalette()))
      .toBe(RED_RGBA);
  });

  it('P256 mode looks up the ansi palette', () => {
    expect(resolveAttrRgba(XTERM_COLOR_MODE_P256 | 4, BLACK_RGBA, ansiPalette()))
      .toBe(BLUE_RGBA);
  });

  it('falls back to defaultRgba when palette slot is undefined', () => {
    const sparse = new Array(256).fill(undefined) as AnsiPalette;
    expect(resolveAttrRgba(XTERM_COLOR_MODE_P256 | 42, WHITE_RGBA, sparse)).toBe(WHITE_RGBA);
  });

  it('falls back to defaultRgba when mode is DEFAULT', () => {
    expect(resolveAttrRgba(0, 0xdeadbeef, ansiPalette())).toBe(0xdeadbeef);
  });

  it('falls back to defaultRgba when ansi is undefined', () => {
    expect(resolveAttrRgba(XTERM_COLOR_MODE_P16 | 5, 0x1234ffff, undefined)).toBe(0x1234ffff);
  });
});

describe('blendRgbaOverDefaultBackground', () => {
  it('α=1 returns the foreground RGB bytes (alpha stripped)', () => {
    // Foreground: 0xff0000ff (red), base: 0x00000000 (black).
    // At α=1 output is (r=ff, g=00, b=00) → 0xff0000.
    expect(blendRgbaOverDefaultBackground(RED_RGBA, BLACK_RGBA, 1)).toBe(0xff0000);
  });

  it('α=0 returns the base RGB bytes', () => {
    expect(blendRgbaOverDefaultBackground(RED_RGBA, BLUE_RGBA, 0)).toBe(0x0000ff);
  });

  it('α=0.5 linearly mixes the two', () => {
    // 0xff0000 × 0.5 + 0x0000ff × 0.5 = (0x80, 0x00, 0x80) = 0x800080
    // (Math.round: 127.5 → 128)
    expect(blendRgbaOverDefaultBackground(RED_RGBA, BLUE_RGBA, 0.5)).toBe(0x800080);
  });
});

describe('resolveCellBgRgb', () => {
  it('default-bg non-inverse returns theme bg bytes', () => {
    const t = theme({ bgDefaultRgba: 0x112233ff });
    expect(resolveCellBgRgb(0, 0, t, 1)).toBe(0x112233);
  });

  it('P16 explicit bg blends through tuiBgAlpha', () => {
    const t = theme({ bgDefaultRgba: 0x000000ff });
    // P16 red at α=1 → 0xff0000
    expect(resolveCellBgRgb(0, XTERM_COLOR_MODE_P16 | 1, t, 1)).toBe(0xff0000);
    // At α=0 → theme bg = black
    expect(resolveCellBgRgb(0, XTERM_COLOR_MODE_P16 | 1, t, 0)).toBe(0x000000);
  });

  it('INVERSE: bg slot role is played by fg attribute', () => {
    const fgInv = XTERM_FG_FLAG_INVERSE | XTERM_COLOR_MODE_RGB | 0x123456;
    // The fg attr is a solid RGB; at α=1 it's fully visible.
    expect(resolveCellBgRgb(fgInv, 0, theme(), 1)).toBe(0x123456);
  });
});

describe('blendFgTowardCellBg', () => {
  it('α=1 returns the raw fg bytes (no bias/saturation)', () => {
    const t = theme();
    const fgAttr = XTERM_COLOR_MODE_RGB | 0x112233;
    expect(blendFgTowardCellBg(fgAttr, 0x445566, t.fgDefaultRgba, idle(), t.ansi))
      .toBe(0x112233);
  });

  it('α=0 collapses fg to cellBg', () => {
    const t = theme();
    const fgAttr = XTERM_COLOR_MODE_RGB | 0xff0000;
    expect(blendFgTowardCellBg(fgAttr, 0x00ff00, t.fgDefaultRgba, idle({ tuiFgAlpha: 0 }), t.ansi))
      .toBe(0x00ff00);
  });

  it('α=0.5 linearly mixes fg and cellBg', () => {
    const t = theme();
    const fgAttr = XTERM_COLOR_MODE_RGB | 0xff0000; // red
    // mix red × 0.5 + green × 0.5 = (128, 128, 0)
    expect(blendFgTowardCellBg(fgAttr, 0x00ff00, t.fgDefaultRgba, idle({ tuiFgAlpha: 0.5 }), t.ansi))
      .toBe(0x808000);
  });

  it('fgContrast=0 bias=0 is identity over pushLightness', () => {
    const t = theme();
    const fgAttr = XTERM_COLOR_MODE_RGB | 0x808080;
    expect(blendFgTowardCellBg(fgAttr, 0x808080, t.fgDefaultRgba,
      idle({ tuiFgAlpha: 1, fgContrastStrength: 0, fgContrastBias: 0 }), t.ansi))
      .toBe(0x808080);
  });

  it('bias=+100 forces fg to white regardless of strength', () => {
    const t = theme();
    const fgAttr = XTERM_COLOR_MODE_RGB | 0x404040;
    const out = blendFgTowardCellBg(fgAttr, 0x000000, t.fgDefaultRgba,
      idle({ fgContrastStrength: 50, fgContrastBias: 100, bgOklabL: 0 }), t.ansi);
    // Essentially white (rounding differences possible).
    const r = (out >> 16) & 0xff;
    const g = (out >>  8) & 0xff;
    const b =  out        & 0xff;
    expect(r).toBeGreaterThanOrEqual(253);
    expect(g).toBeGreaterThanOrEqual(253);
    expect(b).toBeGreaterThanOrEqual(253);
  });

  it('tuiSaturation=-100 fully desaturates both fg and bg before the mix', () => {
    const t = theme();
    const fgAttr = XTERM_COLOR_MODE_RGB | 0xff0000; // red
    const out = blendFgTowardCellBg(fgAttr, 0x00ff00, t.fgDefaultRgba,
      idle({ tuiSaturation: -100, tuiFgAlpha: 0.5 }), t.ansi);
    // With chroma collapsed, fg ≈ bg grey value; mixing grey+grey stays grey
    // so r≈g≈b.
    const r = (out >> 16) & 0xff;
    const g = (out >>  8) & 0xff;
    const b =  out        & 0xff;
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    expect(spread).toBeLessThanOrEqual(10);
  });
});

describe('withBlendedEffectiveBackground', () => {
  const fgAttr = (mode: number, v: number) => mode | v;
  const bgAttr = (mode: number, v: number) => mode | v;

  it('default-bg non-inverse at idle → identity (input fg/bg unchanged)', () => {
    const t = theme();
    const s = idle();
    const { fg, bg } = withBlendedEffectiveBackground(0, 0, t, s);
    expect(fg).toBe(0);
    expect(bg).toBe(0);
  });

  it('P16 explicit bg at α=1 writes blended RGB into the bg slot', () => {
    const t = theme({ bgDefaultRgba: BLACK_RGBA });
    const s = idle();
    const bgIn = XTERM_COLOR_MODE_P16 | 1; // red palette slot
    const { fg, bg } = withBlendedEffectiveBackground(0, bgIn, t, s);
    expect(fg).toBe(0); // fg untouched — at idle, no FG-transform path runs
    // bg's colour-mode should now be CM_RGB with red bytes in the low 24.
    expect((bg & 0x3000000) >>> 0).toBe(XTERM_COLOR_MODE_RGB);
    expect(bg & XTERM_RGB_MASK).toBe(0xff0000);
  });

  it('P16 explicit bg at α=0 collapses bg to theme bg', () => {
    const t = theme({ bgDefaultRgba: BLACK_RGBA });
    const s = idle({ tuiBgAlpha: 0 });
    const bgIn = XTERM_COLOR_MODE_P16 | 1;
    const { bg } = withBlendedEffectiveBackground(0, bgIn, t, s);
    expect(bg & XTERM_RGB_MASK).toBe(0x000000);
  });

  it('INVERSE: bg is written into the fg slot; bg slot left at its input', () => {
    const t = theme();
    const s = idle();
    const fgIn = XTERM_FG_FLAG_INVERSE | XTERM_COLOR_MODE_P16 | 1; // inverse + red
    const bgIn = 0;
    const { fg, bg } = withBlendedEffectiveBackground(fgIn, bgIn, t, s);
    // fg should now carry the blended red in CM_RGB form, with INVERSE
    // preserved.
    expect(fg & XTERM_FG_FLAG_INVERSE).toBeTruthy();
    expect(fg & XTERM_RGB_MASK).toBe(0xff0000);
    expect(bg).toBe(0);
  });

  it('tuiFgAlpha < 1 runs the FG-blend path even when bg is default', () => {
    const t = theme({ bgDefaultRgba: BLACK_RGBA, fgDefaultRgba: 0xff0000ff });
    const s = idle({ tuiFgAlpha: 0 });
    const { fg } = withBlendedEffectiveBackground(XTERM_COLOR_MODE_RGB | 0xff0000, 0, t, s);
    // At α=0 the fg collapses to the cell bg (theme bg = black).
    expect(fg & XTERM_RGB_MASK).toBe(0x000000);
  });

  it('attribute word preserves non-colour flags around the replacement', () => {
    const t = theme();
    const s = idle();
    // Set an arbitrary "extra" flag outside the colour-mode + RGB ranges
    // so we can verify it survives the mask rewrite.
    const EXTRA_FLAG = 0x8000000;
    const bgIn = EXTRA_FLAG | XTERM_COLOR_MODE_P16 | 1;
    const { bg } = withBlendedEffectiveBackground(0, bgIn, t, s);
    expect(bg & EXTRA_FLAG).toBe(EXTRA_FLAG);
  });

  it('contrast transform is applied to the blended explicit bg', () => {
    // Known bg + non-zero fgContrastStrength / Bias → the bg-pre-blend
    // path runs pushLightness on the blended colour. bias=+100 forces
    // OKLab L → 1; chroma is preserved through the transform (so a
    // saturated red at L=1 stays vaguely pink after gamut clipping
    // rather than becoming pure white). Test the OKLab L lifted
    // shape rather than exact bytes.
    const t = theme({ bgDefaultRgba: BLACK_RGBA });
    const s = idle({
      fgContrastStrength: 50,
      fgContrastBias: 100,
      bgOklabL: 0,
    });
    const bgIn = XTERM_COLOR_MODE_P16 | 1; // red
    const { bg } = withBlendedEffectiveBackground(0, bgIn, t, s);
    const r = (bg >> 16) & 0xff;
    const g = (bg >>  8) & 0xff;
    const b =  bg        & 0xff;
    // r always near 255 (same hue). g + b both lifted well above the
    // original red's zero, confirming the contrast path ran.
    expect(r).toBeGreaterThanOrEqual(240);
    expect(g).toBeGreaterThan(100);
    expect(b).toBeGreaterThan(100);
  });

  it('INVERSE + tuiFgAlpha < 1 collapses the bg slot toward cellBgRgb', () => {
    // Inverse cell: fg carries the "visible bg" colour (red), bg slot
    // is the original fg (default). At tuiFgAlpha=0 the glyph colour
    // (which rides the bg slot here) should collapse to the rect's
    // visible colour = red.
    const t = theme();
    const s = idle({ tuiFgAlpha: 0 });
    const fgIn = XTERM_FG_FLAG_INVERSE | XTERM_COLOR_MODE_RGB | 0xff0000;
    const bgIn = XTERM_COLOR_MODE_RGB | 0x112233;
    const { fg, bg } = withBlendedEffectiveBackground(fgIn, bgIn, t, s);
    // fg slot carries the blended bg — still red at α=0 for the rect.
    expect(fg & XTERM_RGB_MASK).toBe(0xff0000);
    // bg slot should have had its FG-collapse path run; colour-mode is RGB.
    expect((bg & 0x3000000) >>> 0).toBe(XTERM_COLOR_MODE_RGB);
    // At tuiFgAlpha=0 with idle saturation/contrast, the glyph bytes
    // equal cellBgRgb. For an INVERSE cell, cellBgRgb is the rect's
    // blended colour — red here.
    expect(bg & XTERM_RGB_MASK).toBe(0xff0000);
  });
});
