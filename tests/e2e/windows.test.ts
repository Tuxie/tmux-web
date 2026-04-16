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

test('clicking a window tab sends a select-window message for that tab', async ({ page }) => {
  await page.locator('#win-tabs button').nth(1).click();
  const sent: string[] = await page.evaluate(() => (window as any).__wsSent);
  expect(sent).toContain(JSON.stringify({ type: 'window', action: 'select', index: '1' }));
});

test('clicking the new window button sends a new-window message', async ({ page }) => {
  await page.locator('#win-tabs button').nth(2).click();
  const sent: string[] = await page.evaluate(() => (window as any).__wsSent);
  expect(sent).toContain(JSON.stringify({ type: 'window', action: 'new' }));
});

test('right-click on new-window button prompts for a name and sends it', async ({ page }) => {
  await page.locator('#win-tabs button').nth(2).click({ button: 'right' });
  const popup = page.locator('.tw-dropdown-menu.tw-dd-context-new-window');
  await expect(popup).toBeVisible();
  await expect(popup.locator('.menu-label')).toHaveText('New window:');
  const input = popup.locator('.tw-dd-input');
  await input.fill('notes');
  await input.press('Enter');
  const sent: string[] = await page.evaluate(() => (window as any).__wsSent);
  expect(sent).toContain(JSON.stringify({ type: 'window', action: 'new', name: 'notes' }));
  // Popup dismissed after submit
  await expect(popup).toHaveCount(0);
});

test('new-window popup input keeps keyboard focus while typing', async ({ page }) => {
  await page.locator('#win-tabs button').nth(2).click({ button: 'right' });
  const popup = page.locator('.tw-dropdown-menu.tw-dd-context-new-window');
  await expect(popup).toBeVisible();
  // Simulate typing one character at a time; if the global keydown handler
  // stole focus back to the terminal, only the first key would land in the
  // input.
  await page.keyboard.type('hello');
  await expect(popup.locator('.tw-dd-input')).toHaveValue('hello');
});

test('right-click on a window tab opens a Name input + Close item', async ({ page }) => {
  await page.locator('#win-tabs button').nth(1).click({ button: 'right' });
  const menu = page.locator('.tw-dropdown-menu.tw-dd-context-win');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.menu-label')).toHaveText('Name:');
  // Name input is pre-filled with the current window name.
  await expect(menu.locator('.tw-dd-input')).toHaveValue('vim');
  const items = menu.locator('.tw-dropdown-item');
  await expect(items).toHaveCount(1);
  expect(await items.allTextContents()).toEqual(['Close']);
});

test('editing the Name input and pressing Enter sends rename-window', async ({ page }) => {
  await page.locator('#win-tabs button').nth(1).click({ button: 'right' });
  const input = page.locator('.tw-dd-context-win .tw-dd-input');
  await input.fill('editor');
  await input.press('Enter');
  const sent: string[] = await page.evaluate(() => (window as any).__wsSent);
  expect(sent).toContain(JSON.stringify({ type: 'window', action: 'rename', index: '1', name: 'editor' }));
  await expect(page.locator('.tw-dropdown-menu.tw-dd-context-win')).toHaveCount(0);
});

test('pressing Enter with the name unchanged does not send rename', async ({ page }) => {
  await page.locator('#win-tabs button').nth(1).click({ button: 'right' });
  const input = page.locator('.tw-dd-context-win .tw-dd-input');
  await input.press('Enter');
  const sent: string[] = await page.evaluate(() => (window as any).__wsSent);
  expect(sent.some(s => s.includes('"action":"rename"'))).toBe(false);
});

test('Close from context menu sends a close-window message for that tab', async ({ page }) => {
  await page.locator('#win-tabs button').nth(1).click({ button: 'right' });
  await page.locator('.tw-dd-context-win .tw-dropdown-item', { hasText: 'Close' }).click();
  const sent: string[] = await page.evaluate(() => (window as any).__wsSent);
  expect(sent).toContain(JSON.stringify({ type: 'window', action: 'close', index: '1' }));
});

test('context menu closes on Escape and on outside click', async ({ page }) => {
  // Escape
  await page.locator('#win-tabs button').nth(0).click({ button: 'right' });
  await expect(page.locator('.tw-dropdown-menu.tw-dd-context')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.tw-dropdown-menu.tw-dd-context')).toHaveCount(0);

  // Outside click
  await page.locator('#win-tabs button').nth(0).click({ button: 'right' });
  await expect(page.locator('.tw-dropdown-menu.tw-dd-context')).toBeVisible();
  await page.mouse.click(5, 600);
  await expect(page.locator('.tw-dropdown-menu.tw-dd-context')).toHaveCount(0);
});
