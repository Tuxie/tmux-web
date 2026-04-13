import { test, expect } from '@playwright/test';
import { mockApis, injectWsSpy, waitForWsOpen } from './helpers.js';

test('dropdown lists all sessions from /api/sessions', async ({ page }) => {
  await injectWsSpy(page);
  await mockApis(page, ['main', 'dev', 'work'], []);
  await page.goto('/main');
  await waitForWsOpen(page);
  const options = page.locator('#session-select option');
  await expect(options).toHaveCount(3);
  expect(await options.allTextContents()).toEqual(['main', 'dev', 'work']);
});

test('current session is pre-selected in dropdown', async ({ page }) => {
  await injectWsSpy(page);
  await mockApis(page, ['main', 'dev', 'work'], []);
  await page.goto('/main');
  await waitForWsOpen(page);
  await expect(page.locator('#session-select option')).toHaveCount(3);
  await expect(page.locator('#session-select')).toHaveValue('main');
});

test('selecting a session navigates to its URL', async ({ page }) => {
  await injectWsSpy(page);
  await mockApis(page, ['main', 'dev', 'work'], []);
  await page.goto('/main');
  await waitForWsOpen(page);
  await expect(page.locator('#session-select option')).toHaveCount(3);
  await Promise.all([
    page.waitForURL('**/dev'),
    page.selectOption('#session-select', 'dev'),
  ]);
  expect(new URL(page.url()).pathname).toBe('/dev');
});
