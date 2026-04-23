# Move session inheritance E2E coverage to happy-dom

Date: 2026-04-23

## Source

`tests/e2e/session-inheritance.test.ts`

## Problem

Both tests use a mocked session store, change form controls, navigate between paths, and assert stored settings. They do not need real rendering or browser quirks.

## Migrate

- `new session inherits live session's settings`
- `theme switch overwrites colours and font in active session`

Suggested unit shape:

- Use happy-dom with `history.pushState`/path changes or call the session-settings logic directly.
- Provide fixture theme/colour/font data and a fake session store.
- Change `#inp-colours`, `#inp-opacity`, or `#inp-theme`.
- Assert the stored `main` and `fresh-sess` settings.
- For the theme-switch case, assert the active session receives the target theme defaults for `colours` and `fontFamily`.
