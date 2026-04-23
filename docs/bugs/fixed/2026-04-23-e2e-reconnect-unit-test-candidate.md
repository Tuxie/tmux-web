# Move reconnect resize coverage to a unit test

Date: 2026-04-23

## Source

`tests/e2e/reconnect.test.ts`

## Problem

The test closes a mocked WebSocket and waits for a second resize message. It does not verify rendering or a browser-specific quirk; it verifies the connection module's reconnect/open behavior with adapter dimensions.

## Migrate

- `WebSocket reconnect sends resize message on reopen`

Suggested unit shape:

- In happy-dom or a plain unit test, provide a fake WebSocket class that records instances and sent messages.
- Provide a fake adapter with deterministic `cols`, `rows`, and `fit()`.
- Initialize the client connection code.
- Trigger `open`, then `close`, then the reconnect `open`.
- Assert a resize message is sent on both opens and contains the fake adapter dimensions.

This would make the behavior deterministic and avoid the current 10-second Playwright timeout path.
