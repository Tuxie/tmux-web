/**
 * TUI Saturation transform unit tests.
 *
 * Semantics (OKLab chroma space):
 *
 *   saturation ∈ [-100, +100]  (user-facing slider)
 *
 *   saturation = -100 → chroma = 0 (greyscale; any colour collapses to
 *                       a grey with the same OKLab lightness).
 *   saturation =    0 → identity.
 *   saturation = +100 → chroma × 2 (colours pushed toward their hue's
 *                       most saturated representable form, then
 *                       sRGB-clamped).
 *
 * OKLab-L (lightness) is always preserved; only a, b (chroma) scale.
 * Greys (where input already has a=b≈0) are fixed points of this map
 * at any saturation — scaling zero by anything is still zero.
 *
 * Applied to every FG and BG colour the terminal renders (see
 * `src/client/adapters/xterm.ts`). The BG rect path runs this after
 * the user's BG Opacity premultiply, and the FG path runs it after
 * `pushFgLightness` (so Contrast and Saturation compose).
 */

import { describe, test, expect } from 'bun:test';

describe('adjustSaturation', () => {
  test('saturation=0 returns identity', async () => {
    const { adjustSaturation } = await import('../../../src/client/tui-saturation.js');
    expect(adjustSaturation(180, 50, 50, 0)).toEqual([180, 50, 50]);
    expect(adjustSaturation(0, 0, 0, 0)).toEqual([0, 0, 0]);
    expect(adjustSaturation(200, 200, 200, 0)).toEqual([200, 200, 200]);
  });

  test('grey inputs are unchanged at every saturation', async () => {
    const { adjustSaturation } = await import('../../../src/client/tui-saturation.js');
    // Pure grey has OKLab a=b≈0; scaling 0 by anything leaves the
    // colour exactly where it started. Round-trip rounding may shift
    // each byte by ±1, so tolerate that.
    for (const pct of [-100, -50, 0, 50, 100]) {
      const [r, g, b] = adjustSaturation(128, 128, 128, pct);
      expect(Math.abs(r - 128)).toBeLessThanOrEqual(1);
      expect(Math.abs(g - 128)).toBeLessThanOrEqual(1);
      expect(Math.abs(b - 128)).toBeLessThanOrEqual(1);
    }
  });

  test('saturation=-100 collapses a red to a grey', async () => {
    const { adjustSaturation } = await import('../../../src/client/tui-saturation.js');
    const [r, g, b] = adjustSaturation(220, 40, 40, -100);
    // Greyscale: R == G == B within rounding noise.
    expect(Math.abs(r - g)).toBeLessThanOrEqual(2);
    expect(Math.abs(g - b)).toBeLessThanOrEqual(2);
    expect(Math.abs(r - b)).toBeLessThanOrEqual(2);
    // And the brightness should sit somewhere between the R and (G,B)
    // bytes — not collapse to black or white.
    expect(r).toBeGreaterThan(30);
    expect(r).toBeLessThan(220);
  });

  test('saturation=-100 collapses a blue to a grey', async () => {
    const { adjustSaturation } = await import('../../../src/client/tui-saturation.js');
    const [r, g, b] = adjustSaturation(40, 60, 220, -100);
    expect(Math.abs(r - g)).toBeLessThanOrEqual(2);
    expect(Math.abs(g - b)).toBeLessThanOrEqual(2);
    expect(Math.abs(r - b)).toBeLessThanOrEqual(2);
  });

  test('saturation=-100 preserves OKLab lightness of the input', async () => {
    const { adjustSaturation } = await import('../../../src/client/tui-saturation.js');
    // A mid-bright red: byte ~(180, 80, 80). Its greyscale counterpart
    // should land in the same rough brightness ballpark — definitely
    // not 0 or 255.
    const [r] = adjustSaturation(180, 80, 80, -100);
    expect(r).toBeGreaterThan(60);
    expect(r).toBeLessThan(200);
  });

  test('saturation=+100 boosts chroma without changing hue direction', async () => {
    const { adjustSaturation } = await import('../../../src/client/tui-saturation.js');
    // A muted pinkish red. Boosting chroma by ×2 should push R
    // *further* away from G, B — not reverse the hue.
    const [r, g, b] = adjustSaturation(160, 110, 110, 100);
    const dIn = 160 - 110;        // 50
    const dOutG = r - g;
    const dOutB = r - b;
    // Hue direction preserved.
    expect(dOutG).toBeGreaterThan(0);
    expect(dOutB).toBeGreaterThan(0);
    // And the R-vs-(G,B) gap must widen (more saturated).
    expect(dOutG).toBeGreaterThan(dIn);
    expect(dOutB).toBeGreaterThan(dIn);
  });

  test('clamps out-of-range saturation inputs', async () => {
    const { adjustSaturation } = await import('../../../src/client/tui-saturation.js');
    // +200 is clamped to +100; compare to the known +100 result.
    const [r100, g100, b100] = adjustSaturation(160, 110, 110, 100);
    const [r200, g200, b200] = adjustSaturation(160, 110, 110, 200);
    expect(Math.abs(r100 - r200)).toBeLessThanOrEqual(1);
    expect(Math.abs(g100 - g200)).toBeLessThanOrEqual(1);
    expect(Math.abs(b100 - b200)).toBeLessThanOrEqual(1);
    // -200 is clamped to -100.
    const [rN100, gN100, bN100] = adjustSaturation(220, 40, 40, -100);
    const [rN200, gN200, bN200] = adjustSaturation(220, 40, 40, -200);
    expect(Math.abs(rN100 - rN200)).toBeLessThanOrEqual(1);
    expect(Math.abs(gN100 - gN200)).toBeLessThanOrEqual(1);
    expect(Math.abs(bN100 - bN200)).toBeLessThanOrEqual(1);
  });
});

describe('clampTuiSaturation', () => {
  test('clamps to [-100, +100] and rounds fractional values', async () => {
    const { clampTuiSaturation, DEFAULT_TUI_SATURATION } = await import('../../../src/client/tui-saturation.js');
    expect(DEFAULT_TUI_SATURATION).toBe(0);
    expect(clampTuiSaturation(0)).toBe(0);
    expect(clampTuiSaturation(100)).toBe(100);
    expect(clampTuiSaturation(-100)).toBe(-100);
    expect(clampTuiSaturation(150)).toBe(100);
    expect(clampTuiSaturation(-150)).toBe(-100);
    expect(clampTuiSaturation(12.4)).toBe(12);
    expect(clampTuiSaturation(12.6)).toBe(13);
    expect(clampTuiSaturation(Number.NaN)).toBe(0);
  });
});
