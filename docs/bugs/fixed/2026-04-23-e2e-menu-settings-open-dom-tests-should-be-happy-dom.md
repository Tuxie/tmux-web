# Move settings-menu-open E2E coverage to happy-dom

Date: 2026-04-23

## Source

`tests/e2e/menu-settings-open.test.ts`

## Problem

These tests only verify that the settings dropdown remains visible after settings controls change. They currently start a server and browser, but the assertions are local DOM state checks after `change`/`input` events.

## Migrate

- `menu stays open after font size number input change`
- `menu stays open after font size slider change`
- `menu stays open after spacing number input change`
- `menu stays open after spacing slider change`
- `menu stays open after switching bundled font`

Suggested unit shape:

- Mount the settings menu DOM in happy-dom.
- Provide a fake adapter whose `updateOptions`/`fit` methods are no-ops.
- Open the menu, dispatch the same input/change events, and assert `#menu-dropdown` is still visible/not hidden.
- For the bundled font case, seed `#inp-font-bundled` options from fixture font data before dispatching the change.
