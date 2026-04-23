# Move font history persistence E2E coverage to happy-dom

Date: 2026-04-23

## Source

`tests/e2e/font-history.test.ts`

## Problem

The tests exercise settings persistence and dropdown/input restoration. They do not check real font loading, browser font metrics, canvas rendering, or layout.

## Migrate

- `spacing change persists in session settings`
- `font and spacing persist across page reload`

Suggested unit shape:

- Mount the settings/topbar DOM in happy-dom.
- Provide fixture fonts and a fake session store/fetch implementation.
- Change `#inp-spacing` and `#inp-font-bundled`.
- Assert the session-store update payload/state.
- Reinitialize the client settings code against the same fake store and assert the select/input values are restored.

The Playwright file can be removed once equivalent unit coverage exists.
