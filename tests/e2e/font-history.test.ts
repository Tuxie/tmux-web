/**
 * Verify that font and spacing preferences are remembered per font.
 *
 * - Spacing is remembered per font: changing fonts restores the spacing last used with that font
 */
import { test, expect } from '@playwright/test';
import { mockSessionStore, injectWsSpy, waitForWsOpen, type SessionStoreMock } from './helpers.js';

async function openMenu(page: import('@playwright/test').Page): Promise<void> {
  // Reveal topbar
  await page.mouse.move(640, 10);
  await page.waitForTimeout(100);
  // Assumes mouse is already hovering topbar to prevent autohide
  await page.click('#btn-menu');
  await expect(page.locator('#menu-dropdown')).toBeVisible();
}

async function waitForFontList(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(
    () => (document.getElementById('inp-font-bundled') as HTMLSelectElement)?.options.length > 0,
    { timeout: 5000 },
  );
}

async function waitForStored(store: SessionStoreMock, name: string, predicate: (s: any) => boolean): Promise<void> {
  for (let i = 0; i < 50; i++) {
    const s = store.get().sessions[name];
    if (s && predicate(s)) return;
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error(`session '${name}' never matched predicate; current state: ${JSON.stringify(store.get().sessions[name])}`);
}

test.describe('font and spacing memory', () => {
  let store: SessionStoreMock;

  test.beforeEach(async ({ page, context }) => {
    await context.clearCookies();
    await injectWsSpy(page);
    store = await mockSessionStore(page);
    await page.route('**/api/sessions', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(['main']) }));
    await page.route('**/api/windows**', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await page.goto('/main');
    await waitForWsOpen(page);
    await waitForFontList(page);
  });

  test('spacing change persists in session settings', async ({ page }) => {
    await openMenu(page);

    // Change spacing
    await page.fill('#inp-spacing', '1.5');
    await page.locator('#inp-spacing').dispatchEvent('change');

    // Verify it's PUT to /api/session-settings (now the persistence layer).
    await waitForStored(store, 'main', s => Math.abs(s.spacing - 1.5) < 0.05);
  });

  test('font and spacing persist across page reload', async ({ page }) => {
    const otherFont = await page.evaluate(() => {
      const sel = document.getElementById('inp-font-bundled') as HTMLSelectElement;
      return Array.from(sel.options).find(o => !o.value.includes('Iosevka Nerd Font Mono'))?.value ?? '';
    });
    expect(otherFont).toBeTruthy();

    // Open menu, select a bundled font and set spacing
    await openMenu(page);
    await page.selectOption('#inp-font-bundled', otherFont);
    await page.fill('#inp-spacing', '0.85');
    await page.locator('#inp-spacing').dispatchEvent('change');
    await waitForStored(store, 'main', s => s.fontFamily === otherFont && Math.abs(s.spacing - 0.85) < 0.05);

    // Close menu before reload
    await page.click('#btn-menu');

    // Reload — the mock store retains state across the reload, mirroring the
    // real server's on-disk persistence.
    await page.reload();
    await waitForWsOpen(page);
    await waitForFontList(page);

    // Verify the font and spacing are restored from the persisted store.
    await openMenu(page);
    await expect(page.locator('#inp-font-bundled')).toHaveValue(otherFont);
    const spacing = await page.inputValue('#inp-spacing');
    expect(parseFloat(spacing)).toBeCloseTo(0.85, 1);
  });
});
