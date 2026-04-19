/**
 * Font selection tests.
 *
 * Verifies that fonts chosen in the settings menu are actually applied to the
 * terminal — both at initial page load and when changed live via the menu.
 *
 * Two things must both be true for a font to render correctly:
 *   1. The browser successfully fetched the font file (document.fonts.check).
 *   2. The terminal adapter received the correct fontFamily option.
 */
import { test, expect } from '@playwright/test';
import { type ChildProcess } from 'child_process';
import { mockApis, injectWsSpy, waitForWsOpen, startServer, killServer } from './helpers.js';
import { FX } from './fixture-themes.js';

// Ports chosen to avoid conflicts with default (4023) and terminal-backends (4040-4042)
const PORTS = { xterm: 4050 };

function startXtermServer(port: number): Promise<ChildProcess> {
  return startServer(
    'bun',
    ['src/server/index.ts', '--test', `--listen=127.0.0.1:${port}`, '--no-auth', '--no-tls'],
  );
}

/** Returns true when the browser has loaded the named font at 18px. */
async function isFontLoaded(page: import('@playwright/test').Page, name: string): Promise<boolean> {
  return page.evaluate((n) => document.fonts.check(`18px "${n}"`), name);
}

/** Returns term.options.fontFamily from the xterm adapter (empty string if unavailable). */
async function getXtermFontFamily(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => (window as any).__adapter?.term?.options?.fontFamily ?? '');
}

/** Reveals the topbar and opens the settings menu. */
async function openMenu(page: import('@playwright/test').Page): Promise<void> {
  await page.mouse.move(640, 10);
  await page.click('#btn-menu');
  await expect(page.locator('#menu-dropdown')).toBeVisible();
}

/** Wait for the bundled font dropdown to be populated from /api/fonts. */
async function waitForFontList(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(
    () => (document.getElementById('inp-font-bundled') as HTMLSelectElement)?.options.length > 0,
    { timeout: 5000 },
  );
}

// ---------------------------------------------------------------------------
// xterm
// ---------------------------------------------------------------------------
test.describe('font selection: xterm', () => {
  let server: ChildProcess;
  const base = `http://127.0.0.1:${PORTS.xterm}`;

  test.beforeAll(async () => { server = await startXtermServer(PORTS.xterm); });
  test.afterAll(() => killServer(server));

  test.beforeEach(async ({ page, context }) => {
    await context.clearCookies();
    await page.addInitScript((primaryFont) => {
      const settings = {
        fontFamily: primaryFont,
        fontSize: 18,
        spacing: 1.125
      };
      document.cookie = `tmux-web-settings=${encodeURIComponent(JSON.stringify(settings))}; path=/;`;
      localStorage.clear();
    }, FX.fonts.primary);
    await injectWsSpy(page);
    await mockApis(page, ['main'], []);
    await page.goto(`${base}/main`);
    await waitForWsOpen(page);
    await waitForFontList(page);
  });

  test('default load: browser successfully loads the font file', async ({ page }) => {
    await page.waitForFunction(
      (name) => document.fonts.check(`18px "${name}"`),
      FX.fonts.primary,
      { timeout: 5000 },
    );
    expect(await isFontLoaded(page, FX.fonts.primary)).toBe(true);
  });

  test('default load: xterm receives the primary fixture font as fontFamily', async ({ page }) => {
    const fontFamily = await getXtermFontFamily(page);
    expect(fontFamily).toContain(FX.fonts.primary);
  });

  test('switching bundled font updates @font-face and xterm options', async ({ page }) => {
    await openMenu(page);

    // Pick the first font in the list that isn't the primary one.
    const otherFont = await page.evaluate((primary) => {
      const sel = document.getElementById('inp-font-bundled') as HTMLSelectElement;
      return Array.from(sel.options).find(o => !o.value.includes(primary))?.value ?? '';
    }, FX.fonts.primary);
    expect(otherFont).toBeTruthy();

    await page.selectOption('#inp-font-bundled', otherFont);

    // xterm options must be updated
    const fontFamily = await getXtermFontFamily(page);
    expect(fontFamily).toContain(otherFont);
  });
});
