import { expect, test } from '@playwright/test';
import { mockSessionStore } from './helpers.js';

// The test server uses a single sessions.json for the whole run. Tests
// that switch theme/colours leak into subsequent tests unless we mock
// the store to an empty state. Default to empty storage so every test
// starts clean.
test.beforeEach(async ({ page }) => {
  await mockSessionStore(page);
});

// Bundled theme values are stable fixtures from
// `tests/fixtures/themes-bundled/e2e/`, wired in via the
// `TMUX_WEB_BUNDLED_THEMES_DIR` env in `playwright.config.ts`. Renaming
// or editing a real theme in `themes/` does not affect these tests.
import { FX } from './fixture-themes.js';
const PRIMARY_THEME = FX.themes.primary;
const PRIMARY_THEME_CSS = FX.themes.primaryCss;
const FONT = FX.fonts.primary;
const COLOUR_B = FX.colours.b;

test.describe('theming', () => {
  test('fixture primary theme loads, terminal renders', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#terminal')).toBeVisible();
    await expect(page.locator('#theme-css')).toHaveAttribute('href', PRIMARY_THEME_CSS);
  });

  test('unknown saved theme falls back to the first bundled theme without crashing', async ({ page }) => {
    await page.addInitScript((font) => {
      localStorage.setItem('tmux-web-session:main',
        JSON.stringify({ theme: 'NoSuchTheme', colours: 'NoSuchColours', fontFamily: font,
                         fontSize: 18, spacing: 0.85, opacity: 0 }));
    }, FONT);
    await page.goto('/');
    await expect(page.locator('#terminal')).toBeVisible();
    // The client's applyTheme() logs the fallback and uses the first
    // theme it can find. With the fixture pack that's the primary one.
    await expect(page.locator('#theme-css')).toHaveAttribute('href', PRIMARY_THEME_CSS);
  });

  test('colours trigger label reflects the saved value on initial render', async ({ page }) => {
    await mockSessionStore(page, {
      sessions: {
        main: { theme: PRIMARY_THEME, colours: COLOUR_B, fontFamily: FONT,
                fontSize: 18, spacing: 0.85, opacity: 0 },
      },
    });
    await page.goto('/main');
    await page.click('#btn-menu');
    // The custom dropdown trigger should show the saved value,
    // not the first option in the <select> (regression: programmatic
    // `select.value = x` doesn't fire change, so the visible label would
    // be stale unless the dropdown refreshes it explicitly).
    await expect(page.locator('#inp-colours-btn .tw-dropdown-value')).toHaveText(COLOUR_B);
    await expect(page.locator('#inp-colours')).toHaveValue(COLOUR_B);
  });
});
