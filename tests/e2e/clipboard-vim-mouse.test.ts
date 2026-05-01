/**
 * End-to-end: mouse-select text displayed by vim inside tmux, verify the
 * selection lands in the browser clipboard via the OSC 52 pipeline.
 *
 *  1.  Real isolated tmux + vim (mouse= disabled so tmux gets the events).
 *  2.  Real tmux-web server connected to the isolated tmux.
 *  3.  Playwright mouse-drag across the text in the xterm viewport.
 *  4.  mouse.ts forwards SGR mouse sequences → tmux copy-mode → OSC 52 →
 *      server protocol.ts → \x00TT:{"clipboard":"…"} → browser clipboard.
 *  5.  Assert `navigator.clipboard.writeText` received the expected value.
 */
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import {
  startServer,
  killServer,
  createIsolatedTmux,
  hasTmux,
} from './helpers.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Skip the whole file when tmux is not on PATH
// ---------------------------------------------------------------------------

test.skip(!hasTmux(), 'tmux not available');

// ---------------------------------------------------------------------------
// Per-worker ports so parallel runs don't collide
// ---------------------------------------------------------------------------

const PORT_BASE = 41300;
const PORT_RANGE_SIZE = 1000;

function workerPort(testInfo: TestInfo): number {
  if (testInfo.parallelIndex >= PORT_RANGE_SIZE) {
    throw new Error(
      `clipboard-vim-mouse port range supports ${PORT_RANGE_SIZE} workers, got ${testInfo.parallelIndex}`,
    );
  }
  return PORT_BASE + testInfo.parallelIndex * 10;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForTerminal(page: Page): Promise<void> {
  await page.waitForFunction(() => !!(window as any).__adapter?.term, {
    timeout: 10000,
  });
  await expect(page.locator('#terminal .xterm')).toBeVisible({ timeout: 10000 });
}

/** Poll until xterm's active buffer contains `substring`. */
async function waitForTerminalText(
  page: Page,
  substring: string,
  timeout = 8000,
): Promise<void> {
  await page.waitForFunction(
    (needle) => {
      const term = (window as any).__adapter?.term;
      if (!term) return false;
      const buf = term.buffer.active;
      for (let i = 0; i < term.rows; i++) {
        const line = buf.getLine(i);
        if (line?.translateToString(true)?.includes(needle)) return true;
      }
      return false;
    },
    substring,
    { timeout },
  );
}

// ---------------------------------------------------------------------------
// The test
// ---------------------------------------------------------------------------

test(
  'mouse-select text in vim via tmux copy-mode lands in browser clipboard',
  async ({ page }, testInfo) => {
    const port = workerPort(testInfo);
    const isolatedTmux = createIsolatedTmux('tw-clip-vim-mouse');
    let server: Awaited<ReturnType<typeof startServer>> | undefined;

    // Temporary file that vim will open — one line with known content.
    const testFileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-e2e-vim-'));
    const testFilePath = path.join(testFileDir, 'vim-selection.txt');
    const TEST_TEXT = 'CLIPBOARD_MOUSE_E2E';
    fs.writeFileSync(testFilePath, TEST_TEXT + '\n');

    try {
      // ---- 1. Isolated tmux + vim ----

      // Start vim with mouse disabled (so tmux gets mouse, not vim).
      // -u NONE   → no .vimrc so no plugins / unexpected settings.
      // mouse=    → vim won't consume mouse events.
      // nomodified + shortmess+=I → no "modified" prompt on quit, no intro.
      //
      // new-session starts the tmux server, so this must come first.
      isolatedTmux.tmux([
        'new-session',
        '-d',
        '-s',
        'vimclip',
        `vim -u NONE -c 'set mouse=' -c 'set nomodified' -c 'set shortmess+=I' ${testFilePath}`,
      ]);

      // Give vim a moment to paint its screen.
      await new Promise((r) => setTimeout(r, 800));

      // ---- 2. tmux-web server ----

      server = await startServer('bun', [
        'src/server/index.ts',
        '--listen',
        `127.0.0.1:${port}`,
        '--no-auth',
        '--no-tls',
        '--tmux',
        isolatedTmux.wrapperPath,
        '--tmux-conf',
        isolatedTmux.tmuxConfPath,
      ]);

      // ---- 3. Browser: clipboard spy + connect ----

      await page.addInitScript(() => {
        (window as any).__clipboardWrites = [] as string[];
        Object.defineProperty(navigator, 'clipboard', {
          value: {
            writeText: (text: string) => {
              (window as any).__clipboardWrites.push(text);
              return Promise.resolve();
            },
          },
          configurable: true,
          writable: true,
        });
      });

      await page.goto(`http://127.0.0.1:${port}/vimclip`);
      await waitForTerminal(page);
      await waitForTerminalText(page, TEST_TEXT);
      expect(isolatedTmux.tmux(['show-options', '-s', '-g', 'set-clipboard']).trim())
        .toBe('set-clipboard external');

      // Give xterm.js a moment to settle (WebGL atlas, font raster etc.)
      await page.waitForTimeout(500);

      // ---- 4. Mouse-drag select the text ----

      const coords = await page.evaluate((text) => {
        const term = (window as any).__adapter?.term;
        if (!term) throw new Error('terminal adapter not found');

        const dims = term._core._renderService.dimensions;
        const cw = dims.css.cell.width;   // CSS pixels per column
        const ch = dims.css.cell.height;   // CSS pixels per row

        const canvas: HTMLElement | null = document.querySelector(
          '#terminal canvas',
        );
        if (!canvas) throw new Error('xterm canvas not found');
        const rect = canvas.getBoundingClientRect();

        // Column/row are 1-indexed SGR coords.
        // Center of col 1 → (rect.left + 0.5 * cw).
        // Center of col text.length → (rect.left + (text.length - 0.5) * cw).
        return {
          startX: rect.left + 0.5 * cw,
          startY: rect.top + 0.5 * ch,
          endX: rect.left + (text.length - 0.5) * cw,
          endY: rect.top + 0.5 * ch,
        };
      }, TEST_TEXT);

      // Start drag at first column.
      await page.mouse.move(coords.startX, coords.startY);
      await page.mouse.down();

      // Move right across the text in small steps (ensures enough mousemove
      // events fire for tmux to track the selection extension).
      const steps = 10;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        await page.mouse.move(
          coords.startX + (coords.endX - coords.startX) * t,
          coords.startY,
        );
        await page.waitForTimeout(25);
      }

      await page.mouse.up();

      // ---- 5. Assert clipboard received the text ----

      await page.waitForFunction(
        (expected) =>
          ((window as any).__clipboardWrites as string[]).includes(expected),
        TEST_TEXT,
        { timeout: 5000 },
      );

      // Sanity: also grab the array and do an explicit assertion.
      const writes: string[] = await page.evaluate(
        () => (window as any).__clipboardWrites,
      );
      expect(writes).toContain(TEST_TEXT);
    } finally {
      if (server) killServer(server);
      isolatedTmux.cleanup();
      try {
        fs.rmSync(testFileDir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    }
  },
);
