import { test, expect } from '@playwright/test';
import { startServer, killServer, createIsolatedTmux, hasTmux } from './helpers.js';

test.skip(!hasTmux(), 'tmux not available');

test('attached control client does not shrink session below display size', async ({ page }) => {
  const isolatedTmux = createIsolatedTmux('tw-ctl-size', ['sz']);

  const server = await startServer('bun', [
    'src/server/index.ts',
    '--listen', '127.0.0.1:4118',
    '--no-auth', '--no-tls',
    '--tmux', isolatedTmux.wrapperPath,
    '--tmux-conf', isolatedTmux.tmuxConfPath,
  ]);
  try {
    await page.setViewportSize({ width: 2400, height: 1200 });
    await page.goto('http://127.0.0.1:4118/sz');
    await page.waitForLoadState('networkidle');

    // Poll tmux for the display-driven size instead of sleeping a fixed
    // beat: the display client's resize is what we're waiting on, so ask
    // tmux directly until it widens past the 80x24 control-client default.
    let lastSize = '';
    await expect.poll(() => {
      lastSize = isolatedTmux.tmux(['display-message', '-p', '-t', 'sz', '#{window_width}x#{window_height}']).trim();
      const [pw, ph] = lastSize.split('x').map(Number);
      return Number.isFinite(pw) && Number.isFinite(ph) && pw! > 80 && ph! > 24;
    }, { timeout: 5000, message: () => `expected window to widen past 80x24, last seen ${lastSize}` }).toBe(true);

    const [w, h] = lastSize.split('x').map(Number);
    // The display client should drive the size. Confirm it's not the
    // control-client default (80x24) and not the old smallest-wins
    // collapse to 80.
    expect(w!).toBeGreaterThan(80);
    expect(h!).toBeGreaterThan(24);
  } finally {
    killServer(server);
    isolatedTmux.cleanup();
  }
});
