# Move URL/session message E2E coverage to happy-dom

Date: 2026-04-23

## Source

`tests/e2e/url-session.test.ts`

## Problem

These tests are mostly client routing and state application: path-to-session mapping, `history.replaceState` on server session messages, and applying stored settings to the active adapter/select. They do not verify rendering or browser quirks.

## Migrate

- `URL path becomes session name in WebSocket URL`
- `session change from server updates URL via history.replaceState`
- `server-driven session switch applies the target session's stored settings`

Suggested unit shape:

- Use happy-dom with a fake location/history and fake WebSocket constructor.
- Initialize the client/session routing code at `/main` or `/myproject`.
- Capture the WebSocket URL or session selection used by the connection layer.
- Dispatch a TT `{ session: 'other' }` message.
- Assert `window.location.pathname` changes and the fake adapter/settings select receive the stored settings for `other`.
