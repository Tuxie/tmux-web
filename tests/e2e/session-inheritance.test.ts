import { test, expect } from "@playwright/test";
import { mockSessionStore } from "./helpers.js";

async function waitForMenuInputs(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(
    () => (document.getElementById('inp-colours') as HTMLSelectElement | null)?.options.length > 0,
    { timeout: 5000 }
  );
}

// Wait until the in-memory mock store has recorded a session under `name`.
// Persistence is fire-and-forget on the client, so we poll the mock state
// rather than racing the PUT.
async function waitForStored(
  store: ReturnType<typeof mockSessionStore> extends Promise<infer S> ? S : never,
  name: string,
): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (store.get().sessions[name]) return;
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error(`session '${name}' was never persisted`);
}

test("new session inherits live session's settings", async ({ page }) => {
  const store = await mockSessionStore(page);
  await page.goto("/main");
  await page.waitForSelector("#terminal canvas, #terminal .xterm-screen");

  await page.click("#btn-menu");
  await waitForMenuInputs(page);
  await page.selectOption("#inp-colours", "Nord");
  await page.fill("#inp-opacity", "40");
  await page.dispatchEvent("#inp-opacity", "change");
  await waitForStored(store, "main");

  // Navigate to a new session — should inherit from live session (main).
  await page.goto("/fresh-sess");
  await page.waitForSelector("#terminal canvas, #terminal .xterm-screen");
  await waitForStored(store, "fresh-sess");

  const stored = store.get().sessions["fresh-sess"];
  expect(stored?.colours).toBe("Nord");
  expect(stored?.opacity).toBe(40);
});

test("theme switch overwrites colours and font in active session", async ({ page }) => {
  const store = await mockSessionStore(page);
  await page.goto("/main");
  await page.waitForSelector("#terminal canvas, #terminal .xterm-screen");

  await page.click("#btn-menu");
  await waitForMenuInputs(page);
  // Select AmigaOS 3.1 which has defaultColours: "Gruvbox Light"
  const opts = await page.locator("#inp-theme option").allTextContents();
  if (!opts.includes("AmigaOS 3.1")) {
    test.skip(); // theme not present
    return;
  }
  await page.selectOption("#inp-theme", "AmigaOS 3.1");

  // Poll until the mock store reflects the new theme defaults.
  for (let i = 0; i < 50; i++) {
    const s = store.get().sessions["main"];
    if (s?.colours === "Gruvbox Light") break;
    await new Promise(r => setTimeout(r, 50));
  }
  const stored = store.get().sessions["main"];
  expect(stored?.colours).toBe("Gruvbox Light");
  expect(stored?.fontFamily).toBe("Topaz8 Amiga1200 Nerd Font");
});
