import { test, expect } from "@playwright/test";

test("xterm internal elements have transparent background", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("#terminal .xterm-viewport");

  const vpBg = await page.evaluate(() => {
    const vp = document.querySelector('.xterm-viewport') as HTMLElement;
    return getComputedStyle(vp).backgroundColor;
  });
  expect(vpBg).toBe('rgba(0, 0, 0, 0)');
});
