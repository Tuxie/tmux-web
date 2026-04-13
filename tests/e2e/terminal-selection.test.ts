/**
 * Verify that users can switch between terminal backends (ghostty, xterm, xterm-dev)
 * in the configuration menu without restarting the server.
 *
 * Switching terminals causes a page reload with the new terminal backend.
 */
import { test, expect } from '@playwright/test';
import { type ChildProcess } from 'child_process';
import { mockApis, injectWsSpy, waitForWsOpen, startServer, killServer } from './helpers.js';

test.describe('terminal backend selection', () => {
  test.beforeEach(async ({ page }) => {
    await injectWsSpy(page);
    await mockApis(page, ['main'], []);
  });

  test('menu displays current terminal backend', async ({ page }) => {
    await page.goto('/main');
    await waitForWsOpen(page);

    // Get the current terminal from config
    const currentTerminal = await page.evaluate(() => (window as any).__TMUX_WEB_CONFIG.terminal);
    console.log('Current terminal:', currentTerminal);

    // Open menu
    await page.mouse.move(640, 10);
    await page.click('#btn-menu');
    await expect(page.locator('#menu-dropdown')).toBeVisible();

    // Check that terminal selector exists
    const terminalSelect = page.locator('#inp-terminal');
    await expect(terminalSelect).toBeVisible();

    // Check that current terminal is selected
    const selectedValue = await terminalSelect.inputValue();
    expect(selectedValue).toBe(currentTerminal);
  });

  test('switching terminal reloads page with new backend', async ({ page }) => {
    await page.goto('/main');
    await waitForWsOpen(page);

    const currentTerminal = await page.evaluate(() => (window as any).__TMUX_WEB_CONFIG.terminal);
    console.log('Current terminal:', currentTerminal);

    // Determine a different terminal to switch to
    const newTerminal = currentTerminal === 'ghostty' ? 'xterm' : 'ghostty';
    console.log('Switching to:', newTerminal);

    // Open menu and switch terminal
    await page.mouse.move(640, 10);
    await page.click('#btn-menu');
    await expect(page.locator('#menu-dropdown')).toBeVisible();

    // Wait for navigation when terminal is changed
    const navPromise = page.waitForNavigation({ timeout: 10000 });
    await page.selectOption('#inp-terminal', newTerminal);
    await navPromise;

    // Wait for adapter to be ready
    await page.waitForFunction(() => (window as any).__adapter !== undefined, { timeout: 10000 });
    await waitForWsOpen(page);

    // Verify the terminal backend changed
    const terminalAfter = await page.evaluate(() => (window as any).__TMUX_WEB_CONFIG.terminal);
    expect(terminalAfter).toBe(newTerminal);
  });

  test('terminal selection is persisted in cookie', async ({ page }) => {
    await page.goto('/main');
    await waitForWsOpen(page);

    const currentTerminal = await page.evaluate(() => (window as any).__TMUX_WEB_CONFIG.terminal);
    const newTerminal = currentTerminal === 'ghostty' ? 'xterm' : 'ghostty';

    // Open menu and switch terminal
    await page.mouse.move(640, 10);
    await page.click('#btn-menu');
    const navPromise = page.waitForNavigation({ timeout: 10000 });
    await page.selectOption('#inp-terminal', newTerminal);
    await navPromise;

    await page.waitForFunction(() => (window as any).__adapter !== undefined, { timeout: 10000 });
    await waitForWsOpen(page);

    // Verify cookie was updated
    const storedTerminal = await page.evaluate(() => {
      const name = 'tmux-web-settings=';
      const decodedCookie = decodeURIComponent(document.cookie);
      const cookies = decodedCookie.split(';');
      for (const cookie of cookies) {
        const trimmed = cookie.trim();
        if (trimmed.startsWith(name)) {
          try {
            const settings = JSON.parse(trimmed.substring(name.length));
            return settings.terminal;
          } catch {}
        }
      }
      return null;
    });
    expect(storedTerminal).toBe(newTerminal);
  });

  test('page reload preserves terminal via URL query parameter', async ({ page }) => {
    await page.goto('/main');
    await waitForWsOpen(page);

    const currentTerminal = await page.evaluate(() => (window as any).__TMUX_WEB_CONFIG.terminal);
    const newTerminal = currentTerminal === 'ghostty' ? 'xterm' : 'ghostty';

    // Switch terminal via menu (which sets URL query parameter)
    await page.mouse.move(640, 10);
    await page.click('#btn-menu');
    const navPromise = page.waitForNavigation({ timeout: 10000 });
    await page.selectOption('#inp-terminal', newTerminal);
    await navPromise;

    await page.waitForFunction(() => (window as any).__adapter !== undefined, { timeout: 10000 });
    await waitForWsOpen(page);

    // Verify URL has the query parameter
    let urlAfterSwitch = page.url();
    expect(urlAfterSwitch).toContain(`?terminal=${newTerminal}`);

    // Re-apply mocks for the new page
    await injectWsSpy(page);
    await mockApis(page, ['main'], []);
    await waitForWsOpen(page);

    // Reload page
    const reloadPromise = page.waitForNavigation({ timeout: 10000 });
    await page.reload();
    await reloadPromise;

    await page.waitForFunction(() => (window as any).__adapter !== undefined, { timeout: 10000 });
    await waitForWsOpen(page);

    // Verify the terminal is still the switched one
    const terminalAfterReload = await page.evaluate(() => (window as any).__TMUX_WEB_CONFIG.terminal);
    expect(terminalAfterReload).toBe(newTerminal);

    // Verify URL still has the query parameter
    const urlAfterReload = page.url();
    expect(urlAfterReload).toContain(`?terminal=${newTerminal}`);
  });

  test('terminal selector shows all available options', async ({ page }) => {
    await page.goto('/main');
    await waitForWsOpen(page);

    // Open menu
    await page.mouse.move(640, 10);
    await page.click('#btn-menu');
    await expect(page.locator('#menu-dropdown')).toBeVisible();

    // Get all options in the terminal selector
    const terminalSelect = page.locator('#inp-terminal');
    const options = await terminalSelect.locator('option').all();
    const optionValues = await Promise.all(options.map(opt => opt.getAttribute('value')));

    // Should have available terminals
    expect(optionValues.sort()).toEqual(['ghostty', 'xterm'].sort());
  });

  test('terminal selector displays versions', async ({ page }) => {
    await page.goto('/main');
    await waitForWsOpen(page);

    // Open menu
    await page.mouse.move(640, 10);
    await page.click('#btn-menu');
    await expect(page.locator('#menu-dropdown')).toBeVisible();

    // Get all options in the terminal selector
    const terminalSelect = page.locator('#inp-terminal');
    const options = await terminalSelect.locator('option').all();
    const optionTexts = await Promise.all(options.map(opt => opt.textContent()));

    // Verify we have version info for each terminal
    // xterm.js: "xterm.js v6.0.0" or "xterm.js (HEAD, ...)"
    expect(optionTexts.some(text => /xterm\.js (v\d+\.\d+\.\d+|\(HEAD, .+\))/.test(text || ''))).toBe(true);

    // ghostty: "ghostty-web v0.4.0"
    expect(optionTexts.some(text => /ghostty-web v\d+\.\d+\.\d+/.test(text || ''))).toBe(true);
  });

  test('terminal remains usable after switching: session list populated', async ({ page }) => {
    await page.goto('/main');
    await waitForWsOpen(page);

    const currentTerminal = await page.evaluate(() => (window as any).__TMUX_WEB_CONFIG.terminal);
    const newTerminal = currentTerminal === 'ghostty' ? 'xterm' : 'ghostty';

    // Switch terminal
    await page.mouse.move(640, 10);
    await page.click('#btn-menu');
    const navPromise = page.waitForNavigation({ timeout: 10000 });
    await page.selectOption('#inp-terminal', newTerminal);
    await navPromise;

    // Re-apply mocks and WebSocket spy after reload
    await injectWsSpy(page);
    await mockApis(page, ['main'], []);
    await waitForWsOpen(page);

    // Verify session dropdown is populated
    const sessionSelect = page.locator('#session-select');
    const options = await sessionSelect.locator('option').all();
    expect(options.length).toBeGreaterThan(0);

    // Verify main session is present
    const sessionValues = await Promise.all(options.map(opt => opt.textContent()));
    expect(sessionValues).toContain('main');
  });

  test('terminal remains usable after switching: configuration menu opens', async ({ page }) => {
    await page.goto('/main');
    await waitForWsOpen(page);

    const currentTerminal = await page.evaluate(() => (window as any).__TMUX_WEB_CONFIG.terminal);
    const newTerminal = currentTerminal === 'ghostty' ? 'xterm' : 'ghostty';

    // Switch terminal
    await page.mouse.move(640, 10);
    await page.click('#btn-menu');
    const navPromise = page.waitForNavigation({ timeout: 10000 });
    await page.selectOption('#inp-terminal', newTerminal);
    await navPromise;

    // Re-apply mocks and WebSocket spy
    await injectWsSpy(page);
    await mockApis(page, ['main'], []);
    await waitForWsOpen(page);

    // Verify menu can be opened
    await page.mouse.move(640, 10);
    await page.click('#btn-menu');
    await expect(page.locator('#menu-dropdown')).toBeVisible();

    // Verify terminal selector is still there
    const terminalSelect = page.locator('#inp-terminal');
    await expect(terminalSelect).toBeVisible();
    const currentValue = await terminalSelect.inputValue();
    expect(currentValue).toBe(newTerminal);
  });

  test('terminal remains usable after switching: WebSocket connected', async ({ page }) => {
    await page.goto('/main');
    await waitForWsOpen(page);

    const currentTerminal = await page.evaluate(() => (window as any).__TMUX_WEB_CONFIG.terminal);
    const newTerminal = currentTerminal === 'ghostty' ? 'xterm' : 'ghostty';

    // Switch terminal
    await page.mouse.move(640, 10);
    await page.click('#btn-menu');
    const navPromise = page.waitForNavigation({ timeout: 10000 });
    await page.selectOption('#inp-terminal', newTerminal);
    await navPromise;

    // Re-apply mocks and WebSocket spy
    await injectWsSpy(page);
    await mockApis(page, ['main'], []);
    await waitForWsOpen(page);

    // Verify WebSocket is connected and adapter exists
    const wsConnected = await page.evaluate(() => {
      const adapter = (window as any).__adapter;
      const ws = (window as any).__wsInstance;
      return {
        adapterExists: !!adapter,
        wsExists: !!ws,
        wsReadyState: ws?.readyState,
      };
    });

    expect(wsConnected.adapterExists).toBe(true);
    expect(wsConnected.wsExists).toBe(true);
    expect(wsConnected.wsReadyState).toBe(1); // 1 = OPEN
  });

  test('terminal remains usable after switching: can interact with terminal', async ({ page }) => {
    await page.goto('/main');
    await waitForWsOpen(page);

    const currentTerminal = await page.evaluate(() => (window as any).__TMUX_WEB_CONFIG.terminal);
    const newTerminal = currentTerminal === 'ghostty' ? 'xterm' : 'ghostty';

    // Switch terminal
    await page.mouse.move(640, 10);
    await page.click('#btn-menu');
    const navPromise = page.waitForNavigation({ timeout: 10000 });
    await page.selectOption('#inp-terminal', newTerminal);
    await navPromise;

    // Re-apply mocks and WebSocket spy
    await injectWsSpy(page);
    await mockApis(page, ['main'], []);
    await waitForWsOpen(page);

    // Send mock data to terminal
    const testText = 'Test message after terminal switch\r\n';
    await page.evaluate((text) => (window as any).__mockWsReceive(text), testText);

    // Verify text appears in terminal
    const terminalContent = newTerminal === 'ghostty'
      ? page.locator('#terminal canvas')
      : page.locator('#terminal .xterm-rows');

    await expect(terminalContent).toBeVisible({ timeout: 5000 });
  });
});

