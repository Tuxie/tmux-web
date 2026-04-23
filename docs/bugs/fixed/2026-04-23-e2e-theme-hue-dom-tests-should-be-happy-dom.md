# Move Theme Hue persistence coverage to happy-dom

Date: 2026-04-23

## Source

`tests/e2e/theme-hue.test.ts`

## Problem

The persistence test changes the Theme Hue input and asserts the mocked session store. That is client settings state and does not need Playwright.

## Migrate

- `Theme Hue is persisted per session and survives reload`

Suggested unit shape:

- Mount `#inp-theme-hue`/`#sld-theme-hue` and the settings menu in happy-dom.
- Initialize settings with a fake session store.
- Dispatch a change to `60`.
- Assert the active session store contains `themeHue: 60`.

## Keep in Playwright or Browser-CSS Coverage

The first two tests install a probe element and rely on computed `hsl(var(--tw-theme-hue) ...)` color results. That is browser CSS engine behavior, not just DOM state. If moved, replace them with a narrower unit test that asserts the CSS variable is written, and keep one browser-level test if the actual CSS recomputation is important.
