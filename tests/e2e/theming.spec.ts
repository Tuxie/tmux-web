import { expect, test } from '@playwright/test';

test.describe('theming', () => {
  test('default theme loads, terminal renders', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#terminal')).toBeVisible();
    await expect(page.locator('#theme-css')).toHaveAttribute('href', '/themes/default/default.css');
  });

  test('Theme dropdown lists Default', async ({ page }) => {
    await page.goto('/');
    await page.click('#btn-menu');
    const opts = await page.locator('#inp-theme option').allTextContents();
    expect(opts).toContain('Default');
  });

  test('unknown saved theme falls back to Default without crashing', async ({ page }) => {
    await page.addInitScript(() => {
      document.cookie = 'tmux-web-settings=' + encodeURIComponent(JSON.stringify({ theme: 'NoSuchTheme' })) + '; path=/';
    });
    await page.goto('/');
    await expect(page.locator('#terminal')).toBeVisible();
    await expect(page.locator('#theme-css')).toHaveAttribute('href', '/themes/default/default.css');
  });

  test('font picker is populated', async ({ page }) => {
    await page.goto('/');
    await page.click('#btn-menu');
    const count = await page.locator('#inp-font-bundled option').count();
    expect(count).toBeGreaterThan(0);
  });
});
