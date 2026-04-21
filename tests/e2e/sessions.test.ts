import { test, expect } from '@playwright/test';
import { mockApis, mockSessionStore, injectWsSpy, waitForWsOpen } from './helpers.js';
import { fixtureSessionSettings } from './fixture-themes.js';

test('session button shows current session name', async ({ page }) => {
  await injectWsSpy(page);
  await mockApis(page, ['main', 'dev', 'work'], []);
  await page.goto('/main');
  await waitForWsOpen(page);
  await expect(page.locator('#tb-session-name')).toHaveText('main');
});

test('opening session button lists sessions with the current one checked + Kill row', async ({ page }) => {
  await injectWsSpy(page);
  await mockApis(page, ['main', 'dev', 'work'], []);
  await page.goto('/main');
  await waitForWsOpen(page);
  await page.click('#btn-session-menu');
  const menu = page.locator('.tw-dropdown-menu.tw-dd-sessions-menu:not([hidden])');
  const items = menu.locator('.tw-dropdown-item');
  // 3 session rows + 1 Kill row
  await expect(items).toHaveCount(4);
  const names = await menu.locator('.tw-dd-session-name').allTextContents();
  // Sessions are sorted case-insensitively by name.
  expect(names).toEqual(['dev', 'main', 'work']);
  expect(await items.nth(3).textContent()).toContain('Kill session main');
  // The current session ('main') is second in the sorted list.
  await expect(items.nth(0)).not.toHaveClass(/\bcurrent\b/);
  await expect(items.nth(1)).toHaveClass(/\bcurrent\b/);
  await expect(items.nth(2)).not.toHaveClass(/\bcurrent\b/);
  // Input rows for Name and New session
  const labels = await menu.locator('.tw-menu-label').allTextContents();
  expect(labels).toEqual(['Name:', 'New session:']);
});

test('session menu shows green/red status dots and lists stored-but-stopped sessions', async ({ page }) => {
  await injectWsSpy(page);
  await mockApis(page, ['main', 'dev'], []);
  // Persisted store includes a session ('archived') that is not in the
  // running list; it must still appear, with a red (stopped) dot.
  await page.route('**/api/session-settings', route =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        version: 1,
        lastActive: 'main',
        sessions: {
          main: fixtureSessionSettings(),
          archived: fixtureSessionSettings(),
        },
      }),
    })
  );
  await page.goto('/main');
  await waitForWsOpen(page);
  await page.click('#btn-session-menu');
  const menu = page.locator('.tw-dropdown-menu.tw-dd-sessions-menu:not([hidden])');
  const rows = menu.locator('.tw-dd-session-item');
  await expect(rows).toHaveCount(3);
  // All three entries (running + stored-but-not-running), sorted
  // case-insensitively by name.
  const names = await rows.locator('.tw-dd-session-name').allTextContents();
  expect(names).toEqual(['archived', 'dev', 'main']);
  // Status dot classes: archived (stopped), dev (running), main (running).
  await expect(rows.nth(0).locator('.tw-dd-session-status')).toHaveClass(/\bstopped\b/);
  await expect(rows.nth(1).locator('.tw-dd-session-status')).toHaveClass(/\brunning\b/);
  await expect(rows.nth(2).locator('.tw-dd-session-status')).toHaveClass(/\brunning\b/);
});

test('selecting a session from the menu navigates to its URL', async ({ page }) => {
  await injectWsSpy(page);
  await mockApis(page, ['main', 'dev', 'work'], []);
  await page.goto('/main');
  await waitForWsOpen(page);
  await page.click('#btn-session-menu');
  await Promise.all([
    page.waitForURL('**/dev'),
    page.locator('.tw-dropdown-menu.tw-dd-sessions-menu:not([hidden]) .tw-dropdown-item', { hasText: 'dev' }).click(),
  ]);
  expect(new URL(page.url()).pathname).toBe('/dev');
});

test('switching session does not trigger a full page reload', async ({ page }) => {
  await injectWsSpy(page);
  await mockApis(page, ['main', 'dev'], []);
  await page.goto('/main');
  await waitForWsOpen(page);
  // Tag the window — a full reload would wipe this; pushState/replaceState
  // would preserve it (and so will fullscreen state).
  await page.evaluate(() => { (window as any).__notReloaded = 'sentinel-42'; });
  await page.click('#btn-session-menu');
  await Promise.all([
    page.waitForURL('**/dev'),
    page.locator('.tw-dropdown-menu.tw-dd-sessions-menu:not([hidden]) .tw-dropdown-item', { hasText: 'dev' }).click(),
  ]);
  const sentinel = await page.evaluate(() => (window as any).__notReloaded);
  expect(sentinel).toBe('sentinel-42');
});

test('Name input in session menu renames the current session on Enter', async ({ page }) => {
  await injectWsSpy(page);
  await mockApis(page, ['main'], []);
  await page.goto('/main');
  await waitForWsOpen(page);
  await page.evaluate(() => { (window as any).__wsSent = []; });
  await page.click('#btn-session-menu');
  const nameInput = page.locator('.tw-dd-sessions-menu .tw-menu-row', { hasText: 'Name:' }).locator('input');
  await expect(nameInput).toHaveValue('main');
  await nameInput.fill('project');
  await nameInput.press('Enter');
  const sent: string[] = await page.evaluate(() => (window as any).__wsSent);
  expect(sent).toContain(JSON.stringify({ type: 'session', action: 'rename', name: 'project' }));
});