test.describe('terminal backend selection with real server', () => {
  let server: ChildProcess;
  const PORT = 4100;
  const BASE_URL = `http://127.0.0.1:${PORT}`;

  test.beforeAll(async () => {
    server = await startServer(
      'bun',
      ['src/server/index.ts', '--test', `--listen=127.0.0.1:${PORT}`, '--no-auth', '--terminal=ghostty'],
    );
  });

  test.afterAll(() => killServer(server));

  test('can switch terminal and session list appears without re-mocking', async ({ page }) => {
    await injectWsSpy(page);
    await page.goto(`${BASE_URL}/main`);
    await waitForWsOpen(page);

    // Verify initial state
    const initialTerminal = await page.evaluate(() => (window as any).__TMUX_WEB_CONFIG.terminal);
    expect(initialTerminal).toBe('ghostty');

    // Get sessions before switch
    const sessionsBefore = await page.locator('#session-select option').all();
    console.log('Sessions before switch:', sessionsBefore.length);

    // Switch terminal to xterm
    await page.mouse.move(640, 10);
    await page.click('#btn-menu');
    const navPromise = page.waitForNavigation({ timeout: 10000 });
    await page.selectOption('#inp-terminal', 'xterm');
    await navPromise;

    // IMPORTANT: DO NOT re-apply mocks - let real server handle the APIs
    // Re-inject WebSocket spy for new page
    await injectWsSpy(page);
    await waitForWsOpen(page);

    // Verify terminal changed
    const terminalAfter = await page.evaluate(() => (window as any).__TMUX_WEB_CONFIG.terminal);
    expect(terminalAfter).toBe('xterm');

    // Verify adapter exists
    const adapterExists = await page.evaluate(() => (window as any).__adapter !== undefined);
    expect(adapterExists).toBe(true);

    // Verify sessions can be loaded (without mocks, real API)
    const sessionsAfter = await page.locator('#session-select option').all();
    console.log('Sessions after switch:', sessionsAfter.length);
    // Real server will have sessions, so length should be > 0
    expect(sessionsAfter.length).toBeGreaterThan(0);
  });

  test('no infinite redirect loop on page load', async ({ page }) => {
    // First, establish a normal session by switching terminals
    await injectWsSpy(page);
    await page.goto(`${BASE_URL}/main`);
    await waitForWsOpen(page);

    const initialTerminal = await page.evaluate(() => (window as any).__TMUX_WEB_CONFIG.terminal);

    // Switch to a different terminal
    const newTerminal = initialTerminal === 'ghostty' ? 'xterm' : 'ghostty';
    await page.mouse.move(640, 10);
    await page.click('#btn-menu');
    const navPromise = page.waitForNavigation({ timeout: 10000 });
    await page.selectOption('#inp-terminal', newTerminal);
    await navPromise;

    // Re-inject spy
    await injectWsSpy(page);
    await waitForWsOpen(page);

    // Verify terminal switched
    const terminalAfterSwitch = await page.evaluate(() => (window as any).__TMUX_WEB_CONFIG.terminal);
    expect(terminalAfterSwitch).toBe(newTerminal);

    // Now reload the page
    const reloadPromise = page.waitForLoadState();
    await page.reload();
    await reloadPromise;

    // Re-inject spy after reload
    await injectWsSpy(page);
    await waitForWsOpen(page);

    // Verify it still loaded the switched terminal without redirect loops
    const terminalAfterReload = await page.evaluate(() => (window as any).__TMUX_WEB_CONFIG.terminal);
    expect(terminalAfterReload).toBe(newTerminal);

    // Verify URL doesn't keep changing (no redirect loop)
    const finalUrl = page.url();
    expect(finalUrl).toContain(`?terminal=${newTerminal}`);
  });
});

