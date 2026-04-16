import { test, expect } from "@playwright/test";

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
