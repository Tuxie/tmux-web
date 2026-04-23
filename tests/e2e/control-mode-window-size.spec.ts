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
  ]);
  try {
    await page.setViewportSize({ width: 2400, height: 1200 });
    await page.goto('http://127.0.0.1:4118/sz');
    await page.waitForLoadState('networkidle');
    // Give attach + refresh-client a beat.
    await new Promise(r => setTimeout(r, 500));

    const size = isolatedTmux.tmux(['display-message', '-p', '-t', 'sz', '#{window_width}x#{window_height}']).trim();
    const [w, h] = size.split('x').map(Number);
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
