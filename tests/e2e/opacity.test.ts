import { test, expect } from "@playwright/test";

async function waitForMenuInputs(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(
    () => (document.getElementById('inp-opacity') as HTMLInputElement | null) !== null,
    { timeout: 5000 }
  );
}

test("opacity slider updates #terminal background-color alpha", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("#terminal");

  await page.click("#btn-menu");
  await waitForMenuInputs(page);

  await page.fill("#inp-opacity", "50");
  await page.dispatchEvent("#inp-opacity", "change");

  const bg = await page.evaluate(() => document.getElementById('terminal')!.style.backgroundColor);
  expect(bg).toMatch(/rgba\([^)]+,\s*0\.5\)$/);
});

test("xterm theme background is transparent regardless of opacity", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("#terminal");

  await page.click("#btn-menu");
  await waitForMenuInputs(page);

  await page.fill("#inp-opacity", "80");
  await page.dispatchEvent("#inp-opacity", "change");

  const themeBg = await page.evaluate(() => (window as any).__adapter?.term?.options?.theme?.background);
  expect(themeBg).toBe("transparent");
});
