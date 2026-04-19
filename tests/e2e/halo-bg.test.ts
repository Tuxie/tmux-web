/**
 * Glyph-halo AA reference-colour regression tests
 * ================================================
 *
 * When a light colour scheme (e.g. Tomorrow, E2E Green) is combined with
 * a theme whose CSS body is a gradient / image (Amiga Scene 2000, the
 * `E2E Gradient Body` fixture theme), the WebGL atlas rasterises glyph
 * halos against the *colour scheme's* light background because
 * `getComputedStyle(document.body).backgroundColor` returns
 * `rgba(0, 0, 0, 0)` for gradient bodies. The visible result is a bright
 * halo/outline around every character sitting over the actually-dark
 * gradient.
 *
 * The fix is to let themes declare a CSS custom property
 * `--tw-halo-bg: <rgb>` on `:root` (or any ancestor). When present and
 * non-transparent, `composeTheme` uses that colour as the halo-blend
 * reference instead of the body's computed bg. Themes with solid body
 * backgrounds need no change — they keep using `document.body`'s colour.
 *
 * Implementation pointers:
 *   - src/client/colours.ts    — `composeTheme(theme, opacity, bodyBg)`
 *                                receives the already-resolved halo ref.
 *   - src/client/index.ts      — the `getBodyBg()` helper should first
 *                                check `--tw-halo-bg` on
 *                                `document.documentElement`, then fall
 *                                back to `getComputedStyle(body).bg`.
 *
 * The fixture theme `E2E Gradient Body` (see
 * `tests/fixtures/themes-bundled/e2e/gradient.css`) declares
 * `--tw-halo-bg: rgb(20, 40, 20)` on `:root` and a dark radial-gradient
 * body. `FX.themes.gradientHaloBgRgb` in `tests/e2e/fixture-themes.ts`
 * mirrors that value so the test can compare against it without parsing
 * CSS at runtime.
 */

import { test, expect, type Page } from '@playwright/test';
import { mockSessionStore } from './helpers.js';
import { FX, fixtureSessionSettings } from './fixture-themes.js';

async function readyAdapter(page: Page): Promise<void> {
  await page.waitForSelector('#terminal canvas');
  await page.waitForFunction(() => !!(window as any).__adapter);
  await page.waitForTimeout(300);
}

function parseRgba(s: string | null | undefined): [number, number, number] | null {
  if (!s) return null;
  const m = s.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return m ? [parseInt(m[1]!, 10), parseInt(m[2]!, 10), parseInt(m[3]!, 10)] : null;
}

