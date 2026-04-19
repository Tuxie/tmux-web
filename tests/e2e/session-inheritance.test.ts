import { test, expect } from "@playwright/test";
import { mockSessionStore } from "./helpers.js";
import { FX } from "./fixture-themes.js";

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
  await page.selectOption("#inp-colours", FX.colours.b);
  await page.fill("#inp-opacity", "40");
  await page.dispatchEvent("#inp-opacity", "change");
  await waitForStored(store, "main");

  // Navigate to a new session — should inherit from live session (main).
  await page.goto("/fresh-sess");
  await page.waitForSelector("#terminal canvas, #terminal .xterm-screen");
  await waitForStored(store, "fresh-sess");

  const stored = store.get().sessions["fresh-sess"];
  expect(stored?.colours).toBe(FX.colours.b);
  expect(stored?.opacity).toBe(40);
});

test("theme switch overwrites colours and font in active session", async ({ page }) => {
  const store = await mockSessionStore(page);
  await page.goto("/main");
  await page.waitForSelector("#terminal canvas, #terminal .xterm-screen");

  await page.click("#btn-menu");
  await waitForMenuInputs(page);
  // The alt fixture theme's defaults are distinct from the primary theme's
  // so we can verify that switching theme overwrites `colours` and
  // `fontFamily` in the active session.
  await page.selectOption("#inp-theme", FX.themes.alt);

  // Poll until the mock store reflects the new theme defaults.
  for (let i = 0; i < 50; i++) {
    const s = store.get().sessions["main"];
    if (s?.colours === FX.colours.c) break;
    await new Promise(r => setTimeout(r, 50));
  }
  const stored = store.get().sessions["main"];
  expect(stored?.colours).toBe(FX.colours.c);           // alt theme's defaultColours
  expect(stored?.fontFamily).toBe(FX.fonts.secondary);  // alt theme's defaultFont
});
