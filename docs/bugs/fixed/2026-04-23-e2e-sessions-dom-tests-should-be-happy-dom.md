# Move session menu E2E coverage to happy-dom

Date: 2026-04-23

## Source

`tests/e2e/sessions.test.ts`

## Problem

This file is mostly custom menu DOM behavior: rendering sorted session rows, status dots, input actions, delete buttons, URL updates, and captured WebSocket/fetch messages. Those can be covered with happy-dom plus fake fetch/WebSocket/session store.

## Migrate

- `session button shows current session name`
- `opening session button lists sessions with the current one checked + Kill row`
- `session menu shows green/red status dots and lists stored-but-stopped sessions`
- `selecting a session from the menu navigates to its URL`
- `switching session does not trigger a full page reload`
- `Name input in session menu renames the current session on Enter`
- `New session input navigates to the entered name`
- `Kill session row confirms and sends kill on accept`
- `right-click on session button opens the same session menu as left-click`
- `session button has .open class while dropdown is showing`
- `stopped sessions show a delete button; running sessions do not`
- `clicking delete button removes the session via DELETE request`
- `delete button click does not switch to the deleted session`

Suggested unit shape:

- Mount the topbar/session menu DOM in happy-dom.
- Stub `/api/sessions`, `/api/windows`, and `/api/session-settings` via fake `fetch`.
- Stub `window.confirm` for the kill flow.
- Stub WebSocket `send`.
- Dispatch clicks/keypresses and assert DOM rows, class names, URL path changes, DELETE request URL, and WebSocket payloads.

The current Playwright coverage pays browser/server startup cost for behavior that is owned by the client menu modules.
