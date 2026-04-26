import { test, expect, type Page } from '@playwright/test';
import { startServer, killServer, createIsolatedTmux, hasTmux } from './helpers.js';

test.skip(!hasTmux(), 'tmux not available');

const PORT = 4119;
const SESSIONS = ['Fotona', 'HASS', 'main'] as const;
const SWITCHES = 20;

function nextRandom(seed: { value: number }): number {
  seed.value = (seed.value * 1664525 + 1013904223) >>> 0;
  return seed.value / 0x100000000;
}

async function visibleXtermText(page: Page): Promise<string> {
  return await page.evaluate(() => {
    const term = (window as any).__adapter?.term;
    if (!term) return '';
    const buffer = term.buffer.active;
    const start = buffer.viewportY;
    const lines: string[] = [];
    for (let i = 0; i < term.rows; i++) {
      lines.push(buffer.getLine(start + i)?.translateToString(true) ?? '');
    }
    return lines.join('\n');
  });
}

async function clickSession(page: Page, name: string): Promise<void> {
  await page.locator('#btn-session-menu').click();
  await page.waitForSelector('.tw-dd-sessions-menu:not([hidden])', { timeout: 3000 });
  await page.evaluate((target) => {
    const rows = Array.from(document.querySelectorAll('.tw-dd-sessions-menu .tw-dd-session-item'));
    const row = rows.find(r => r.querySelector('.tw-dd-session-name')?.textContent === target);
    if (!row) throw new Error(`session row not found: ${target}`);
    (row as HTMLElement).click();
  }, name);
}

async function waitForDisplayedSession(page: Page, name: string): Promise<void> {
  const marker = `TMUX_WEB_E2E_SESSION_${name}`;
  await expect.poll(async () => {
    const topbar = (await page.locator('#tb-session-name').textContent())?.trim();
    const visible = await visibleXtermText(page);
    return {
      topbar,
      hasTarget: visible.includes(marker),
      staleMarkers: SESSIONS.filter(s => s !== name && visible.includes(`TMUX_WEB_E2E_SESSION_${s}`)),
      sample: visible.split('\n').slice(0, 8).join('\n'),
    };
  }, {
    timeout: 8000,
    message: `xterm should display ${name}, not a stale session`,
  }).toMatchObject({
    topbar: name,
    hasTarget: true,
    staleMarkers: [],
  });
}

test('menu-driven session switches update the actual xterm buffer before the next switch', async ({ page }) => {
  const isolatedTmux = createIsolatedTmux('tw-menu-switch-content');
  let server: Awaited<ReturnType<typeof startServer>> | undefined;

  try {
    for (const session of SESSIONS) {
      isolatedTmux.tmux([
        'new-session',
        '-d',
        '-s',
        session,
        `while true; do clear; printf 'TMUX_WEB_E2E_SESSION_${session}\\n'; sleep 0.5; done`,
      ]);
    }

    server = await startServer('bun', [
      'src/server/index.ts',
      '--listen', `127.0.0.1:${PORT}`,
      '--no-auth', '--no-tls',
      '--tmux', isolatedTmux.wrapperPath,
    ]);

    await page.goto(`http://127.0.0.1:${PORT}/main`);
    await page.waitForFunction(() => !!(window as any).__adapter?.term, { timeout: 10000 });
    await waitForDisplayedSession(page, 'main');

    const seed = { value: 0x4022 };
    let current: typeof SESSIONS[number] = 'main';
    for (let i = 0; i < SWITCHES; i++) {
      const choices = SESSIONS.filter(s => s !== current);
      const target = choices[Math.floor(nextRandom(seed) * choices.length)]!;
      await clickSession(page, target);
      await waitForDisplayedSession(page, target);
      current = target;
    }
  } finally {
    if (server) killServer(server);
    isolatedTmux.cleanup();
  }
});
