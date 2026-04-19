import { expect, test } from '@playwright/test';
import { mockSessionStore, type SessionStoreMock } from './helpers.js';

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

  test('default theme loads, terminal renders', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#terminal')).toBeVisible();
    await expect(page.locator('#theme-css')).toHaveAttribute('href', '/themes/default/default.css');
  });

  test('Theme dropdown lists Default', async ({ page }) => {
    await page.goto('/');
    await waitForThemeAndFontLists(page);
    await page.click('#btn-menu');
    const opts = await page.locator('#inp-theme option').allTextContents();
    expect(opts).toContain('Default');
  });

  test('unknown saved theme falls back to Default without crashing', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('tmux-web-session:main',
        JSON.stringify({ theme: 'NoSuchTheme', colours: 'Gruvbox Dark', fontFamily: 'Iosevka Nerd Font Mono',
                         fontSize: 18, spacing: 0.85, opacity: 0 }));
    });
    await page.goto('/');
    await expect(page.locator('#terminal')).toBeVisible();
    await expect(page.locator('#theme-css')).toHaveAttribute('href', '/themes/default/default.css');
  });

  test('colours trigger label reflects the saved value on initial render', async ({ page }) => {
    await mockSessionStore(page, {
      sessions: {
        main: { theme: 'Default', colours: 'Dracula', fontFamily: 'Iosevka Nerd Font Mono',
                fontSize: 18, spacing: 0.85, opacity: 0 },
      },
    });
    await page.goto('/main');
    await page.click('#btn-menu');
    // The custom dropdown trigger should show the saved value ("Dracula"),
    // not the first option in the <select> (regression: programmatic
    // `select.value = x` doesn't fire change, so the visible label would
    // be stale unless the dropdown refreshes it explicitly).
    await expect(page.locator('#inp-colours-btn .tw-dropdown-value')).toHaveText('Dracula');
    await expect(page.locator('#inp-colours')).toHaveValue('Dracula');
  });

  test('reset colours resets background hue', async ({ page }) => {
    const store = await mockSessionStore(page);
    await page.goto('/main');
    await waitForThemeAndFontLists(page);
    await page.click('#btn-menu');

    await page.fill('#inp-background-hue', '240');
    await page.locator('#inp-background-hue').dispatchEvent('change');
    await waitForStored(store, 'main', s => s.backgroundHue === 240);

    await page.click('#btn-reset-colours');

    await expect(page.locator('#inp-background-hue')).toHaveValue('183');
    await waitForStored(store, 'main', s => s.backgroundHue === 183);
  });

  test('font picker is populated', async ({ page }) => {
    await page.goto('/');
    await waitForThemeAndFontLists(page);
    await page.click('#btn-menu');
    const count = await page.locator('#inp-font-bundled option').count();
    expect(count).toBeGreaterThan(0);
  });
});
