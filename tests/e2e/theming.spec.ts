import { expect, test } from '@playwright/test';

test.describe('theming', () => {
  async function waitForThemeAndFontLists(page: import('@playwright/test').Page): Promise<void> {
    await page.waitForFunction(
      () =>
        (document.getElementById('inp-theme') as HTMLSelectElement | null)?.options.length > 0 &&
        (document.getElementById('inp-font-bundled') as HTMLSelectElement | null)?.options.length > 0,
      { timeout: 5000 }
    );
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

  test('font picker is populated', async ({ page }) => {
    await page.goto('/');
    await waitForThemeAndFontLists(page);
    await page.click('#btn-menu');
    const count = await page.locator('#inp-font-bundled option').count();
    expect(count).toBeGreaterThan(0);
  });
});
