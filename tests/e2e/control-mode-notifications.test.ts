import { test, expect } from '@playwright/test';
import { startServer, killServer, createIsolatedTmux, hasTmux } from './helpers.js';

test.skip(!hasTmux(), 'tmux not available');

test('rename-session emits \\x00TT:session push to attached WS', async ({ page }) => {
  const isolatedTmux = createIsolatedTmux('tw-ctl-e2e', ['e2e-main']);

  const server = await startServer('bun', [
    'src/server/index.ts',
    '--listen', '127.0.0.1:4117',
    '--no-auth', '--no-tls',
    '--tmux', isolatedTmux.wrapperPath,
    '--tmux-conf', isolatedTmux.tmuxConfPath,
  ]);
  try {
    const events: string[] = [];
    page.on('websocket', (ws) => {
      ws.on('framereceived', (ev) => {
        const payload =
          typeof ev.payload === 'string'
            ? ev.payload
            : ev.payload.toString('utf8');
        if (payload.startsWith('\x00TT:')) events.push(payload);
      });
    });
    await page.goto('http://127.0.0.1:4117/e2e-main');
    await page.waitForLoadState('networkidle');

    // Poll for the initial framereceived count to settle: at least one TT
    // frame must arrive before we capture `before`. Avoids racing the
    // control client's attach + initial state-sync push on slow CI.
    await expect.poll(() => events.length, { timeout: 5000 }).toBeGreaterThan(0);
    const before = events.length;

    // Rename the session from outside tmux-web. tmux fires
    // %session-renamed → primary forwards → ws broadcast.
    isolatedTmux.tmux(['rename-session', '-t', 'e2e-main', 'e2e-renamed']);

    // Expect a new \x00TT:session payload within 1500ms (bumped from
    // 500ms for slow CI machines). Other TT pushes, such as scrollbar
    // state, can race with the session notification.
    await expect
      .poll(() => events.slice(before).some(msg => /^\x00TT:.*"session"/.test(msg)), { timeout: 1500 })
      .toBe(true);
  } finally {
    killServer(server);
    isolatedTmux.cleanup();
  }
});
