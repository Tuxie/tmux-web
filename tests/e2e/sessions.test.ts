import { test, expect } from '@playwright/test';
import { mockApis, injectWsSpy, waitForWsOpen } from './helpers.js';

test('session button shows current session name', async ({ page }) => {
  await injectWsSpy(page);
  await mockApis(page, ['main', 'dev', 'work'], []);
  await page.goto('/main');
  await waitForWsOpen(page);
  await expect(page.locator('#tb-session-name')).toHaveText('main');
});

test('opening session button lists sessions with the current one checked + Kill row', async ({ page }) => {
  await injectWsSpy(page);
  await mockApis(page, ['main', 'dev', 'work'], []);
  await page.goto('/main');
  await waitForWsOpen(page);
  await page.click('#btn-session-menu');
  const menu = page.locator('.tw-dropdown-menu.tw-dd-sessions-menu:not([hidden])');
  const items = menu.locator('.tw-dropdown-item');
  // 3 session rows + 1 Kill row
  await expect(items).toHaveCount(4);
  const texts = await items.allTextContents();
  expect(texts[0]).toBe('main');
  expect(texts[1]).toBe('dev');
  expect(texts[2]).toBe('work');
  expect(texts[3]).toBe('Kill session main\u2026');
  // Only the current session gets the 'current' class (for the ✓ gutter).
  await expect(items.nth(0)).toHaveClass(/\bcurrent\b/);
  await expect(items.nth(1)).not.toHaveClass(/\bcurrent\b/);
  await expect(items.nth(2)).not.toHaveClass(/\bcurrent\b/);
  // Input rows for Name and New session
  const labels = await menu.locator('.menu-label').allTextContents();
  expect(labels).toEqual(['Name:', 'New session:']);
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

test('switching session does not trigger a full page reload', async ({ page }) => {
  await injectWsSpy(page);
  await mockApis(page, ['main', 'dev'], []);
  await page.goto('/main');
  await waitForWsOpen(page);
  // Tag the window — a full reload would wipe this; pushState/replaceState
  // would preserve it (and so will fullscreen state).
  await page.evaluate(() => { (window as any).__notReloaded = 'sentinel-42'; });
  await page.click('#btn-session-menu');
  await Promise.all([
    page.waitForURL('**/dev'),
    page.locator('.tw-dropdown-menu.tw-dd-sessions-menu:not([hidden]) .tw-dropdown-item', { hasText: 'dev' }).click(),
  ]);
  const sentinel = await page.evaluate(() => (window as any).__notReloaded);
  expect(sentinel).toBe('sentinel-42');
});

test('Name input in session menu renames the current session on Enter', async ({ page }) => {
  await injectWsSpy(page);
  await mockApis(page, ['main'], []);
  await page.goto('/main');
  await waitForWsOpen(page);
  await page.evaluate(() => { (window as any).__wsSent = []; });
  await page.click('#btn-session-menu');
  const nameInput = page.locator('.tw-dd-sessions-menu .menu-row', { hasText: 'Name:' }).locator('input');
  await expect(nameInput).toHaveValue('main');
  await nameInput.fill('project');
  await nameInput.press('Enter');
  const sent: string[] = await page.evaluate(() => (window as any).__wsSent);
  expect(sent).toContain(JSON.stringify({ type: 'session', action: 'rename', name: 'project' }));
});

test('New session input navigates to the entered name', async ({ page }) => {
  await injectWsSpy(page);
  await mockApis(page, ['main'], []);
  await page.goto('/main');
  await waitForWsOpen(page);
  await page.click('#btn-session-menu');
  const newInput = page.locator('.tw-dd-sessions-menu .menu-row', { hasText: 'New session:' }).locator('input');
  await newInput.fill('scratch');
  await Promise.all([
    page.waitForURL('**/scratch'),
    newInput.press('Enter'),
  ]);
  expect(new URL(page.url()).pathname).toBe('/scratch');
});

test('Kill session row confirms and sends kill on accept', async ({ page }) => {
  await injectWsSpy(page);
  await mockApis(page, ['main'], []);
  await page.goto('/main');
  await waitForWsOpen(page);
  await page.evaluate(() => { (window as any).__wsSent = []; });
  page.once('dialog', d => d.accept());
  await page.click('#btn-session-menu');
  await page.locator('.tw-dd-sessions-menu .tw-dropdown-item', { hasText: 'Kill session' }).click();
  const sent: string[] = await page.evaluate(() => (window as any).__wsSent);
  expect(sent).toContain(JSON.stringify({ type: 'session', action: 'kill' }));
});

test('right-click on session button opens the same session menu as left-click', async ({ page }) => {
  await injectWsSpy(page);
  await mockApis(page, ['main', 'dev'], []);
  await page.goto('/main');
  await waitForWsOpen(page);
  const menu = page.locator('.tw-dropdown-menu.tw-dd-sessions-menu');
  await expect(menu).toBeHidden();

  await page.locator('#btn-session-menu').click({ button: 'right' });
  await expect(menu).toBeVisible();
  // Rich menu body: session list + Name/New session inputs + Kill row.
  await expect(menu.locator('.tw-dropdown-item')).toHaveCount(3); // 2 sessions + kill
  expect(await menu.locator('.menu-label').allTextContents()).toEqual(['Name:', 'New session:']);

  // No legacy .tw-dd-context-session popup exists.
  await expect(page.locator('.tw-dd-context-session')).toHaveCount(0);

  // Right-clicking again toggles it closed.
  await page.locator('#btn-session-menu').click({ button: 'right' });
  await expect(menu).toBeHidden();
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
