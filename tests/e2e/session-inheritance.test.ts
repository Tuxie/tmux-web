import { test, expect } from "@playwright/test";

async function waitForMenuInputs(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(
    () => (document.getElementById('inp-colours') as HTMLSelectElement | null)?.options.length > 0,
    { timeout: 5000 }
  );
}

test("new session inherits live session's settings", async ({ page }) => {
  await page.goto("/main");
  await page.waitForSelector("#terminal canvas, #terminal .xterm-screen");

  await page.click("#btn-menu");
  await waitForMenuInputs(page);
  await page.selectOption("#inp-colours", "Nord");
  await page.fill("#inp-opacity", "40");
  await page.dispatchEvent("#inp-opacity", "change");

  // Navigate to a new session — inherit via localStorage of "main"
  await page.goto("/fresh-sess");
  await page.waitForSelector("#terminal canvas, #terminal .xterm-screen");

  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("tmux-web-session:fresh-sess") || "null")
  );
  // fresh-sess has no prior stored settings, so it inherits from live session (main)
  // which had Nord + opacity 40
  expect(stored?.colours).toBe("Nord");
  expect(stored?.opacity).toBe(40);
});

test("theme switch overwrites colours and font in active session", async ({ page }) => {
  await page.goto("/main");
  await page.waitForSelector("#terminal canvas, #terminal .xterm-screen");

  await page.click("#btn-menu");
  await waitForMenuInputs(page);
  // Select AmigaOS 3.1 which has defaultColours: "Monokai"
  const opts = await page.locator("#inp-theme option").allTextContents();
  if (!opts.includes("AmigaOS 3.1")) {
    test.skip(); // theme not present
    return;
  }
  await page.selectOption("#inp-theme", "AmigaOS 3.1");

  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("tmux-web-session:main") || "null")
  );
  expect(stored?.colours).toBe("Monokai");
  expect(stored?.fontFamily).toBe("Topaz8 Amiga1200 Nerd Font");
});
