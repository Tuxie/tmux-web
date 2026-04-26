/**
 * Verifies that the settings-menu form controls have programmatic labels
 * attached via `<label for="…">`, so screen readers announce the visible
 * label when focus lands on the control.
 *
 * Cluster 09 (frontend-a11y), finding F1.
 */
import { test, expect } from '@playwright/test';
import { mockApis, injectWsSpy, waitForWsOpen } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await injectWsSpy(page);
  await mockApis(page, ['main'], []);
  await page.goto('/main');
  await waitForWsOpen(page);
  // Reveal the topbar so the menu button is clickable
  await page.mouse.move(640, 10);
  await page.click('#btn-menu');
  await expect(page.locator('#menu-dropdown')).toBeVisible();
});

// One row per static-menu form control labelled in index.html. Pairs the
// element id with the visible label text we expect HTMLInputElement.labels
// to surface.
const labelledControls: Array<[string, string]> = [
  ['inp-theme', 'Theme'],
  ['inp-theme-hue', 'Hue'],
  ['inp-theme-sat', 'Saturation'],
  ['inp-theme-ltn', 'Brightness'],
  ['inp-theme-contrast', 'Contrast'],
  ['inp-depth', 'Bevel'],
  ['inp-opacity', 'Opacity'],
  ['inp-background-hue', 'Hue'],
  ['inp-background-saturation', 'Saturation'],
  ['inp-background-brightest', 'Top'],
  ['inp-background-darkest', 'Bottom'],
  ['inp-colours', 'Scheme'],
  ['inp-tui-bg-opacity', 'BG Opacity'],
  ['inp-tui-fg-opacity', 'FG Opacity'],
  ['inp-fg-contrast-strength', 'Contrast'],
  ['inp-fg-contrast-bias', 'Bias'],
  ['inp-tui-saturation', 'Saturation'],
  ['inp-font-bundled', 'Font'],
  ['inp-fontsize', 'Size'],
  ['inp-spacing', 'Line Spacing'],
];

for (const [id, expected] of labelledControls) {
  test(`#${id} has a programmatic label "${expected}"`, async ({ page }) => {
    const labelText = await page.locator(`#${id}`).evaluate((el) => {
      const labels = (el as HTMLInputElement | HTMLSelectElement).labels;
      return labels && labels[0] ? labels[0].textContent?.trim() ?? null : null;
    });
    expect(labelText).toBe(expected);
  });
}

// Sliders use aria-label rather than a <label for=> association — assert
// the visible label is still surfaced via the accessibility tree so a
// screen reader hears "Hue" when focus lands on #sld-theme-hue.
const labelledSliders: Array<[string, string]> = [
  ['sld-theme-hue', 'Hue'],
  ['sld-theme-sat', 'Saturation'],
  ['sld-theme-ltn', 'Brightness'],
  ['sld-theme-contrast', 'Contrast'],
  ['sld-depth', 'Bevel'],
  ['sld-opacity', 'Background opacity'],
  ['sld-background-hue', 'Background hue'],
  ['sld-background-saturation', 'Background saturation'],
  ['sld-background-brightest', 'Background top'],
  ['sld-background-darkest', 'Background bottom'],
  ['sld-tui-bg-opacity', 'BG opacity'],
  ['sld-tui-fg-opacity', 'FG opacity'],
  ['sld-fg-contrast-strength', 'FG contrast'],
  ['sld-fg-contrast-bias', 'FG contrast bias'],
  ['sld-tui-saturation', 'Terminal saturation'],
  ['sld-fontsize', 'Font size'],
  ['sld-spacing', 'Line spacing'],
];

for (const [id, expected] of labelledSliders) {
  test(`#${id} exposes accessible name "${expected}"`, async ({ page }) => {
    const ariaLabel = await page.locator(`#${id}`).getAttribute('aria-label');
    expect(ariaLabel).toBe(expected);
  });
}