test.describe('glyph halo AA reference colour', () => {
  // Scenario = the bug report: light colour scheme + gradient body +
  // low BG opacity. At opacity=0, composeTheme returns a colour whose
  // RGB should match the halo-bg (dark green from the fixture), NOT
  // the colour scheme's light-green bg.
  test('gradient-body theme: composeTheme uses --tw-halo-bg, not the light scheme bg', async ({ page }) => {
    await mockSessionStore(page, {
      sessions: {
        main: fixtureSessionSettings({
          theme: FX.themes.gradient,
          colours: FX.colours.c, // E2E Green — light variant (#e0ffe0 bg)
          opacity: 0,
        }),
      },
    });
    await page.goto('/main');
    await readyAdapter(page);

    const themeBg = await page.evaluate(() =>
      (window as any).__adapter?.term?.options?.theme?.background
    );
    const rgb = parseRgba(themeBg);
    if (!rgb) {
      throw new Error(
        `Expected theme.background to be rgba(...). Got: ${themeBg}. ` +
        `composeTheme should always emit rgba() format.`
      );
    }

    const [haloR, haloG, haloB] = FX.themes.gradientHaloBgRgb;
    const [r, g, b] = rgb;
    const haloDist = Math.abs(r - haloR) + Math.abs(g - haloG) + Math.abs(b - haloB);
    const LIGHT_SCHEME_BG: [number, number, number] = [224, 255, 224]; // #e0ffe0 (E2E Green)
    const lightDist =
      Math.abs(r - LIGHT_SCHEME_BG[0]) +
      Math.abs(g - LIGHT_SCHEME_BG[1]) +
      Math.abs(b - LIGHT_SCHEME_BG[2]);

    if (haloDist > 10) {
      throw new Error(
        `composeTheme output (${r}, ${g}, ${b}) isn't close to the --tw-halo-bg ` +
        `declared in the fixture (${haloR}, ${haloG}, ${haloB}).\n` +
        `  sum |Δ| to halo-bg = ${haloDist} (should be ≤ 10 for opacity=0)\n` +
        `  sum |Δ| to light colour-scheme bg = ${lightDist}\n` +
        (lightDist < haloDist
          ? '  The output is closer to the light scheme bg than the halo-bg — the fix is missing.\n' +
            '  Check `getBodyBg()` in src/client/index.ts: it should prefer\n' +
            '  `getComputedStyle(document.documentElement).getPropertyValue("--tw-halo-bg")`\n' +
            '  over `getComputedStyle(document.body).backgroundColor`.'
          : '  The fix runs but the halo-bg value isn\'t being used. Verify `composeTheme` ' +
            'receives the resolved halo color as its `bodyBg` argument.')
      );
    }
  });

  // Mid-opacity sanity check — at 50%, the composeTheme output should
  // land halfway between halo-bg and the light scheme's bg. Without the
  // fix it stays pinned to the light scheme's bg.
  test('gradient-body theme at opacity=50 blends halfway toward --tw-halo-bg', async ({ page }) => {
    await mockSessionStore(page, {
      sessions: {
        main: fixtureSessionSettings({
          theme: FX.themes.gradient,
          colours: FX.colours.c,
          opacity: 50,
        }),
      },
    });
    await page.goto('/main');
    await readyAdapter(page);

    const themeBg = await page.evaluate(() =>
      (window as any).__adapter?.term?.options?.theme?.background
    );
    const rgb = parseRgba(themeBg);
    expect(rgb, 'theme.background should be rgba()').not.toBeNull();
    const [r, g, b] = rgb!;

    const [haloR, haloG, haloB] = FX.themes.gradientHaloBgRgb;
    // Expected at α=0.5: themeBg × 0.5 + haloBg × 0.5.
    const expR = Math.round(224 * 0.5 + haloR * 0.5);
    const expG = Math.round(255 * 0.5 + haloG * 0.5);
    const expB = Math.round(224 * 0.5 + haloB * 0.5);
    const dist = Math.abs(r - expR) + Math.abs(g - expG) + Math.abs(b - expB);
    if (dist > 6) {
      throw new Error(
        `At opacity=50, composeTheme should produce a 50/50 blend of the light scheme ` +
        `bg (224,255,224) and the halo-bg (${haloR},${haloG},${haloB}).\n` +
        `  expected ≈ (${expR}, ${expG}, ${expB})\n` +
        `  actual     (${r}, ${g}, ${b})\n` +
        `  sum |Δ| = ${dist} (tolerance: 6)`
      );
    }
  });

  // Non-gradient themes with a solid body background must keep working
  // as before — the `--tw-halo-bg` lookup should only override when the
  // variable is *actually set*. This guards against the fix spraying
  // `--tw-halo-bg` inheritance where it isn't wanted.
  test('solid-body theme: composeTheme keeps using the body backgroundColor', async ({ page }) => {
    await mockSessionStore(page, {
      sessions: {
        main: fixtureSessionSettings({
          theme: FX.themes.primary, // primary fixture = solid body
          colours: FX.colours.c,
          opacity: 0,
        }),
      },
    });
    await page.goto('/main');
    await readyAdapter(page);

    const { bodyBg, themeBg } = await page.evaluate(() => ({
      bodyBg: getComputedStyle(document.body).backgroundColor,
      themeBg: (window as any).__adapter?.term?.options?.theme?.background as string,
    }));

    const rgb = parseRgba(themeBg);
    const bodyRgb = parseRgba(bodyBg);
    if (!rgb || !bodyRgb) {
      throw new Error(`Unable to parse theme.background=${themeBg} / bodyBg=${bodyBg}`);
    }
    const [r, g, b] = rgb;
    const [br, bg, bb] = bodyRgb;
    const dist = Math.abs(r - br) + Math.abs(g - bg) + Math.abs(b - bb);
    if (dist > 6) {
      throw new Error(
        `Solid-body theme: at opacity=0 the pre-blended colour should equal the body's ` +
        `computed backgroundColor.\n` +
        `  body bg        = (${br}, ${bg}, ${bb})\n` +
        `  theme.background = (${r}, ${g}, ${b})\n` +
        `  sum |Δ| = ${dist} (tolerance: 6)\n` +
        `  This suggests the --tw-halo-bg lookup triggered even though the theme didn't set it.\n` +
        `  Re-check that the lookup only treats non-empty, parseable values as overrides.`
      );
    }
  });
});
