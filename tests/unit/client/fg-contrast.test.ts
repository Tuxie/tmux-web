/**
 * Contrast transform unit tests.
 *
 * New semantics (OKLab-L space):
 *
 *   strength ∈ [-100, +100]  (slider)
 *   bias     ∈ [-100, +100]  (slider, 0 = use background luminance)
 *   bgL      ∈ [0, 1]        (auto-computed OKLab L of rendered background)
 *
 *   Bias direction: positive = "towards brighter", negative = "towards darker".
 *   Internally the sign is negated to compute the cutoff:
 *     b = -biasPct/100
 *     cutoff = b >= 0
 *       ? bgL + b × (1 - bgL)
 *       : bgL + b × bgL
 *   So bias +100 → cutoff = 0 (everything pushed bright),
 *      bias -100 → cutoff = 1 (everything pushed dark).
 *
 *   strength = 0    → identity (bias + bgL ignored)
 *   strength < 0    → linear pull toward cutoff
 *   strength > 0    → exclusion gap around cutoff; colours inside snap
 *                     to nearest edge, outside stay put
 *
 * Applies to both FG and explicit cell BG colours.
 * Chroma/hue (OKLab a, b) always preserved; only L moves.
 */

import { describe, test, expect } from 'bun:test';

describe('pushLightness', () => {
  test('strength=0 returns identity regardless of bias and bgL', async () => {
    const { pushLightness } = await import('../../../src/client/fg-contrast.js');
    expect(pushLightness(120, 130, 140, 0, 0, 0.5)).toEqual([120, 130, 140]);
    expect(pushLightness(120, 130, 140, 0, -100, 0.2)).toEqual([120, 130, 140]);
    expect(pushLightness(120, 130, 140, 0, 100, 0.8)).toEqual([120, 130, 140]);
  });

  test('strength=-100, bias=0 collapses all colours to bgL', async () => {
    const { pushLightness } = await import('../../../src/client/fg-contrast.js');
    const bgL = 0.5;
    const [rDark]   = pushLightness(30,  30,  30,  -100, 0, bgL);
    const [rMid]    = pushLightness(130, 130, 130, -100, 0, bgL);
    const [rBright] = pushLightness(220, 220, 220, -100, 0, bgL);
    expect(Math.abs(rDark - rMid)).toBeLessThanOrEqual(2);
    expect(Math.abs(rDark - rBright)).toBeLessThanOrEqual(2);
    expect(Math.abs(rDark - 30)).toBeGreaterThan(50);
    expect(Math.abs(rBright - 220)).toBeGreaterThan(50);
  });

  test('strength=-100, bias=+100 collapses to black (cutoff=0, "towards brighter")', async () => {
    const { pushLightness } = await import('../../../src/client/fg-contrast.js');
    const [r, g, b] = pushLightness(200, 200, 200, -100, 100, 0.5);
    expect(r).toBeLessThanOrEqual(2);
    expect(g).toBeLessThanOrEqual(2);
    expect(b).toBeLessThanOrEqual(2);
  });

  test('strength=-100, bias=-100 collapses to white (cutoff=1, "towards darker")', async () => {
    const { pushLightness } = await import('../../../src/client/fg-contrast.js');
    const [r, g, b] = pushLightness(30, 30, 30, -100, -100, 0.5);
    expect(r).toBeGreaterThanOrEqual(253);
    expect(g).toBeGreaterThanOrEqual(253);
    expect(b).toBeGreaterThanOrEqual(253);
  });

  test('strength=+100, bias=0 produces hard cutoff at bgL', async () => {
    const { pushLightness } = await import('../../../src/client/fg-contrast.js');
    const bgL = 0.5;
    // Byte 80 → L ≈ 0.43, below bgL → black
    const [rDark] = pushLightness(80, 80, 80, 100, 0, bgL);
    expect(rDark).toBeLessThanOrEqual(2);
    // Byte 200 → L ≈ 0.82, above bgL → white
    const [rBright] = pushLightness(200, 200, 200, 100, 0, bgL);
    expect(rBright).toBeGreaterThanOrEqual(253);
  });

  test('strength=+100 with non-centred bgL still produces binary cutoff', async () => {
    const { pushLightness } = await import('../../../src/client/fg-contrast.js');
    // bgL=0.25, bias=0 → cutoff=0.25
    const [rMidGrey] = pushLightness(128, 128, 128, 100, 0, 0.25);
    expect(rMidGrey).toBeGreaterThanOrEqual(253);
    const [rShadow] = pushLightness(20, 20, 20, 100, 0, 0.25);
    expect(rShadow).toBeLessThanOrEqual(2);
  });

  test('bias ±50 lands halfway between bgL and extreme (sign reversed)', async () => {
    const { pushLightness } = await import('../../../src/client/fg-contrast.js');
    const bgL = 0.3;

    // bias=-50 ("towards darker") → cutoff = 0.3 + 0.5*(1-0.3) = 0.65
    // Byte 200 → L ≈ 0.82, above 0.65 → white
    const [rAbove] = pushLightness(200, 200, 200, 100, -50, bgL);
    expect(rAbove).toBeGreaterThanOrEqual(253);
    // Byte 128 → L ≈ 0.57, below 0.65 → black
    const [rBelow] = pushLightness(128, 128, 128, 100, -50, bgL);
    expect(rBelow).toBeLessThanOrEqual(2);

    // bias=+50 ("towards brighter") → cutoff = 0.3 + (-0.5)*0.3 = 0.15
    // Byte 30 → L ≈ 0.24, above 0.15 → white
    const [rAboveLow] = pushLightness(30, 30, 30, 100, 50, bgL);
    expect(rAboveLow).toBeGreaterThanOrEqual(253);
    // Byte 5 → L ≈ 0.12, below 0.15 → black
    const [rBelowLow] = pushLightness(5, 5, 5, 100, 50, bgL);
    expect(rBelowLow).toBeLessThanOrEqual(2);
  });

  test('positive strength NEVER pushes colours closer to cutoff', async () => {
    const { pushLightness, rgbToOklabL } = await import('../../../src/client/fg-contrast.js');
    const bgL = 0.4;
    const strengthPct = 30;
    const biasPct = 0;
    const cutoff = bgL; // bias=0 → cutoff = bgL

    for (let byte = 0; byte <= 255; byte += 5) {
      const origL = rgbToOklabL(byte, byte, byte);
      const [rOut, gOut, bOut] = pushLightness(byte, byte, byte, strengthPct, biasPct, bgL);
      const newL = rgbToOklabL(rOut, gOut, bOut);
      const origDist = Math.abs(origL - cutoff);
      const newDist = Math.abs(newL - cutoff);
      expect(newDist).toBeGreaterThanOrEqual(origDist - 0.02);
    }
  });

  test('positive strength creates exclusion zone — no output L inside gap', async () => {
    const { pushLightness, rgbToOklabL } = await import('../../../src/client/fg-contrast.js');
    const bgL = 0.5;
    const strengthPct = 50;
    const biasPct = 0;
    // cutoff=0.5, t=0.5
    // lower = 0.5 * (1-0.5) = 0.25, upper = 0.5 + 0.5*0.5 = 0.75
    const lower = 0.25;
    const upper = 0.75;

    for (let byte = 0; byte <= 255; byte += 3) {
      const [rOut, gOut, bOut] = pushLightness(byte, byte, byte, strengthPct, biasPct, bgL);
      const newL = rgbToOklabL(rOut, gOut, bOut);
      const insideGap = newL > lower + 0.01 && newL < upper - 0.01;
      if (insideGap) {
        throw new Error(
          `Byte ${byte} → newL=${newL.toFixed(3)} inside gap [${lower}, ${upper}]. ` +
          `Contrast should exclude colours from this zone.`
        );
      }
    }
  });

  test('colours outside gap stay untouched', async () => {
    const { pushLightness } = await import('../../../src/client/fg-contrast.js');
    const bgL = 0.5;
    // strength=50, bias=0 → gap [0.25, 0.75]
    // Byte 20 → L≈0.17, well below gap → unchanged
    const [rBelow] = pushLightness(20, 20, 20, 50, 0, bgL);
    expect(Math.abs(rBelow - 20)).toBeLessThanOrEqual(2);
    // Byte 240 → L≈0.95, well above gap → unchanged
    const [rAbove] = pushLightness(240, 240, 240, 50, 0, bgL);
    expect(Math.abs(rAbove - 240)).toBeLessThanOrEqual(2);
  });

  test('hue and chroma preserved — only L changes', async () => {
    const { pushLightness } = await import('../../../src/client/fg-contrast.js');
    // Pinkish fg: r > g ≈ b. At +100/bias=0/bgL=0.5, L>0.5 → near-white
    // but red channel should still dominate.
    const [r, g, b] = pushLightness(180, 120, 120, 100, 0, 0.5);
    expect(r).toBeGreaterThanOrEqual(g);
    expect(r).toBeGreaterThanOrEqual(b);
  });
});

