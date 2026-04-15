/**
 * Verifies that the settings menu remains open (and does not lose DOM focus)
 * while the user changes font, font size, or line height settings.
 *
 * The terminal may internally re-render or even reload the page, but the
 * menu must stay visible and interactive throughout.
 */
import { test, expect } from '@playwright/test';
import { type ChildProcess } from 'child_process';
import { mockApis, injectWsSpy, waitForWsOpen, startServer, killServer } from './helpers.js';

const PORT_XTERM = 4060;

function startBackendServer(port: number): Promise<ChildProcess> {
  return startServer(
    'bun',
    ['src/server/index.ts', '--test', `--listen=127.0.0.1:${port}`, '--no-auth', '--no-tls'],
  );
}

/** Reveal the topbar and open the settings menu. */
async function openMenu(page: import('@playwright/test').Page): Promise<void> {
  await page.mouse.move(640, 10);
  await page.click('#btn-menu');
  await expect(page.locator('#menu-dropdown')).toBeVisible();
}

/** Set a number input's value and fire its 'change' event (simulates typing). */
async function setNumberInput(page: import('@playwright/test').Page, selector: string, value: string): Promise<void> {
  await page.fill(selector, value);
  await page.locator(selector).dispatchEvent('change');
}

/** Set a range slider's value and fire its 'input' event (simulates dragging). */
async function setSlider(page: import('@playwright/test').Page, selector: string, value: string): Promise<void> {
  await page.evaluate(({ sel, val }) => {
    const el = document.querySelector(sel) as HTMLInputElement;
    el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, { sel: selector, val: value });
}

// ---------------------------------------------------------------------------
// xterm — in-place updateOptions, no page reload
// ---------------------------------------------------------------------------
test.describe('menu stays open during settings changes: xterm', () => {
  let server: ChildProcess;
  const base = `http://127.0.0.1:${PORT_XTERM}`;

  test.beforeAll(async () => { server = await startBackendServer(PORT_XTERM); });
  test.afterAll(() => killServer(server));

  test.beforeEach(async ({ page }) => {
    await injectWsSpy(page);
    await mockApis(page, ['main'], []);
    await page.goto(`${base}/main`);
    await waitForWsOpen(page);
    await openMenu(page);
  });

  test('menu stays open after font size number input change', async ({ page }) => {
    await setNumberInput(page, '#inp-fontsize', '20');
    await expect(page.locator('#menu-dropdown')).toBeVisible();
  });

  test('menu stays open after font size slider change', async ({ page }) => {
    await setSlider(page, '#sld-fontsize', '20');
    await expect(page.locator('#menu-dropdown')).toBeVisible();
  });

  test('menu stays open after line height number input change', async ({ page }) => {
    await setNumberInput(page, '#inp-lineheight', '0.9');
    await expect(page.locator('#menu-dropdown')).toBeVisible();
  });

  test('menu stays open after line height slider change', async ({ page }) => {
    await setSlider(page, '#sld-lineheight', '0.9');
    await expect(page.locator('#menu-dropdown')).toBeVisible();
  });

  test('menu stays open after switching bundled font', async ({ page }) => {
    await page.waitForFunction(
      () => (document.getElementById('inp-font-bundled') as HTMLSelectElement)?.options.length > 1,
      { timeout: 5000 },
    );
    const otherFont = await page.evaluate(() => {
      const sel = document.getElementById('inp-font-bundled') as HTMLSelectElement;
      return Array.from(sel.options).find(o => !o.value.includes('Iosevka Nerd Font Mono'))?.value ?? '';
    });
    await page.selectOption('#inp-font-bundled', otherFont);
    await expect(page.locator('#menu-dropdown')).toBeVisible();
  });
});

