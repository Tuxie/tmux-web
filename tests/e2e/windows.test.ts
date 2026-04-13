import { test, expect } from '@playwright/test';
import { mockApis, injectWsSpy, waitForWsOpen, sendFromServer } from './helpers.js';

const WINDOWS = [
  { index: '0', name: 'zsh', active: true },
  { index: '1', name: 'vim', active: false },
];

test.beforeEach(async ({ page }) => {
  await injectWsSpy(page);
  await mockApis(page, ['main'], WINDOWS);
  await page.goto('/main');
  await waitForWsOpen(page);
  await sendFromServer(page, { session: 'main', windows: WINDOWS });
  // Wait for tabs to render before each test (2 tabs + 1 add button)
  await expect(page.locator('#win-tabs button')).toHaveCount(3);
  await page.evaluate(() => { (window as any).__wsSent = []; });
});

test('window tabs render with correct labels', async ({ page }) => {
  await expect(page.locator('#win-tabs button').nth(0)).toHaveText('0:zsh');
  await expect(page.locator('#win-tabs button').nth(1)).toHaveText('1:vim');
  await expect(page.locator('#win-tabs button').nth(2)).toHaveText('+');
});

test('active window tab has class "active", inactive does not', async ({ page }) => {
  await expect(page.locator('#win-tabs button').nth(0)).toHaveClass(/active/);
  await expect(page.locator('#win-tabs button').nth(1)).not.toHaveClass(/active/);
  await expect(page.locator('#win-tabs button').nth(2)).not.toHaveClass(/active/);
});

test('clicking a window tab sends Ctrl-S + window index', async ({ page }) => {
  await page.locator('#win-tabs button').nth(1).click();
  const sent: string[] = await page.evaluate(() => (window as any).__wsSent);
  // \x13 is Ctrl-S (char code 19); '1' is the window index as a string
  expect(sent).toContain('\x131');
});

test('clicking the new window button sends Ctrl-S Ctrl-C', async ({ page }) => {
  await page.locator('#win-tabs button').nth(2).click();
  const sent: string[] = await page.evaluate(() => (window as any).__wsSent);
  // \x13\x03 is Ctrl-S Ctrl-C
  expect(sent).toContain('\x13\x03');
});
