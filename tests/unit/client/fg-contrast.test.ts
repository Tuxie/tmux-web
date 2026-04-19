/**
 * FG Contrast transform unit tests
 * =================================
 *
 * `pushFgLightness` applies a per-pixel OKLab-lightness repulsion
 * around a reference L (the cell bg's lightness, optionally shifted by
 * the "bias" slider). At strength=0 the function is identity; higher
 * strength pushes L away from the reference, keeping chroma/hue.
 *
 * The curve:
 *   d = fgL - (bgL + bias)
 *   push = k × d × exp(-d² / σ²)
 *   fgL' = clamp(fgL + push, 0, 1)
 *
 * k is derived from the user-facing 0..100 strength; bias is in
 * [-50, +50] and shifts the repulsion's midpoint.
 */

import { describe, test, expect } from 'bun:test';

describe('pushFgLightness', () => {
  test('strength=0 returns identity regardless of bg/bias', async () => {
    const { pushFgLightness } = await import('../../../src/client/fg-contrast.js');
    const [r, g, b] = pushFgLightness(120, 130, 140, 128, 128, 128, 0, 0);
    expect(r).toBe(120);
    expect(g).toBe(130);
    expect(b).toBe(140);
    // Non-zero bias with strength=0 is still identity.
    const [r2, g2, b2] = pushFgLightness(120, 130, 140, 128, 128, 128, 0, 50);
    expect([r2, g2, b2]).toEqual([120, 130, 140]);
  });

  test('fg brighter than bg → pushed even brighter', async () => {
    const { pushFgLightness } = await import('../../../src/client/fg-contrast.js');
    // bg mid-grey, fg slightly brighter.
    const [r] = pushFgLightness(150, 150, 150, 128, 128, 128, 100, 0);
    expect(r).toBeGreaterThan(150);
  });

  test('fg darker than bg → pushed even darker', async () => {
    const { pushFgLightness } = await import('../../../src/client/fg-contrast.js');
    const [r] = pushFgLightness(100, 100, 100, 128, 128, 128, 100, 0);
    expect(r).toBeLessThan(100);
  });

  test('fg lightness exactly at refL → unchanged (d=0 → push=0)', async () => {
    const { pushFgLightness } = await import('../../../src/client/fg-contrast.js');
    const [r, g, b] = pushFgLightness(128, 128, 128, 128, 128, 128, 100, 0);
    // Round-trip through Oklab introduces < 1 byte error; exact equality is not
    // expected — but the output must be within sRGB rounding of the input.
    expect(Math.abs(r - 128)).toBeLessThanOrEqual(1);
    expect(Math.abs(g - 128)).toBeLessThanOrEqual(1);
    expect(Math.abs(b - 128)).toBeLessThanOrEqual(1);
  });

  test('positive bias shifts the repulsion midpoint upward', async () => {
    const { pushFgLightness } = await import('../../../src/client/fg-contrast.js');
    // bg mid-grey L≈0.6. With bias=+30 the ref L ≈ 0.9. fg at L≈0.6 is now
    // *below* refL by a lot, so it gets pushed darker, not untouched.
    const [rNoBias] = pushFgLightness(128, 128, 128, 128, 128, 128, 100, 0);
    const [rBiased] = pushFgLightness(128, 128, 128, 128, 128, 128, 100, 30);
    // No-bias: d=0 → barely changed. Biased: d<<0 → meaningful push down.
    expect(rNoBias).toBeGreaterThan(rBiased);
    expect(rBiased).toBeLessThan(125); // noticeably darker
  });

  test('negative bias shifts the repulsion midpoint downward', async () => {
    const { pushFgLightness } = await import('../../../src/client/fg-contrast.js');
    const [rNoBias] = pushFgLightness(128, 128, 128, 128, 128, 128, 100, 0);
    const [rBiased] = pushFgLightness(128, 128, 128, 128, 128, 128, 100, -30);
    // Negative bias puts the ref below fg, so fg gets pushed brighter.
    expect(rBiased).toBeGreaterThan(rNoBias);
    expect(rBiased).toBeGreaterThan(130);
  });

  test('colour hue is preserved (chroma ratio stays consistent, only L moves)', async () => {
    const { pushFgLightness } = await import('../../../src/client/fg-contrast.js');
    // A reddish fg close to grey bg should stay reddish after the push.
    const [r, g, b] = pushFgLightness(150, 120, 120, 128, 128, 128, 100, 0);
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
  });

  test('colours far from refL are barely affected (Gaussian decay)', async () => {
    const { pushFgLightness } = await import('../../../src/client/fg-contrast.js');
    // Pure black and pure white are far from mid-grey; push should be small.
    const [rBlack, gBlack, bBlack] = pushFgLightness(0, 0, 0, 128, 128, 128, 100, 0);
    expect(rBlack).toBeLessThanOrEqual(5);
    expect(gBlack).toBeLessThanOrEqual(5);
    expect(bBlack).toBeLessThanOrEqual(5);
    const [rWhite, gWhite, bWhite] = pushFgLightness(255, 255, 255, 128, 128, 128, 100, 0);
    expect(rWhite).toBeGreaterThanOrEqual(250);
    expect(gWhite).toBeGreaterThanOrEqual(250);
    expect(bWhite).toBeGreaterThanOrEqual(250);
  });
});
