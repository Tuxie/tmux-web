import { test, expect, type Page, type TestInfo } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createIsolatedTmux,
  hasTmux,
  killServer,
  startServer,
} from './helpers.js';

test.skip(!hasTmux(), 'tmux not available');
test.setTimeout(30_000);

const PORT_BASE = 7122;

function port(testInfo: TestInfo): number {
  return PORT_BASE + testInfo.parallelIndex;
}

function shellSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

async function waitForTerminal(page: Page): Promise<void> {
  await page.waitForFunction(() => !!(window as any).__adapter?.term, { timeout: 12_000 });
  await expect(page.locator('#terminal .xterm')).toBeVisible({ timeout: 12_000 });
}

async function waitForTerminalText(page: Page, text: string): Promise<void> {
  await page.waitForFunction((needle: string) => {
    const term = (window as any).__adapter?.term;
    if (!term) return false;
    for (let i = 0; i < term.rows; i++) {
      const line = term.buffer.active.getLine(i)?.translateToString(true) ?? '';
      if (line.includes(needle)) return true;
    }
    return false;
  }, text, { timeout: 8_000 });
}

async function dragInsideTerminal(page: Page): Promise<void> {
  const coords = await page.evaluate(() => {
    const term = (window as any).__adapter?.term;
    if (!term) throw new Error('terminal adapter not found');
    const dims = term._core._renderService.dimensions;
    const cellWidth = dims.css.cell.width;
    const cellHeight = dims.css.cell.height;
    const canvas: HTMLElement | null = document.querySelector('#terminal canvas');
    if (!canvas) throw new Error('xterm canvas not found');
    const rect = canvas.getBoundingClientRect();
    return {
      startX: rect.left + 2.5 * cellWidth,
      startY: rect.top + 2.5 * cellHeight,
      endX: rect.left + 8.5 * cellWidth,
      endY: rect.top + 2.5 * cellHeight,
    };
  });

  await page.mouse.move(coords.startX, coords.startY);
  await page.mouse.down();
  await page.mouse.move(coords.endX, coords.endY);
  await page.mouse.up();
}

test('mouse drag is forwarded to a fullscreen alternate-screen TUI', async ({ page }, testInfo) => {
  const isolatedTmux = createIsolatedTmux('tw-alt-mouse-e2e');
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-alt-mouse-'));
  const logPath = path.join(tempDir, 'mouse.log');

  try {
    const command = [
      `: > ${shellSingleQuote(logPath)}`,
      "printf '\\033[?1049h\\033[?1000h\\033[?1002h\\033[?1006hALT_MOUSE_READY\\r\\n'",
      `while IFS= read -rsn1 ch; do printf '%s' "$ch" >> ${shellSingleQuote(logPath)}; done`,
    ].join('; ');

    isolatedTmux.tmux([
      'new-session',
      '-d',
      '-s',
      'altmouse',
      `bash --noprofile --norc -c ${shellSingleQuote(command)}`,
    ]);

    await expect.poll(() => isolatedTmux.tmux([
      'display-message',
      '-p',
      '-t',
      'altmouse:0.0',
      '#{alternate_on}',
    ]).trim(), {
      timeout: 5_000,
      message: 'test fixture should enter alternate screen before browser attach',
    }).toBe('1');

    server = await startServer('bun', [
      'src/server/index.ts',
      '--listen',
      `127.0.0.1:${port(testInfo)}`,
      '--no-auth',
      '--no-tls',
      '--tmux',
      isolatedTmux.wrapperPath,
      '--tmux-conf',
      isolatedTmux.tmuxConfPath,
    ]);

    await page.goto(`http://127.0.0.1:${port(testInfo)}/altmouse`);
    await waitForTerminal(page);
    await waitForTerminalText(page, 'ALT_MOUSE_READY');
    await dragInsideTerminal(page);

    await expect.poll(() => {
      try {
        return fs.readFileSync(logPath, 'binary');
      } catch {
        return '';
      }
    }, {
      timeout: 5_000,
      message: 'fullscreen alternate-screen TUI should receive SGR mouse events',
    }).toMatch(/\x1b\[<0;\d+;\d+M.*\x1b\[<32;\d+;\d+M.*\x1b\[<0;\d+;\d+m/s);
  } finally {
    if (server) killServer(server);
    isolatedTmux.cleanup();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
