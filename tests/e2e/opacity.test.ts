import { test, expect } from "@playwright/test";

async function waitForMenuInputs(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(
    () => (document.getElementById('inp-colours') as HTMLSelectElement | null)?.options.length > 0,
    { timeout: 5000 }
  );
}

test("opacity slider sets rgba background-color on #page", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("#terminal canvas, #terminal .xterm-screen");

  await page.click("#btn-menu");
  await waitForMenuInputs(page);

  await page.fill("#inp-opacity", "50");
  await page.dispatchEvent("#inp-opacity", "change");

  const bg = await page.evaluate(() => document.getElementById('page')!.style.backgroundColor);
  expect(bg).toMatch(/rgba\([^)]+,\s*0\.5\)$/);
});

test("xterm internal elements have transparent background", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("#terminal .xterm-viewport");

  const vpBg = await page.evaluate(() => {
    const vp = document.querySelector('.xterm-viewport') as HTMLElement;
    return getComputedStyle(vp).backgroundColor;
  });
  expect(vpBg).toBe('rgba(0, 0, 0, 0)');
});