describe('rgbToOklabL', () => {
  test('black → 0, white → 1', async () => {
    const { rgbToOklabL } = await import('../../../src/client/fg-contrast.js');
    expect(rgbToOklabL(0, 0, 0)).toBeCloseTo(0, 2);
    expect(rgbToOklabL(255, 255, 255)).toBeCloseTo(1, 2);
  });

  test('mid grey → L in [0.4, 0.65]', async () => {
    const { rgbToOklabL } = await import('../../../src/client/fg-contrast.js');
    const L = rgbToOklabL(128, 128, 128);
    expect(L).toBeGreaterThan(0.4);
    expect(L).toBeLessThan(0.65);
  });
});

describe('clampFgContrastBias', () => {
  test('range is -100..+100 with default 0', async () => {
    const { clampFgContrastBias, DEFAULT_FG_CONTRAST_BIAS } =
      await import('../../../src/client/fg-contrast.js');
    expect(DEFAULT_FG_CONTRAST_BIAS).toBe(0);
    expect(clampFgContrastBias(-150)).toBe(-100);
    expect(clampFgContrastBias(150)).toBe(100);
    expect(clampFgContrastBias(NaN)).toBe(0);
    expect(clampFgContrastBias(50)).toBe(50);
    expect(clampFgContrastBias(-50)).toBe(-50);
  });
});
