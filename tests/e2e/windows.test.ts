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
  // Trailing windows-menu button is present in tabs mode but shows only the
  // gadget — the name label is suppressed (redundant with the tabs).
  const windowsBtn = page.locator('#win-tabs .tb-btn-window-compact');
  await expect(windowsBtn).toHaveCount(1);
  await expect(windowsBtn).toHaveClass(/\btabs-shown\b/);
  await expect(windowsBtn.locator('.tb-window-compact-label')).toBeHidden();
});

test('active window tab has class "active", inactive does not', async ({ page }) => {
  const tabs = page.locator('#win-tabs .win-tab');
  await expect(tabs.nth(0)).toHaveClass(/active/);
  await expect(tabs.nth(1)).not.toHaveClass(/active/);
});

test('clicking a window tab sends a select-window message for that tab', async ({ page }) => {
  await page.locator('#win-tabs button').nth(1).click();
  const sent: string[] = await page.evaluate(() => (window as any).__wsSent);
  expect(sent).toContain(JSON.stringify({ type: 'window', action: 'select', index: '1' }));
});

test('right-click on the windows button sends a new-window message', async ({ page }) => {
  await page.locator('#win-tabs button').nth(2).click({ button: 'right' });
  const sent: string[] = await page.evaluate(() => (window as any).__wsSent);
  expect(sent).toContain(JSON.stringify({ type: 'window', action: 'new' }));
});

test('left-click on the windows button opens the rich windows menu', async ({ page }) => {
  await page.locator('#win-tabs button').nth(2).click();
  const menu = page.locator('.tw-dropdown-menu.tw-dd-windows-menu');
  await expect(menu).toBeVisible();
  // Window list: two rows, current one marked .current
  const sessionItems = menu.locator('.tw-dd-session-item');
  await expect(sessionItems).toHaveCount(2);
  await expect(sessionItems.nth(0)).toHaveClass(/\bcurrent\b/);
  await expect(sessionItems.nth(0)).toHaveText('0: zsh');
  await expect(sessionItems.nth(1)).toHaveText('1: vim');
  // Name + New window input rows
  const labels = await menu.locator('.menu-label').allTextContents();
  expect(labels).toEqual(['Name:', 'New window:']);
  // Show-windows-as-tabs checkbox
  await expect(menu.locator('input[type="checkbox"]')).toBeChecked();
  // Close current window row
  await expect(menu.locator('.tw-dropdown-item', { hasText: /^Close window 0: zsh\u2026$/ })).toBeVisible();
});

test('New window input in the menu creates a named window', async ({ page }) => {
  await page.locator('#win-tabs button').nth(2).click();
  const menu = page.locator('.tw-dd-windows-menu');
  const input = menu.locator('.menu-row', { hasText: 'New window:' }).locator('input');
  await input.fill('logs');
  await input.press('Enter');
  const sent: string[] = await page.evaluate(() => (window as any).__wsSent);
  expect(sent).toContain(JSON.stringify({ type: 'window', action: 'new', name: 'logs' }));
});

test('Name input in the menu renames the current window', async ({ page }) => {
  await page.locator('#win-tabs button').nth(2).click();
  const menu = page.locator('.tw-dd-windows-menu');
  const nameInput = menu.locator('.menu-row', { hasText: 'Name:' }).locator('input');
  await expect(nameInput).toHaveValue('zsh');
  await nameInput.fill('shell');
  await nameInput.press('Enter');
  const sent: string[] = await page.evaluate(() => (window as any).__wsSent);
  expect(sent).toContain(JSON.stringify({ type: 'window', action: 'rename', index: '0', name: 'shell' }));
});

test('unchecking Show windows as tabs hides the tab buttons', async ({ page }) => {
  // Start in tabs mode — tabs present and windows-menu button at the end.
  await expect(page.locator('#win-tabs .win-tab')).toHaveCount(2);
  await expect(page.locator('#win-tabs .tb-btn-window-compact')).toHaveCount(1);

  // Open the windows menu and uncheck the toggle.
  await page.locator('#win-tabs .tb-btn-window-compact').click();
  await page.locator('.tw-dd-windows-menu input[type="checkbox"]').click();

  // Tabs gone; only the windows-menu button remains.
  await expect(page.locator('#win-tabs .win-tab')).toHaveCount(0);
  await expect(page.locator('#win-tabs .tb-btn-window-compact')).toHaveCount(1);
  await expect(page.locator('.tb-window-compact-label')).toHaveText('0: zsh');

  // Re-check to bring tabs back.
  await page.locator('.tb-btn-window-compact').click();
  await page.locator('.tw-dd-windows-menu input[type="checkbox"]').click();
  await expect(page.locator('#win-tabs .win-tab')).toHaveCount(2);
  await expect(page.locator('#win-tabs .tb-btn-window-compact')).toHaveCount(1);
});

test('right-click on a window tab opens a Name input + Close window item', async ({ page }) => {
  await page.locator('#win-tabs button').nth(1).click({ button: 'right' });
  const menu = page.locator('.tw-dropdown-menu.tw-dd-context-win-menu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.menu-label')).toHaveText('Name:');
  // Name input is pre-filled with the current window name.
  await expect(menu.locator('.tw-dd-input')).toHaveValue('vim');
  const items = menu.locator('.tw-dropdown-item');
  await expect(items).toHaveCount(1);
  // Close row shows the index and name for clarity.
  expect(await items.allTextContents()).toEqual(['Close window 1: vim']);
});

test('editing the Name input and pressing Enter sends rename-window', async ({ page }) => {
  await page.locator('#win-tabs button').nth(1).click({ button: 'right' });
  const input = page.locator('.tw-dd-context-win-menu .tw-dd-input');
  await input.fill('editor');
  await input.press('Enter');
  const sent: string[] = await page.evaluate(() => (window as any).__wsSent);
  expect(sent).toContain(JSON.stringify({ type: 'window', action: 'rename', index: '1', name: 'editor' }));
  await expect(page.locator('.tw-dropdown-menu.tw-dd-context-win-menu')).toHaveCount(0);
});

test('pressing Enter with the name unchanged does not send rename', async ({ page }) => {
  await page.locator('#win-tabs button').nth(1).click({ button: 'right' });
  const input = page.locator('.tw-dd-context-win-menu .tw-dd-input');
  await input.press('Enter');
  const sent: string[] = await page.evaluate(() => (window as any).__wsSent);
  expect(sent.some(s => s.includes('"action":"rename"'))).toBe(false);
});

test('Close window from context menu sends a close-window message for that tab', async ({ page }) => {
  await page.locator('#win-tabs button').nth(1).click({ button: 'right' });
  await page.locator('.tw-dd-context-win-menu .tw-dropdown-item', { hasText: 'Close window' }).click();
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
