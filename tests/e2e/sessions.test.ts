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
  expect(texts[0]).toBe('\u2713 main');
  expect(texts[1]).toBe('  dev');
  expect(texts[2]).toBe('  work');
  expect(texts[3]).toBe('Kill session main\u2026');
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

test('right-click on session button opens a Rename/Kill context menu', async ({ page }) => {
  await injectWsSpy(page);
  await mockApis(page, ['main'], []);
  await page.goto('/main');
  await waitForWsOpen(page);
  await page.locator('#btn-session-menu').click({ button: 'right' });
  const menu = page.locator('.tw-dropdown-menu.tw-dd-context');
  await expect(menu).toBeVisible();
  const items = menu.locator('.tw-dropdown-item');
  await expect(items).toHaveCount(2);
  expect(await items.allTextContents()).toEqual(['Rename', 'Kill session']);
});

test('Rename from session context menu sends rename-session with entered name', async ({ page }) => {
  await injectWsSpy(page);
  await mockApis(page, ['main'], []);
  await page.goto('/main');
  await waitForWsOpen(page);
  await page.evaluate(() => { (window as any).__wsSent = []; });

  page.once('dialog', d => d.accept('project-x'));
  await page.locator('#btn-session-menu').click({ button: 'right' });
  await page.locator('.tw-dd-context .tw-dropdown-item', { hasText: 'Rename' }).click();

  const sent: string[] = await page.evaluate(() => (window as any).__wsSent);
  expect(sent).toContain(JSON.stringify({ type: 'session', action: 'rename', name: 'project-x' }));
});

test('Kill session confirms first, sends kill only on accept', async ({ page }) => {
  await injectWsSpy(page);
  await mockApis(page, ['main'], []);
  await page.goto('/main');
  await waitForWsOpen(page);
  await page.evaluate(() => { (window as any).__wsSent = []; });

  // Dismiss — nothing should be sent.
  page.once('dialog', d => d.dismiss());
  await page.locator('#btn-session-menu').click({ button: 'right' });
  await page.locator('.tw-dd-context .tw-dropdown-item', { hasText: 'Kill session' }).click();
  let sent: string[] = await page.evaluate(() => (window as any).__wsSent);
  expect(sent.some(s => s.includes('"action":"kill"'))).toBe(false);

  // Accept — kill message goes out.
  page.once('dialog', d => d.accept());
  await page.locator('#btn-session-menu').click({ button: 'right' });
  await page.locator('.tw-dd-context .tw-dropdown-item', { hasText: 'Kill session' }).click();
  sent = await page.evaluate(() => (window as any).__wsSent);
  expect(sent).toContain(JSON.stringify({ type: 'session', action: 'kill' }));
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