test.describe('terminal backend selection starting with xterm', () => {
  let server: ChildProcess;
  const PORT = 4101;
  const BASE_URL = `http://127.0.0.1:${PORT}`;

  test.beforeAll(async () => {
    server = await startServer(
      'bun',
      ['src/server/index.ts', '--test', `--listen=127.0.0.1:${PORT}`, '--no-auth', '--terminal=xterm'],
    );
  });

  test.afterAll(() => killServer(server));

  test('can switch from xterm to ghostty', async ({ page }) => {
    await injectWsSpy(page);
    await page.goto(`${BASE_URL}/main`);
    await waitForWsOpen(page);

    // Verify initial state
    const initialTerminal = await page.evaluate(() => (window as any).__TMUX_WEB_CONFIG.terminal);
    expect(initialTerminal).toBe('xterm');

    // Switch terminal to ghostty
    await page.mouse.move(640, 10);
    await page.click('#btn-menu');
    const navPromise = page.waitForNavigation({ timeout: 10000 });
    await page.selectOption('#inp-terminal', 'ghostty');
    await navPromise;

    // Re-inject WebSocket spy for new page
    await injectWsSpy(page);
    await waitForWsOpen(page);

    // Verify terminal changed
    const terminalAfter = await page.evaluate(() => (window as any).__TMUX_WEB_CONFIG.terminal);
    expect(terminalAfter).toBe('ghostty');

    // Verify adapter exists
    const adapterExists = await page.evaluate(() => (window as any).__adapter !== undefined);
    expect(adapterExists).toBe(true);

    // Verify sessions can be loaded
    const sessions = await page.locator('#session-select option').all();
    expect(sessions.length).toBeGreaterThan(0);

    // Verify menu can still be opened
    await page.mouse.move(640, 10);
    await page.click('#btn-menu');
    await expect(page.locator('#menu-dropdown')).toBeVisible();
  });
});

