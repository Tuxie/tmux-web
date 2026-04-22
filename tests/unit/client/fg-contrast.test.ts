/**
 * Contrast transform unit tests.
 *
 * Semantics (OKLab-L space):
 *
 *   strength ∈ [-100, +100]  (slider)
 *   bias     ∈ [-100, +100]  (slider, independent output shift)
 *   bgL      ∈ [0, 1]        (auto-computed OKLab L of rendered background)
 *
 *   Strength controls gap/pull with cutoff always at bgL:
 *     strength > 0 → exclusion gap around bgL
 *     strength < 0 → linear pull toward bgL
 *     strength = 0 → identity (no gap/pull)
 *
 *   Bias shifts the output independently:
 *     bias > 0 → shift toward white: L' = L + (bias/100)×(1-L)
 *     bias < 0 → shift toward black: L' = L + (bias/100)×L
 *     bias +100 → always white, bias -100 → always black
 *     bias 0 → no shift
 *
 *   Both strength and bias compose: gap/pull runs first, then bias shifts.
 *   Bias works even at strength=0.
 *
 * Applies to both FG and explicit cell BG colours.
 * Chroma/hue (OKLab a, b) always preserved; only L moves.
 */

import { describe, test, expect } from 'bun:test';

describe('pushLightness', () => {
  test('strength=0 bias=0 returns identity', async () => {
    const { pushLightness } = await import('../../../src/client/fg-contrast.js');
    expect(pushLightness(120, 130, 140, 0, 0, 0.5)).toEqual([120, 130, 140]);
    expect(pushLightness(120, 130, 140, 0, 0, 0.2)).toEqual([120, 130, 140]);
  });

  // --- Bias as independent output shift ---

  test('bias=+100 always produces white regardless of strength', async () => {
    const { pushLightness } = await import('../../../src/client/fg-contrast.js');
    for (const str of [-100, -50, 0, 50, 100]) {
      const [r, g, b] = pushLightness(80, 80, 80, str, 100, 0.5);
      expect(r).toBeGreaterThanOrEqual(253);
      expect(g).toBeGreaterThanOrEqual(253);
      expect(b).toBeGreaterThanOrEqual(253);
    }
  });

  test('bias=-100 always produces black regardless of strength', async () => {
    const { pushLightness } = await import('../../../src/client/fg-contrast.js');
    for (const str of [-100, -50, 0, 50, 100]) {
      const [r, g, b] = pushLightness(200, 200, 200, str, -100, 0.5);
      expect(r).toBeLessThanOrEqual(2);
      expect(g).toBeLessThanOrEqual(2);
      expect(b).toBeLessThanOrEqual(2);
    }
  });

  test('bias=+50 shifts output halfway to white', async () => {
    const { pushLightness, rgbToOklabL } = await import('../../../src/client/fg-contrast.js');
    // At strength=0 (identity), input L goes through bias shift only:
    // finalL = L + 0.5*(1-L) = 0.5 + 0.5*L
    const origL = rgbToOklabL(80, 80, 80);
    const expectedL = 0.5 + 0.5 * origL;
    const [rOut] = pushLightness(80, 80, 80, 0, 50, 0.5);
    const outL = rgbToOklabL(rOut, rOut, rOut);
    expect(Math.abs(outL - expectedL)).toBeLessThan(0.03);
  });

  test('bias=-50 shifts output halfway to black', async () => {
    const { pushLightness, rgbToOklabL } = await import('../../../src/client/fg-contrast.js');
    const origL = rgbToOklabL(200, 200, 200);
    const expectedL = origL + (-0.5) * origL; // = 0.5 * origL
    const [rOut] = pushLightness(200, 200, 200, 0, -50, 0.5);
    const outL = rgbToOklabL(rOut, rOut, rOut);
    expect(Math.abs(outL - expectedL)).toBeLessThan(0.03);
  });

  test('bias works even at strength=0', async () => {
    const { pushLightness } = await import('../../../src/client/fg-contrast.js');
    // Non-zero bias at strength=0 should still shift output
    const [rBright] = pushLightness(128, 128, 128, 0, 50, 0.5);
    expect(rBright).toBeGreaterThan(128 + 20);
    const [rDark] = pushLightness(128, 128, 128, 0, -50, 0.5);
    expect(rDark).toBeLessThan(128 - 20);
  });

  // --- Strength: gap mode ---

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

  // Regression: at strength=-100 toward a dark bgL, every hue should
  // land at the same perceptual L (the requested bgL). Before the
  // gamut-mapping fix in oklab.ts, per-channel sRGB clipping turned
  // high-chroma hues (notably red) much darker than low-chroma hues
  // (yellow, cyan, blue) at the same requested L — the user saw red
  // fade harder than everything else at Contrast=-100.
  test('strength=-100 lands every hue at the same output OKLab L (gamut-mapped)', async () => {
    const { pushLightness, rgbToOklabL } = await import('../../../src/client/fg-contrast.js');
    const bgL = 0.18;
    const swatches: Array<[string, [number, number, number]]> = [
      ['red',     [255, 85, 85]],
      ['yellow',  [241, 250, 140]],
      ['cyan',    [139, 233, 253]],
      ['blue',    [98, 114, 164]],
      ['white',   [248, 248, 242]],
    ];
    const outLs = swatches.map(([, rgb]) => {
      const [r, g, b] = pushLightness(rgb[0]!, rgb[1]!, rgb[2]!, -100, 0, bgL);
      return rgbToOklabL(r, g, b);
    });
    for (const L of outLs) {
      expect(Math.abs(L - bgL)).toBeLessThan(0.03);
    }
    const spread = Math.max(...outLs) - Math.min(...outLs);
    expect(spread).toBeLessThan(0.04);
  });

  test('strength=+100, bias=0 produces hard cutoff at bgL', async () => {
    const { pushLightness } = await import('../../../src/client/fg-contrast.js');
    const bgL = 0.5;
    const [rDark] = pushLightness(80, 80, 80, 100, 0, bgL);
    expect(rDark).toBeLessThanOrEqual(2);
    const [rBright] = pushLightness(200, 200, 200, 100, 0, bgL);
    expect(rBright).toBeGreaterThanOrEqual(253);
  });

  test('strength=+100 with non-centred bgL still produces binary cutoff', async () => {
    const { pushLightness } = await import('../../../src/client/fg-contrast.js');
    const [rMidGrey] = pushLightness(128, 128, 128, 100, 0, 0.25);
    expect(rMidGrey).toBeGreaterThanOrEqual(253);
    const [rShadow] = pushLightness(20, 20, 20, 100, 0, 0.25);
    expect(rShadow).toBeLessThanOrEqual(2);
  });

  test('positive strength NEVER pushes colours closer to bgL (at bias=0)', async () => {
    const { pushLightness, rgbToOklabL } = await import('../../../src/client/fg-contrast.js');
    const bgL = 0.4;
    for (let byte = 0; byte <= 255; byte += 5) {
      const origL = rgbToOklabL(byte, byte, byte);
      const [rOut, gOut, bOut] = pushLightness(byte, byte, byte, 30, 0, bgL);
      const newL = rgbToOklabL(rOut, gOut, bOut);
      const origDist = Math.abs(origL - bgL);
      const newDist = Math.abs(newL - bgL);
      expect(newDist).toBeGreaterThanOrEqual(origDist - 0.02);
    }
  });

  test('positive strength creates exclusion zone — no output L inside gap (bias=0)', async () => {
    const { pushLightness, rgbToOklabL } = await import('../../../src/client/fg-contrast.js');
    const bgL = 0.5;
    // cutoff=0.5, t=0.5 → lower=0.25, upper=0.75
    for (let byte = 0; byte <= 255; byte += 3) {
      const [rOut, gOut, bOut] = pushLightness(byte, byte, byte, 50, 0, bgL);
      const newL = rgbToOklabL(rOut, gOut, bOut);
      const insideGap = newL > 0.26 && newL < 0.74;
      if (insideGap) {
        throw new Error(
          `Byte ${byte} → newL=${newL.toFixed(3)} inside gap [0.25, 0.75].`
        );
      }
    }
  });

  test('colours outside gap stay untouched (bias=0)', async () => {
    const { pushLightness } = await import('../../../src/client/fg-contrast.js');
    const bgL = 0.5;
    const [rBelow] = pushLightness(20, 20, 20, 50, 0, bgL);
    expect(Math.abs(rBelow - 20)).toBeLessThanOrEqual(2);
    const [rAbove] = pushLightness(240, 240, 240, 50, 0, bgL);
    expect(Math.abs(rAbove - 240)).toBeLessThanOrEqual(2);
  });

  // --- Composition ---

  test('strength + bias compose: gap then shift', async () => {
    const { pushLightness } = await import('../../../src/client/fg-contrast.js');
    // strength=+100 bias=0 at bgL=0.5: byte 80 (L<0.5) → black
    const [rNoShift] = pushLightness(80, 80, 80, 100, 0, 0.5);
    expect(rNoShift).toBeLessThanOrEqual(2);
    // Same but bias=+50: gap snaps to L=0, then shift: 0+0.5*(1-0)=0.5 → byte≈99
    const [rShifted] = pushLightness(80, 80, 80, 100, 50, 0.5);
    expect(rShifted).toBeGreaterThan(80);
    expect(rShifted).toBeLessThan(130);
  });

  test('hue and chroma preserved — only L changes', async () => {
    const { pushLightness } = await import('../../../src/client/fg-contrast.js');
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

describe('clampFgContrastStrength', () => {
  test('range is -100..+100 with default 0', async () => {
    const { clampFgContrastStrength, DEFAULT_FG_CONTRAST_STRENGTH } =
      await import('../../../src/client/fg-contrast.js');
    expect(DEFAULT_FG_CONTRAST_STRENGTH).toBe(0);
    expect(clampFgContrastStrength(-150)).toBe(-100);
    expect(clampFgContrastStrength(150)).toBe(100);
    expect(clampFgContrastStrength(NaN)).toBe(0);
    expect(clampFgContrastStrength(Infinity)).toBe(0);
    expect(clampFgContrastStrength(42.6)).toBe(43);
    expect(clampFgContrastStrength(-42.6)).toBe(-43);
  });
});
