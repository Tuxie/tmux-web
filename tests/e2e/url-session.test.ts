import { test, expect } from '@playwright/test';
import { mockApis, injectWsSpy, waitForWsOpen, sendFromServer } from './helpers.js';

test('URL path becomes session name in WebSocket URL', async ({ page }) => {
  await injectWsSpy(page);
  await mockApis(page, ['myproject'], []);
  await page.goto('/myproject');
  await waitForWsOpen(page);
  expect(new URL(page.url()).pathname).toBe('/myproject');
});

test('session change from server updates URL via history.replaceState', async ({ page }) => {
  await injectWsSpy(page);
  await mockApis(page, ['main', 'other'], []);
  await page.goto('/main');
  await waitForWsOpen(page);

  await sendFromServer(page, { session: 'other' });

  await page.waitForFunction(
    () => window.location.pathname === '/other',
    { timeout: 3000 }
  );
  expect(new URL(page.url()).pathname).toBe('/other');
});

test('server-driven session switch applies the target session\'s stored settings', async ({ page }) => {
  // Pre-populate per-session settings: "main" uses Dracula, "other" uses Nord.
  await page.addInitScript(() => {
    localStorage.setItem('tmux-web-session:main', JSON.stringify({
      theme: 'Default', colours: 'Dracula', fontFamily: 'Iosevka Nerd Font Mono',
      fontSize: 18, spacing: 0.85, opacity: 0,
    }));
    localStorage.setItem('tmux-web-session:other', JSON.stringify({
      theme: 'Default', colours: 'Nord', fontFamily: 'Iosevka Nerd Font Mono',
      fontSize: 18, spacing: 0.85, opacity: 0,
    }));
  });
  await injectWsSpy(page);
  await mockApis(page, ['main', 'other'], []);
  await page.goto('/main');
  await waitForWsOpen(page);

  // Sanity: at /main the adapter shows Dracula's background colour.
  await page.waitForFunction(() =>
    (window as any).__adapter?.term?.options?.theme?.background === '#282a36',
    { timeout: 3000 }
  );

  // Simulate the server telling us the active tmux session is now "other"
  // (i.e. the user switched via a tmux keyboard shortcut, not the web UI).
  await sendFromServer(page, { session: 'other' });

  // The client should have loaded "other"'s stored settings and re-applied
  // them — Nord's background is #2e3440.
  await page.waitForFunction(() =>
    (window as any).__adapter?.term?.options?.theme?.background === '#2e3440',
    { timeout: 3000 }
  );
  await expect(page.locator('#inp-colours')).toHaveValue('Nord');
});