test('New session input navigates to the entered name', async ({ page }) => {
  await injectWsSpy(page);
  await mockApis(page, ['main'], []);
  await page.goto('/main');
  await waitForWsOpen(page);
  await page.click('#btn-session-menu');
  const newInput = page.locator('.tw-dd-sessions-menu .tw-menu-row', { hasText: 'New session:' }).locator('input');
  await newInput.fill('scratch');
  await Promise.all([
    page.waitForURL('**/scratch'),
    newInput.press('Enter'),
  ]);
  expect(new URL(page.url()).pathname).toBe('/scratch');
});

test('Kill session row confirms and sends kill on accept', async ({ page }) => {
  await injectWsSpy(page);
  await mockApis(page, ['main'], []);
  await page.goto('/main');
  await waitForWsOpen(page);
  await page.evaluate(() => { (window as any).__wsSent = []; });
  page.once('dialog', d => d.accept());
  await page.click('#btn-session-menu');
  await page.locator('.tw-dd-sessions-menu .tw-dropdown-item', { hasText: 'Kill session' }).click();
  const sent: string[] = await page.evaluate(() => (window as any).__wsSent);
  expect(sent).toContain(JSON.stringify({ type: 'session', action: 'kill' }));
});

test('right-click on session button opens the same session menu as left-click', async ({ page }) => {
  await injectWsSpy(page);
  await mockApis(page, ['main', 'dev'], []);
  await page.goto('/main');
  await waitForWsOpen(page);
  const menu = page.locator('.tw-dropdown-menu.tw-dd-sessions-menu');
  await expect(menu).toBeHidden();

  await page.locator('#btn-session-menu').click({ button: 'right' });
  await expect(menu).toBeVisible();
  // Rich menu body: session list + Name/New session inputs + Kill row.
  await expect(menu.locator('.tw-dropdown-item')).toHaveCount(3); // 2 sessions + kill
  expect(await menu.locator('.tw-menu-label').allTextContents()).toEqual(['Name:', 'New session:']);

  // No legacy .tw-dd-context-session popup exists.
  await expect(page.locator('.tw-dd-context-session')).toHaveCount(0);

  // Right-clicking again toggles it closed.
  await page.locator('#btn-session-menu').click({ button: 'right' });
  await expect(menu).toBeHidden();
});

test('session button has .open class while dropdown is showing', async ({ page }) => {
  await injectWsSpy(page);
  await mockApis(page, ['main'], []);
  await page.goto('/main');
  await waitForWsOpen(page);
  const btn = page.locator('#btn-session-menu');
  await expect(btn).not.toHaveClass(/\bopen\b/);
  await btn.click();
  await expect(btn).toHaveClass(/\bopen\b/);
  // Close by clicking outside
  await page.mouse.click(500, 500);
  await expect(btn).not.toHaveClass(/\bopen\b/);
});

test('stopped sessions show a delete button; running sessions do not', async ({ page }) => {
  await injectWsSpy(page);
  await page.route('**/api/sessions', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: '0', name: 'main' }]) })
  );
  await page.route('**/api/windows**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  );
  await mockSessionStore(page, {
    lastActive: 'main',
    sessions: {
      main: fixtureSessionSettings(),
      archived: fixtureSessionSettings(),
    },
  });
  await page.goto('/main');
  await waitForWsOpen(page);
  await page.click('#btn-session-menu');
  const rows = page.locator('.tw-dropdown-menu.tw-dd-sessions-menu:not([hidden]) .tw-dd-session-item');
  // Sorted alphabetically: archived (0), main (1).
  // archived is stopped → delete button present
  await expect(rows.nth(0).locator('.tw-dd-session-delete')).toHaveCount(1);
  // main is running → no delete button
  await expect(rows.nth(1).locator('.tw-dd-session-delete')).toHaveCount(0);
});

test('clicking delete button removes the session via DELETE request', async ({ page }) => {
  await injectWsSpy(page);
  await page.route('**/api/sessions', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: '0', name: 'main' }]) })
  );
  await page.route('**/api/windows**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  );
  const store = await mockSessionStore(page, {
    lastActive: 'main',
    sessions: {
      main: fixtureSessionSettings(),
      archived: fixtureSessionSettings(),
    },
  });
  await page.goto('/main');
  await waitForWsOpen(page);
  await page.click('#btn-session-menu');

  const menu = page.locator('.tw-dropdown-menu.tw-dd-sessions-menu:not([hidden])');
  const archivedRow = menu.locator('.tw-dd-session-item', { hasText: 'archived' });
  await expect(archivedRow).toHaveCount(1);

  // Wait for the DELETE request fired by the click.
  const [req] = await Promise.all([
    page.waitForRequest(r => r.method() === 'DELETE' && r.url().includes('/api/session-settings')),
    archivedRow.locator('.tw-dd-session-delete').click(),
  ]);
  expect(new URL(req.url()).searchParams.get('name')).toBe('archived');

  // Row vanishes, server-side store no longer has the entry.
  await expect(archivedRow).toHaveCount(0);
  expect(store.get().sessions.archived).toBeUndefined();
});

test('delete button click does not switch to the deleted session', async ({ page }) => {
  await injectWsSpy(page);
  await page.route('**/api/sessions', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: '0', name: 'main' }]) })
  );
  await page.route('**/api/windows**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  );
  await mockSessionStore(page, {
    sessions: {
      main: fixtureSessionSettings(),
      archived: fixtureSessionSettings(),
    },
  });
  await page.goto('/main');
  await waitForWsOpen(page);
  await page.click('#btn-session-menu');
  const archivedRow = page.locator('.tw-dropdown-menu.tw-dd-sessions-menu:not([hidden]) .tw-dd-session-item', { hasText: 'archived' });
  await archivedRow.locator('.tw-dd-session-delete').click();
  // URL must stay on /main — the trashcan must not fall through to the row's
  // click handler which would navigate to /archived.
  expect(new URL(page.url()).pathname).toBe('/main');
});
