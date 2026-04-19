/**
 * FG Contrast transform unit tests.
 *
 * Semantics (OKLab-L space):
 *
 *   strength ∈ [-100, +100]  (user-facing slider)
 *   bias     ∈ [0, 100]      (user-facing slider, 50 = middle-grey target)
 *
 *   strength = 0    → identity (bias ignored).
 *   strength < 0    → linear pull toward bias:
 *                     L' = L × (1+t) + B × (-t),  t = strength/100 (−ve)
 *                     At -100, every L collapses to B.
 *   strength > 0    → "gap" around bias; colours inside snap to the
 *                     nearest gap edge, outside the gap stay put.
 *                     Gap half-widths scale with bias's distance to
 *                     each extreme so at t=1 the gap covers [0,1]
 *                     regardless of B:
 *                       lower = B * (1 - t)
 *                       upper = B + t * (1 - B)
 *                     At t=1 this degenerates to a hard cutoff at B —
 *                     below B → 0, above B → 1 — matching the user's
 *                     "maximum or minimum brightness" description.
 *
 * Chroma/hue (OKLab a, b) are always preserved; only L moves.
 */

import { describe, test, expect } from 'bun:test';

describe('pushFgLightness', () => {
  test('strength=0 returns identity regardless of bias', async () => {
    const { pushFgLightness } = await import('../../../src/client/fg-contrast.js');
    expect(pushFgLightness(120, 130, 140, 0, 0)).toEqual([120, 130, 140]);
    expect(pushFgLightness(120, 130, 140, 0, 50)).toEqual([120, 130, 140]);
    expect(pushFgLightness(120, 130, 140, 0, 100)).toEqual([120, 130, 140]);
  });

  test('strength=-100 collapses every colour to the bias lightness', async () => {
    const { pushFgLightness } = await import('../../../src/client/fg-contrast.js');
    // With bias=50 we target OKLab L≈0.5. All three inputs — near-black,
    // mid-grey, near-white — should come out near the same byte.
    const [rDark] = pushFgLightness(30, 30, 30, -100, 50);
    const [rMid] = pushFgLightness(130, 130, 130, -100, 50);
    const [rBright] = pushFgLightness(220, 220, 220, -100, 50);
    // Outputs must agree within 2 bytes (Oklab round-trip rounding).
    expect(Math.abs(rDark - rMid)).toBeLessThanOrEqual(2);
    expect(Math.abs(rDark - rBright)).toBeLessThanOrEqual(2);
    // And they must actually move — not just sit at the input.
    expect(Math.abs(rDark - 30)).toBeGreaterThan(50);
    expect(Math.abs(rBright - 220)).toBeGreaterThan(50);
  });

  test('strength=-100 with bias=0 collapses to black', async () => {
    const { pushFgLightness } = await import('../../../src/client/fg-contrast.js');
    const [r, g, b] = pushFgLightness(200, 200, 200, -100, 0);
    expect(r).toBeLessThanOrEqual(2);
    expect(g).toBeLessThanOrEqual(2);
    expect(b).toBeLessThanOrEqual(2);
  });

  test('strength=-100 with bias=100 collapses to white', async () => {
    const { pushFgLightness } = await import('../../../src/client/fg-contrast.js');
    const [r, g, b] = pushFgLightness(30, 30, 30, -100, 100);
    expect(r).toBeGreaterThanOrEqual(253);
    expect(g).toBeGreaterThanOrEqual(253);
    expect(b).toBeGreaterThanOrEqual(253);
  });

  test('strength=+100 with bias=50 produces a hard black/white threshold', async () => {
    const { pushFgLightness } = await import('../../../src/client/fg-contrast.js');
    // A clearly-darker-than-50% grey → black.
    const [rDark] = pushFgLightness(80, 80, 80, 100, 50);
    expect(rDark).toBeLessThanOrEqual(2);
    // A clearly-brighter-than-50% grey → white.
    const [rBright] = pushFgLightness(200, 200, 200, 100, 50);
    expect(rBright).toBeGreaterThanOrEqual(253);
  });

  test('strength=+100 with non-centred bias still produces a binary cutoff at bias', async () => {
    const { pushFgLightness } = await import('../../../src/client/fg-contrast.js');
    // bias=25 (OKLab L ≈ 0.25). Any colour with L > 0.25 should go
    // white; anything with L < 0.25 should go black. A mid-grey at
    // L ≈ 0.5 is above bias → white.
    const [rMidGrey] = pushFgLightness(128, 128, 128, 100, 25);
    expect(rMidGrey).toBeGreaterThanOrEqual(253);
    // A deep shadow should fall below L=0.25 and go to black.
    const [rShadow] = pushFgLightness(20, 20, 20, 100, 25);
    expect(rShadow).toBeLessThanOrEqual(2);
  });

  test('strength=+50 with bias=50 introduces a 25%-each-side gap', async () => {
    const { pushFgLightness } = await import('../../../src/client/fg-contrast.js');
    // At t=0.5 the gap half-widths are B*(1-t)=0.25 below and
    // t*(1-B)=0.25 above — i.e. [0.25, 0.75] in OKLab L.
    //
    // An L just below 0.5 (inside the gap) must snap to 0.25 (OKLab).
    // An L just above 0.5 (inside the gap) must snap to 0.75 (OKLab).
    // An L well below 0.25 or well above 0.75 must stay put.
    //
    // Instead of asserting exact OKLab values we compare output vs
    // identity — colours inside the gap should move; colours far
    // outside should not.

    // Byte 80 → OKLab L ≈ 0.43 (inside gap below B) → should snap DARKER.
    const [rInsideBelow] = pushFgLightness(80, 80, 80, 50, 50);
    expect(rInsideBelow).toBeLessThan(80 - 5);

    // Byte 160 → OKLab L ≈ 0.69 (inside gap above B, bias 50) → snaps
    // to upper edge L=0.75 which is byte ≈ 174 — a clear brightening.
    const [rInsideAbove] = pushFgLightness(160, 160, 160, 50, 50);
    expect(rInsideAbove).toBeGreaterThan(160 + 5);

    // L≈0.17 (very dark): well below the gap's lower edge → stays.
    const [rFarBelow] = pushFgLightness(20, 20, 20, 50, 50);
    expect(Math.abs(rFarBelow - 20)).toBeLessThanOrEqual(2);

    // L≈0.95 (near-white): well above the gap's upper edge → stays.
    const [rFarAbove] = pushFgLightness(240, 240, 240, 50, 50);
    expect(Math.abs(rFarAbove - 240)).toBeLessThanOrEqual(2);
  });

  test('hue and chroma are preserved — only L changes', async () => {
    const { pushFgLightness } = await import('../../../src/client/fg-contrast.js');
    // A pinkish fg: r > g ≈ b.
    const [r, g, b] = pushFgLightness(180, 120, 120, 100, 50);
    // At strength=+100 / bias=50 this mid-pink has L > 0.5 → goes
    // "white" (or near-white) — but the red channel must still be ≥
    // the others so the hue bias is preserved.
    expect(r).toBeGreaterThanOrEqual(g);
    expect(r).toBeGreaterThanOrEqual(b);
  });
});
