import { test, expect } from "@playwright/test";
import { injectWsSpy, waitForWsOpen } from './helpers.js';

async function waitForMenuInputs(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(
    () => (document.getElementById('inp-colours') as HTMLSelectElement | null)?.options.length > 0,
    { timeout: 5000 }
  );
}

test("switch colour scheme applies new background hex live", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("#terminal canvas, #terminal .xterm-screen");

  await page.click("#btn-menu");
  await waitForMenuInputs(page);
  await page.selectOption("#inp-colours", "Dracula");

  const bg = await page.evaluate(() => {
    const t = (window as any).__adapter?.term;
    return t?.options?.theme?.background;
  });
  expect(bg).toMatch(/^#[0-9a-fA-F]{6}$/);
});

test("sends colour-variant message on connect and on colour change", async ({ page }) => {
  await injectWsSpy(page);
  await page.goto("/");
  await waitForWsOpen(page);

  // Initial variant message is sent right after the resize on ws.onopen.
  await page.waitForFunction(
    () => (window as any).__wsSent.some((m: string) =>
      typeof m === 'string' && m.startsWith('{"type":"colour-variant"')
    ),
    { timeout: 3000 }
  );
  const initialMsgs: string[] = await page.evaluate(() =>
    (window as any).__wsSent.filter((m: string) =>
      typeof m === 'string' && m.startsWith('{"type":"colour-variant"')
    )
  );
  // Default colour scheme is Gruvbox Dark → dark variant
  expect(JSON.parse(initialMsgs[initialMsgs.length - 1])).toEqual({ type: 'colour-variant', variant: 'dark' });

  // Switch to a light scheme — a new colour-variant message should be sent.
  await page.click("#btn-menu");
  await waitForMenuInputs(page);
  await page.selectOption("#inp-colours", "Gruvbox Light");

  await page.waitForFunction(
    () => (window as any).__wsSent.some((m: string) =>
      typeof m === 'string' && m.includes('"variant":"light"')
    ),
    { timeout: 3000 }
  );
  const lightMsg = await page.evaluate(() =>
    (window as any).__wsSent.findLast((m: string) =>
      typeof m === 'string' && m.startsWith('{"type":"colour-variant"')
    )
  );
  expect(JSON.parse(lightMsg)).toEqual({ type: 'colour-variant', variant: 'light' });
});
