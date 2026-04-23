# Move menu toggle DOM-only coverage to happy-dom

Date: 2026-04-23

## Source

`tests/e2e/menu-focus.test.ts`

## Problem

Most tests in this file intentionally verify real focus/keyboard delivery back into the terminal, so they should stay in Playwright. One test is only a DOM toggle check and can be a happy-dom unit test.

## Migrate

- `right-click on hamburger also toggles the config menu`

Suggested unit shape:

- Mount the topbar/menu DOM in happy-dom.
- Initialize the menu handler.
- Dispatch a `contextmenu` or right-click equivalent event on `#btn-menu`.
- Assert `#menu-dropdown` visible/open state toggles on first and second right-click.

## Keep in Playwright

Keep the tests named `terminal focused after ...`. They verify real keyboard focus and key delivery through the terminal/WebSocket path, which is browser integration behavior.
