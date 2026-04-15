import { test, expect } from "@playwright/test";

async function waitForMenuInputs(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(
    () => (document.getElementById('inp-opacity') as HTMLInputElement | null) !== null,
    { timeout: 5000 }
  );
}

test("opacity slider updates xterm background alpha", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("#terminal canvas, #terminal .xterm-screen");

  await page.click("#btn-menu");
  await waitForMenuInputs(page);

  await page.fill("#inp-opacity", "50");
  await page.dispatchEvent("#inp-opacity", "change");

  const bg = await page.evaluate(() => (window as any).__adapter?.term?.options?.theme?.background);
  expect(bg).toMatch(/rgba\([^)]+,\s*0\.5\)$/);
});

test("xterm-viewport background-color is transparent regardless of opacity", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("#terminal .xterm-viewport");

  await page.click("#btn-menu");
  await waitForMenuInputs(page);

  await page.fill("#inp-opacity", "80");
  await page.dispatchEvent("#inp-opacity", "change");

  const vpBg = await page.evaluate(() => {
    const vp = document.querySelector('.xterm-viewport') as HTMLElement;
    return getComputedStyle(vp).backgroundColor;
  });
  // computed style for a transparent element returns rgba(0,0,0,0)
  expect(vpBg).toBe('rgba(0, 0, 0, 0)');
});
