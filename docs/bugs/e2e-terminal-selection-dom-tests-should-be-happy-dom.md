# Move terminal-selection UI regression coverage to happy-dom

Date: 2026-04-23

## Source

`tests/e2e/terminal-selection.test.ts`

## Problem

Part of this file verifies that the removed backend-selection UI stays absent from the settings menu and config. That is DOM/config state and does not require a Playwright browser.

## Migrate

- `settings menu no longer exposes a terminal picker`

Suggested unit shape:

- Mount the app shell/topbar in happy-dom.
- Initialize the settings menu with a fake xterm-only config.
- Open the menu.
- Assert `#inp-terminal` is absent and `window.__TMUX_WEB_CONFIG.terminal` is undefined.

## Keep in Playwright

Keep `page loads xterm without a terminal query parameter` and `real server renders xterm by default with no backend-selection UI` in Playwright while they are intended to prove the real xterm page/server path still renders. `/api/terminal-versions reports xterm only` could become a server unit/integration test, but it is not a happy-dom candidate.
