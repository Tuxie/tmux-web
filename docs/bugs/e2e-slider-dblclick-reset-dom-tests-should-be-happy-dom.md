# Move slider double-click reset E2E coverage to happy-dom

Date: 2026-04-23

## Source

`tests/e2e/slider-dblclick-reset.test.ts`

## Problem

These tests drive settings inputs, dispatch `change`/double-click events, and assert paired input values plus session-store updates. They do not verify rendering or browser behavior that requires Playwright.

## Migrate

- `double-click on a theme-global slider (Theme Hue) resets to DEFAULT_THEME_HUE`
- `double-click on a theme-scoped slider (TUI BG Opacity) resets to the active theme default`
- `double-click on the number input (FG Contrast) resets to 0`
- `double-click on BG Hue resets to 183`

Suggested unit shape:

- Mount the settings menu controls in happy-dom.
- Initialize `attachDoubleClickReset`/topbar settings code with fixture theme defaults and a fake session store.
- Change the relevant input value and dispatch `change`.
- Dispatch `dblclick` on the range or number input.
- Assert the paired input value and stored session setting.
