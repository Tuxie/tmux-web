# Move fullscreen checkbox E2E coverage to happy-dom

Date: 2026-04-23

## Source

`tests/e2e/fullscreen.test.ts`

## Problem

The tests stub the Fullscreen API, click the settings checkbox, and assert calls plus checkbox state. They do not depend on a real browser fullscreen transition; the important behavior is local event handling.

## Migrate

- `opening menu and checking Fullscreen calls requestFullscreen`
- `unchecking Fullscreen calls exitFullscreen`

Suggested unit shape:

- Use happy-dom to create `#btn-menu`, `#menu-dropdown`, and `#chk-fullscreen`.
- Stub `document.fullscreenElement`, `document.exitFullscreen`, and `document.documentElement.requestFullscreen`.
- Dispatch clicks on the checkbox.
- Dispatch `fullscreenchange` where needed.
- Assert request/exit calls and checkbox checked state.
