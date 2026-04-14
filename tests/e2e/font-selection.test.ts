/**
 * Font selection tests.
 *
 * Verifies that fonts chosen in the settings menu are actually applied to the
 * terminal — both at initial page load and when changed live via the menu.
 *
 * Three things must all be true for a font to render correctly:
 *   1. @font-face CSS was injected pointing at the right /fonts/ URL.
 *   2. The browser successfully fetched the font file (document.fonts.check).
 *   3. The terminal adapter received the correct fontFamily option.
 */
import { test, expect } from '@playwright/test';
import { type ChildProcess } from 'child_process';
import { mockApis, injectWsSpy, waitForWsOpen, startServer, killServer } from './helpers.js';

// Ports chosen to avoid conflicts with default (4023) and terminal-backends (4040-4042)
const PORTS = { xterm: 4050, 'xterm-dev': 4051 };

function startBackendServer(terminal: string, port: number): Promise<ChildProcess> {
  return startServer(
    'bun',
    ['src/server/index.ts', '--test', `--terminal=${terminal}`, `--listen=127.0.0.1:${port}`, '--no-auth', '--no-tls'],
  );
}

/** Returns the CSS injected by loadBundledFont(), or '' if absent. */
async function getBundledFontStyle(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => document.getElementById('bundled-font-style')?.textContent ?? '');
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

  test.beforeAll(async () => { server = await startBackendServer('xterm', PORTS.xterm); });
  test.afterAll(() => killServer(server));

  test.beforeEach(async ({ page, context }) => {
    await context.clearCookies();
    await page.addInitScript(() => {
      const settings = {
        fontSource: 'bundled',
        fontFamily: 'Iosevka Nerd Font Mono',
        fontSize: 18,
        lineHeight: 1.125
      };
      document.cookie = `tmux-web-settings=${encodeURIComponent(JSON.stringify(settings))}; path=/;`;
      localStorage.clear();
    });
    await injectWsSpy(page);
    await mockApis(page, ['main'], []);
    await page.goto(`${base}/main`);
    await waitForWsOpen(page);
    await waitForFontList(page);
  });

  test('default load: @font-face injected with correct woff2 URL', async ({ page }) => {
    const rule = await getBundledFontStyle(page);
    expect(rule).toContain('Iosevka Nerd Font Mono');
    expect(rule).toMatch(/\/fonts\/.+\.woff2/);
    expect(rule).toContain('format("woff2")');
  });

  test('default load: browser successfully loads the font file', async ({ page }) => {
    // Fails if the server returns 404 (e.g. due to URL-encoding not being decoded)
    await page.waitForFunction(
      () => document.fonts.check('18px "Iosevka Nerd Font Mono"'),
      { timeout: 5000 },
    );
    expect(await isFontLoaded(page, 'Iosevka Nerd Font Mono')).toBe(true);
  });

  test('default load: xterm receives Iosevka Nerd Font Mono as fontFamily', async ({ page }) => {
    const fontFamily = await getXtermFontFamily(page);
    expect(fontFamily).toContain('Iosevka Nerd Font Mono');
  });

  test('switching bundled font updates @font-face and xterm options', async ({ page }) => {
    await openMenu(page);

    // Pick the first font in the list that isn't the default
    const otherFont = await page.evaluate(() => {
      const sel = document.getElementById('inp-font-bundled') as HTMLSelectElement;
      return Array.from(sel.options).find(o => !o.value.includes('Iosevka Nerd Font Mono'))?.value ?? '';
    });
    expect(otherFont).toBeTruthy();

    await page.selectOption('#inp-font-bundled', otherFont);

    // @font-face must now reference the new font
    const rule = await getBundledFontStyle(page);
    expect(rule).toContain(otherFont);

    // xterm options must be updated
    const fontFamily = await getXtermFontFamily(page);
    expect(fontFamily).toContain(otherFont);
  });

  test('switching to Custom source: xterm gets the raw CSS font-family', async ({ page }) => {
    await openMenu(page);
    await page.selectOption('#inp-fontsource', 'custom');
    await page.fill('#inp-font', 'Fira Code, monospace');
    await page.locator('#inp-font').dispatchEvent('change');

    const fontFamily = await getXtermFontFamily(page);
    expect(fontFamily).toBe('Fira Code, monospace');
  });
});

// ---------------------------------------------------------------------------
// xterm-dev
// ---------------------------------------------------------------------------
test.describe('font selection: xterm-dev', () => {
  let server: ChildProcess;
  const base = `http://127.0.0.1:${PORTS['xterm-dev']}`;

  test.beforeAll(async () => { server = await startBackendServer('xterm-dev', PORTS['xterm-dev']); });
  test.afterAll(() => killServer(server));

  test.beforeEach(async ({ page, context }) => {
    await context.clearCookies();
    await page.addInitScript(() => {
      const settings = {
        fontSource: 'bundled',
        fontFamily: 'Iosevka Nerd Font Mono',
        fontSize: 18,
        lineHeight: 1.125
      };
      document.cookie = `tmux-web-settings=${encodeURIComponent(JSON.stringify(settings))}; path=/;`;
      localStorage.clear();
    });
    await injectWsSpy(page);
    await mockApis(page, ['main'], []);
    await page.goto(`${base}/main`);
    await waitForWsOpen(page);
    await waitForFontList(page);
  });

  test('default load: browser successfully loads the font file', async ({ page }) => {
    await page.waitForFunction(
      () => document.fonts.check('18px "Iosevka Nerd Font Mono"'),
      { timeout: 5000 },
    );
    expect(await isFontLoaded(page, 'Iosevka Nerd Font Mono')).toBe(true);
  });

  test('default load: xterm-dev receives Iosevka Nerd Font Mono as fontFamily', async ({ page }) => {
    const fontFamily = await getXtermFontFamily(page);
    expect(fontFamily).toContain('Iosevka Nerd Font Mono');
  });
});

// ---------------------------------------------------------------------------
// ghostty (uses the shared webServer from playwright.config.ts at port 4023)
// ---------------------------------------------------------------------------
test.describe('font selection: ghostty', () => {
  test.beforeEach(async ({ page, context }) => {
    await context.clearCookies();
    await page.addInitScript(() => {
      const settings = {
        fontSource: 'bundled',
        fontFamily: 'Iosevka Nerd Font Mono',
        fontSize: 18,
        lineHeight: 1.125
      };
      document.cookie = `tmux-web-settings=${encodeURIComponent(JSON.stringify(settings))}; path=/;`;
      localStorage.clear();
    });
    await injectWsSpy(page);
    await mockApis(page, ['main'], []);
    await page.goto('/main');
    await waitForWsOpen(page);
    await waitForFontList(page);
  });

  test('default load: @font-face injected with correct woff2 URL', async ({ page }) => {
    const rule = await getBundledFontStyle(page);
    expect(rule).toContain('Iosevka Nerd Font Mono');
    expect(rule).toMatch(/\/fonts\/.+\.woff2/);
  });

  test('default load: browser successfully loads the font file', async ({ page }) => {
    // ghostty-web expects a bare font name, not a CSS stack — this verifies the
    // @font-face declaration was injected and the woff2 was actually fetched.
    await page.waitForFunction(
      () => document.fonts.check('18px "Iosevka Nerd Font Mono"'),
      { timeout: 5000 },
    );
    expect(await isFontLoaded(page, 'Iosevka Nerd Font Mono')).toBe(true);
  });
});
