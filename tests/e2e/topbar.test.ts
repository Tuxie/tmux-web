import { test, expect } from '@playwright/test';
import { mockApis, injectWsSpy, waitForWsOpen } from './helpers.js';

test.beforeEach(async ({ page }) => {
  // Autohide defaults to off (commit 9e6ab66); these tests exercise the
  // autohide behaviour, so flip the localStorage pref on before boot.
  await page.addInitScript(() => {
    localStorage.setItem('tmux-web-topbar-autohide', '1');
  });
  await injectWsSpy(page);
  await mockApis(page, ['main'], []);
  await page.goto('/main');
  await waitForWsOpen(page);
});

test('topbar auto-hides after inactivity', async ({ page }) => {
  await page.mouse.move(640, 10);
  await expect(page.locator('#topbar')).not.toHaveClass(/hidden/);

  await page.mouse.move(640, 400);
  await page.waitForFunction(
    () => document.getElementById('topbar')?.classList.contains('hidden') === true,
    { timeout: 5000 },
  );
  await expect(page.locator('#topbar')).toHaveClass(/hidden/);
});

test('topbar reappears when mouse moves near top', async ({ page }) => {
  await page.mouse.move(640, 400);
  await page.waitForFunction(
    () => document.getElementById('topbar')?.classList.contains('hidden') === true,
    { timeout: 5000 },
  );
  await expect(page.locator('#topbar')).toHaveClass(/hidden/);

  await page.mouse.move(640, 50);
  await expect(page.locator('#topbar')).not.toHaveClass(/hidden/);
});
