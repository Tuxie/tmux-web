import { test, expect, type Page } from '@playwright/test';
import { startServer, killServer, createIsolatedTmux, hasTmux } from './helpers.js';

/** Cluster 13 / F4: native window.confirm() for the destructive
 *  kill-session and close-window paths is replaced by an in-DOM
 *  themed modal. This test verifies:
 *    - clicking "Kill session …" opens the modal (not a native dialog)
 *    - Cancel does not send the kill message
 *    - Confirm (Kill session) sends the kill message
 *  The modal must NOT trigger a native page.on('dialog') event — we
 *  fail the test if one fires.
 */

test.skip(!hasTmux(), 'tmux not available');

const PORT = 4127;

async function openSessionsMenu(page: Page): Promise<void> {
  await page.locator('#btn-session-menu').click();
  await page.waitForSelector('.tw-dd-sessions-menu:not([hidden])', { timeout: 3000 });
}

async function clickKillSessionRow(page: Page): Promise<void> {
  await page.evaluate(() => {
    // The Kill row is a tw-dropdown-item that is NOT a tw-dd-session-item.
    const items = Array.from(document.querySelectorAll(
      '.tw-dd-sessions-menu .tw-dropdown-item',
    )).filter(el => !(el.classList.contains('tw-dd-session-item')));
    const kill = items.find(el => /Kill session/.test(el.textContent ?? ''));
    if (!kill) throw new Error('Kill session row not found');
    (kill as HTMLElement).click();
  });
}

test('kill session click opens themed confirm-modal, not native confirm()', async ({ page }) => {
  const isolatedTmux = createIsolatedTmux('tw-kill-session-modal', ['main', 'doomed']);
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  let nativeDialog = false;
  page.on('dialog', async (d) => {
    nativeDialog = true;
    await d.dismiss();
  });

  try {
    server = await startServer('bun', [
      'src/server/index.ts',
      '--listen', `127.0.0.1:${PORT}`,
      '--no-auth', '--no-tls',
      '--tmux', isolatedTmux.wrapperPath,
    ]);

    await page.goto(`http://127.0.0.1:${PORT}/doomed`);
    await page.waitForFunction(() => !!(window as any).__adapter?.term, { timeout: 10000 });

    await openSessionsMenu(page);
    await clickKillSessionRow(page);

    // The themed modal — same backdrop class as clipboard-prompt — appears.
    const modal = page.locator('.tw-clip-prompt-backdrop');
    await expect(modal).toBeVisible({ timeout: 2000 });
    await expect(modal.locator('[role="dialog"]')).toBeVisible();
    expect(nativeDialog).toBe(false);

    // Cancel keeps the session alive.
    await modal.locator('button', { hasText: 'Cancel' }).click();
    await expect(modal).toHaveCount(0);
    expect(nativeDialog).toBe(false);

    // Verify the session is still there.
    const sessionsAfterCancel = isolatedTmux
      .tmux(['list-sessions', '-F', '#{session_name}'])
      .trim()
      .split('\n');
    expect(sessionsAfterCancel).toContain('doomed');

    // Re-open and confirm-kill.
    await openSessionsMenu(page);
    await clickKillSessionRow(page);
    await expect(page.locator('.tw-clip-prompt-backdrop')).toBeVisible({ timeout: 2000 });
    await page.locator('.tw-clip-prompt-backdrop button', { hasText: 'Kill session' }).click();
    await expect(page.locator('.tw-clip-prompt-backdrop')).toHaveCount(0);
    expect(nativeDialog).toBe(false);

    // Wait for the server-side kill to land — list-sessions should no longer
    // include 'doomed'.
    await expect.poll(() => {
      try {
        return isolatedTmux
          .tmux(['list-sessions', '-F', '#{session_name}'])
          .trim()
          .split('\n');
      } catch {
        return [];
      }
    }, { timeout: 5000 }).not.toContain('doomed');
  } finally {
    if (server) killServer(server);
    isolatedTmux.cleanup();
  }
});
