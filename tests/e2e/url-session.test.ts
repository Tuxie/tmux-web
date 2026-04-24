import { test, expect } from '@playwright/test';
import { mockApis, mockSessionStore, injectWsSpy, waitForWsOpen, sendFromServer } from './helpers.js';
import { FX, fixtureSessionSettings } from './fixture-themes.js';

// Fixture colour backgrounds from tests/fixtures/themes-bundled/e2e/colours/*.toml
// (kept next to the test so a reader doesn't need to open the TOMLs).
const RED_BG_RGBA = 'rgba(64,0,0,0)';   // E2E Red   = #400000
const BLUE_BG_RGBA = 'rgba(0,0,64,0)';  // E2E Blue  = #000040

test('server-driven session switch applies the target session\'s stored settings', async ({ page }) => {
  await injectWsSpy(page);
  // Seed the persisted store so /api/session-settings GET returns settings
  // for both "main" (E2E Red) and "other" (E2E Blue) on initial load.
  // opacity 100 keeps composeTheme's composite equal to the pure theme bg;
  // at opacity 0 the composite collapses to the body colour regardless of
  // the colour scheme, so the per-session bg check below couldn't tell the
  // two sessions apart.
  await mockSessionStore(page, {
    sessions: {
      main:  fixtureSessionSettings({ colours: FX.colours.a, opacity: 100 }),
      other: fixtureSessionSettings({ colours: FX.colours.b, opacity: 100 }),
    },
  });
  // mockApis registers its own /api/session-settings route — call it BEFORE
  // mockSessionStore so the seeded route (registered later) wins.
  // Order matters: most recently registered Playwright route fires first.
  await page.route('**/api/sessions', route =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify([{ id: '0', name: 'main' }, { id: '1', name: 'other' }]) })
  );
  await page.route('**/api/windows**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  );
  await page.goto('/main');
  await waitForWsOpen(page);

  // Sanity: at /main the adapter shows the fixture's E2E Red background.
  // composeTheme emits it as rgba(r,g,b,0).
  await page.waitForFunction(expected =>
    (window as any).__adapter?.term?.options?.theme?.background === expected,
    RED_BG_RGBA,
    { timeout: 3000 }
  );

  // Simulate the server telling us the active tmux session is now "other"
  // (i.e. the user switched via a tmux keyboard shortcut, not the web UI).
  await sendFromServer(page, { session: 'other' });

  // The client should have loaded "other"'s stored settings and re-applied them.
  await page.waitForFunction(expected =>
    (window as any).__adapter?.term?.options?.theme?.background === expected,
    BLUE_BG_RGBA,
    { timeout: 3000 }
  );
  await expect(page.locator('#inp-colours')).toHaveValue(FX.colours.b);
});

test('menu session switch waits for server confirmation before applying target settings', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__wsSent = [];
    (window as any).__wsInstance = null;
    class FakeWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      readyState = FakeWebSocket.CONNECTING;
      onopen: ((ev: Event) => void) | null = null;
      onmessage: ((ev: MessageEvent) => void) | null = null;
      onclose: ((ev: CloseEvent) => void) | null = null;
      onerror: ((ev: Event) => void) | null = null;
      url: string;
      constructor(url: string) {
        this.url = url;
        (window as any).__wsInstance = this;
        queueMicrotask(() => {
          this.readyState = FakeWebSocket.OPEN;
          this.onopen?.(new Event('open'));
        });
      }
      send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
        (window as any).__wsSent.push(typeof data === 'string' ? data : String(data));
      }
      close() {
        this.readyState = FakeWebSocket.CLOSED;
        this.onclose?.(new CloseEvent('close'));
      }
    }
    window.WebSocket = FakeWebSocket as any;
    (window as any).__mockWsReceive = (data: string) => {
      (window as any).__wsInstance?.onmessage?.({ data } as MessageEvent);
    };
  });
  await mockSessionStore(page, {
    sessions: {
      main:  fixtureSessionSettings({ colours: FX.colours.a, opacity: 100 }),
      other: fixtureSessionSettings({ colours: FX.colours.b, opacity: 100 }),
    },
  });
  await page.route('**/api/sessions', route =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify([{ id: '0', name: 'main' }, { id: '1', name: 'other' }]) })
  );
  await page.route('**/api/windows**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  );

  await page.goto('/main');
  await waitForWsOpen(page);
  await page.waitForFunction(expected =>
    (window as any).__adapter?.term?.options?.theme?.background === expected,
    RED_BG_RGBA,
    { timeout: 3000 }
  );

  await page.locator('#btn-session-menu').click();
  await page.locator('.tw-dd-session-item', { hasText: 'other' }).click();

  await page.waitForFunction(() =>
    (window as any).__wsSent.some((m: string) => m === JSON.stringify({ type: 'switch-session', name: 'other' })),
    { timeout: 3000 }
  );
  await expect(page).toHaveURL(/\/main$/);
  await expect(page.locator('#tb-session-name')).toHaveText('main');
  await page.waitForFunction(expected =>
    (window as any).__adapter?.term?.options?.theme?.background === expected,
    RED_BG_RGBA,
    { timeout: 3000 }
  );

  await sendFromServer(page, { session: 'other' });

  await expect(page).toHaveURL(/\/other$/);
  await expect(page.locator('#tb-session-name')).toHaveText('other');
  await page.waitForFunction(expected =>
    (window as any).__adapter?.term?.options?.theme?.background === expected,
    BLUE_BG_RGBA,
    { timeout: 3000 }
  );
});
