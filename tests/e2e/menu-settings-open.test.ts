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
const PORT_XTERM_DEV = 4061;

function startBackendServer(terminal: string, port: number): Promise<ChildProcess> {
  return startServer(
    'bun',
    ['src/server/index.ts', '--test', `--terminal=${terminal}`, `--listen=127.0.0.1:${port}`, '--no-auth'],
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

  test.beforeAll(async () => { server = await startBackendServer('xterm', PORT_XTERM); });
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
      return Array.from(sel.options).find(o => !o.value.includes('IosevkaNerdFontMono-Regular'))?.value ?? '';
    });
    await page.selectOption('#inp-font-bundled', otherFont);
    await expect(page.locator('#menu-dropdown')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// xterm-dev — same in-place behaviour
// ---------------------------------------------------------------------------
test.describe('menu stays open during settings changes: xterm-dev', () => {
  let server: ChildProcess;
  const base = `http://127.0.0.1:${PORT_XTERM_DEV}`;

  test.beforeAll(async () => { server = await startBackendServer('xterm-dev', PORT_XTERM_DEV); });
  test.afterAll(() => killServer(server));

  test.beforeEach(async ({ page }) => {
    await injectWsSpy(page);
    await mockApis(page, ['main'], []);
    await page.goto(`${base}/main`);
    await waitForWsOpen(page);
    await openMenu(page);
  });

  test('menu stays open after font size change', async ({ page }) => {
    await setNumberInput(page, '#inp-fontsize', '20');
    await expect(page.locator('#menu-dropdown')).toBeVisible();
  });

  test('menu stays open after line height change', async ({ page }) => {
    await setNumberInput(page, '#inp-lineheight', '0.9');
    await expect(page.locator('#menu-dropdown')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// ghostty — settings change triggers location.reload(); the menu must
// reopen automatically after the page comes back up.
// ---------------------------------------------------------------------------
test.describe('menu stays open during settings changes: ghostty', () => {
  test.beforeEach(async ({ page }) => {
    await injectWsSpy(page);
    await mockApis(page, ['main'], []);
    await page.goto('/main');
    await waitForWsOpen(page);
    await openMenu(page);
  });

  test('menu reopens after page reload triggered by font size change', async ({ page }) => {
    // Font size change on ghostty triggers location.reload() — the menu must
    // reopen on the reloaded page.
    await page.route('/api/sessions', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '["main"]' })
    );
    await page.route('/api/windows**', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    );

    const navigationPromise = page.waitForNavigation({ timeout: 10000 });
    await setNumberInput(page, '#inp-fontsize', '20');
    await navigationPromise;

    // After reload the menu must be visible again
    await expect(page.locator('#menu-dropdown')).toBeVisible({ timeout: 5000 });
  });

  test('menu reopens after page reload triggered by line height change', async ({ page }) => {
    await page.route('/api/sessions', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '["main"]' })
    );
    await page.route('/api/windows**', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    );

    const navigationPromise = page.waitForNavigation({ timeout: 10000 });
    await setNumberInput(page, '#inp-lineheight', '0.9');
    await navigationPromise;

    await expect(page.locator('#menu-dropdown')).toBeVisible({ timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// ghostty — terminal sizing after settings-change reload with pinned topbar.
// The terminal must fit within the viewport after reload, not extend below it.
// ---------------------------------------------------------------------------
test.describe('terminal size after reload with pinned topbar: ghostty', () => {
  test('terminal fits viewport after settings-change reload', async ({ page }) => {
    // Pin the topbar before page load
    await page.addInitScript(() => localStorage.setItem('topbar-autohide', 'false'));
    await injectWsSpy(page);
    await mockApis(page, ['main'], []);
    await page.goto('/main');
    await waitForWsOpen(page);

    const viewport = page.viewportSize()!;

    // Sanity check: terminal fits before the reload
    const before = await page.locator('#terminal').boundingBox();
    expect(before!.y + before!.height).toBeLessThanOrEqual(viewport.height);

    // Open menu and change font size → triggers location.reload() on ghostty
    await openMenu(page);
    const navigationPromise = page.waitForNavigation({ timeout: 10000 });
    await setNumberInput(page, '#inp-fontsize', '20');
    await navigationPromise;

    // Wait for terminal to fully initialise after reload
    await page.waitForFunction(
      () => (window as any).__wsSent?.some((m: string) => m.startsWith('{"type":"resize"')),
      { timeout: 10000 },
    );

    // Terminal container must fit within the viewport
    const after = await page.locator('#terminal').boundingBox();
    expect(after!.y + after!.height).toBeLessThanOrEqual(viewport.height);

    // The page itself must not scroll — no content pushed below the fold
    const scrollOverflow = await page.evaluate(
      () => document.documentElement.scrollHeight - document.documentElement.clientHeight,
    );
    expect(scrollOverflow).toBe(0);
  });
});
