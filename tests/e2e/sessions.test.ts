import { test, expect } from '@playwright/test';
import { mockApis, injectWsSpy, waitForWsOpen } from './helpers.js';

test('session button shows current session name', async ({ page }) => {
  await injectWsSpy(page);
  await mockApis(page, ['main', 'dev', 'work'], []);
  await page.goto('/main');
  await waitForWsOpen(page);
  await expect(page.locator('#tb-session-name')).toHaveText('main');
});

test('opening session button lists all sessions from /api/sessions', async ({ page }) => {
  await injectWsSpy(page);
  await mockApis(page, ['main', 'dev', 'work'], []);
  await page.goto('/main');
  await waitForWsOpen(page);
  await page.click('#btn-session-menu');
  const items = page.locator('.tw-dropdown-menu.tw-dd-sessions-menu:not([hidden]) .tw-dropdown-item');
  // 3 existing sessions + "Create new session"
  await expect(items).toHaveCount(4);
  expect(await items.allTextContents()).toEqual(['main', 'dev', 'work', 'Create new session']);
});

test('selecting a session from the menu navigates to its URL', async ({ page }) => {
  await injectWsSpy(page);
  await mockApis(page, ['main', 'dev', 'work'], []);
  await page.goto('/main');
  await waitForWsOpen(page);
  await page.click('#btn-session-menu');
  await Promise.all([
    page.waitForURL('**/dev'),
    page.locator('.tw-dropdown-menu.tw-dd-sessions-menu:not([hidden]) .tw-dropdown-item', { hasText: 'dev' }).click(),
  ]);
  expect(new URL(page.url()).pathname).toBe('/dev');
});

test('session button has .open class while dropdown is showing', async ({ page }) => {
  await injectWsSpy(page);
  await mockApis(page, ['main'], []);
  await page.goto('/main');
  await waitForWsOpen(page);
  const btn = page.locator('#btn-session-menu');
  await expect(btn).not.toHaveClass(/\bopen\b/);
  await btn.click();
  await expect(btn).toHaveClass(/\bopen\b/);
  // Close by clicking outside
  await page.mouse.click(500, 500);
  await expect(btn).not.toHaveClass(/\bopen\b/);
});
