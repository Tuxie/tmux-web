import { test, expect } from "@playwright/test";
import { injectWsSpy, waitForWsOpen } from './helpers.js';
import { FX } from './fixture-themes.js';

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
  await page.selectOption("#inp-colours", FX.colours.b);

  // composeTheme writes the terminal background as `rgba(r,g,b,0)` so the
  // WebGL atlas rasterises glyph halos against the composite of the body
  // bg and the theme bg (see src/client/colours.ts). Accept that format
  // instead of the pre-1.3 plain #rrggbb.
  const bg = await page.evaluate(() => {
    const t = (window as any).__adapter?.term;
    return t?.options?.theme?.background;
  });
  expect(bg).toMatch(/^rgba\(\d+,\d+,\d+,0\)$/);
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
  // The fixture primary theme's defaultColours is `E2E Red` (variant: dark).
  const last = initialMsgs[initialMsgs.length - 1];
  expect(last).toBeDefined();
  expect(JSON.parse(last!)).toEqual({ type: 'colour-variant', variant: 'dark' });

  // Switch to a light-variant fixture colour — a new colour-variant message should be sent.
  await page.click("#btn-menu");
  await waitForMenuInputs(page);
  await page.selectOption("#inp-colours", FX.colours.c); // E2E Green (variant: light)

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
