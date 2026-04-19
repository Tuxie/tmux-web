import { expect, test } from '@playwright/test';
import { mockSessionStore, type SessionStoreMock } from './helpers.js';

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
const ALT_THEME = FX.themes.alt;
const FONT = FX.fonts.primary;
const COLOUR_B = FX.colours.b;
const ALT_DEFAULT_BG_HUE = 183;
const ALT_DEFAULT_TUI_BG_OPACITY = FX.altDefaultTuiBgOpacity;

test.describe('theming', () => {
  async function waitForThemeAndFontLists(page: import('@playwright/test').Page): Promise<void> {
    await page.waitForFunction(
      () =>
        (document.getElementById('inp-theme') as HTMLSelectElement | null)?.options.length > 0 &&
        (document.getElementById('inp-font-bundled') as HTMLSelectElement | null)?.options.length > 0,
      { timeout: 5000 }
    );
  }

  async function waitForStored(store: SessionStoreMock, name: string, predicate: (s: any) => boolean): Promise<void> {
    for (let i = 0; i < 50; i++) {
      const s = store.get().sessions[name];
      if (s && predicate(s)) return;
      await new Promise(r => setTimeout(r, 50));
    }
    throw new Error(`session '${name}' never matched predicate; current state: ${JSON.stringify(store.get().sessions[name])}`);
  }

  test('fixture primary theme loads, terminal renders', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#terminal')).toBeVisible();
    await expect(page.locator('#theme-css')).toHaveAttribute('href', PRIMARY_THEME_CSS);
  });

  test('Theme dropdown lists the fixture themes', async ({ page }) => {
    await page.goto('/');
    await waitForThemeAndFontLists(page);
    await page.click('#btn-menu');
    const opts = await page.locator('#inp-theme option').allTextContents();
    expect(opts).toContain(PRIMARY_THEME);
    expect(opts).toContain(ALT_THEME);
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

  test('reset colours resets background hue and TUI opacity to theme defaults', async ({ page }) => {
    const store = await mockSessionStore(page);
    await page.goto('/main');
    await waitForThemeAndFontLists(page);
    await page.click('#btn-menu');
    // Disable autohide so the menu doesn't close between the multiple
    // fill/dispatchEvent/waitForStored cycles below (autohide fires
    // after 1s of mouse idleness, but the test takes longer).
    await page.evaluate(() => {
      const cb = document.getElementById('chk-autohide') as HTMLInputElement;
      if (cb && cb.checked) cb.click();
    });

    // Switch to the alt fixture theme (which has defaultTuiOpacity=70)
    // so Reset lands on a non-100 value we can distinguish.
    await page.selectOption('#inp-theme', ALT_THEME);
    await waitForStored(store, 'main', s => s.theme === ALT_THEME);

    await page.fill('#inp-background-hue', '240');
    await page.locator('#inp-background-hue').dispatchEvent('change');
    await waitForStored(store, 'main', s => s.backgroundHue === 240);
    await page.fill('#inp-tui-bg-opacity', '30');
    await page.locator('#inp-tui-bg-opacity').dispatchEvent('change');
    await waitForStored(store, 'main', s => s.tuiBgOpacity === 30);

    // Long sequence of waitForStored calls gives the topbar autohide
    // timer (~1s, mouse-idleness-based) time to hide the menu. Reopen
    // defensively if it has closed.
    if (!(await page.locator('#menu-dropdown').isVisible())) {
      await page.click('#btn-menu');
      await page.waitForSelector('#btn-reset-colours', { state: 'visible' });
    }
    await page.click('#btn-reset-colours');

    await expect(page.locator('#inp-background-hue')).toHaveValue(String(ALT_DEFAULT_BG_HUE));
    await expect(page.locator('#inp-tui-bg-opacity')).toHaveValue(String(ALT_DEFAULT_TUI_BG_OPACITY));
    await waitForStored(store, 'main', s =>
      s.backgroundHue === ALT_DEFAULT_BG_HUE && s.tuiBgOpacity === ALT_DEFAULT_TUI_BG_OPACITY);
  });

  test('font picker is populated from the fixture', async ({ page }) => {
    await page.goto('/');
    await waitForThemeAndFontLists(page);
    await page.click('#btn-menu');
    const opts = await page.locator('#inp-font-bundled option').allTextContents();
    expect(opts).toContain(FONT);
  });
});