test.describe('terminal backend selection starting with xterm-dev', () => {
  let server: ChildProcess;
  const PORT = 4102;
  const BASE_URL = `http://127.0.0.1:${PORT}`;

  test.beforeAll(async () => {
    server = await startServer(
      'bun',
      ['src/server/index.ts', '--test', `--listen=127.0.0.1:${PORT}`, '--no-auth', '--terminal=xterm-dev'],
    );
  });

  test.afterAll(() => killServer(server));

  test('can switch from xterm-dev to ghostty', async ({ page }) => {
    await injectWsSpy(page);
    await page.goto(`${BASE_URL}/main`);
    await waitForWsOpen(page);

    // Verify initial state
    const initialTerminal = await page.evaluate(() => (window as any).__TMUX_WEB_CONFIG.terminal);
    expect(initialTerminal).toBe('xterm-dev');

    // Switch terminal to ghostty
    await page.mouse.move(640, 10);
    await page.click('#btn-menu');
    const navPromise = page.waitForNavigation({ timeout: 10000 });
    await page.selectOption('#inp-terminal', 'ghostty');
    await navPromise;

    // Re-inject WebSocket spy for new page
    await injectWsSpy(page);
    await waitForWsOpen(page);

    // Verify terminal changed
    const terminalAfter = await page.evaluate(() => (window as any).__TMUX_WEB_CONFIG.terminal);
    expect(terminalAfter).toBe('ghostty');

    // Verify adapter exists
    const adapterExists = await page.evaluate(() => (window as any).__adapter !== undefined);
    expect(adapterExists).toBe(true);

    // Verify sessions can be loaded
    const sessions = await page.locator('#session-select option').all();
    expect(sessions.length).toBeGreaterThan(0);

    // Verify menu can still be opened
    await page.mouse.move(640, 10);
    await page.click('#btn-menu');
    await expect(page.locator('#menu-dropdown')).toBeVisible();
  });
});
