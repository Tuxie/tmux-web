# Move DOM-only clipboard E2E coverage to happy-dom

Date: 2026-04-23

## Source

`tests/e2e/clipboard.test.ts`

## Problem

The test `\x00TT clipboard message decodes base64 and writes to navigator.clipboard` does not need a real browser. It stubs `navigator.clipboard`, injects a TT message, and asserts that the decoded text was passed to `writeText`.

That behavior is client message-handling and clipboard-module wiring. It can be covered faster and more locally with a happy-dom unit test.

## Migrate

- `\x00TT clipboard message decodes base64 and writes to navigator.clipboard`

Suggested unit shape:

- Set up happy-dom with a stubbed `navigator.clipboard.writeText`.
- Initialize the client clipboard/message handler with a fake or minimal WebSocket/message dispatch path.
- Deliver `\x00TT:{"clipboard":"SGVsbG8="}`.
- Assert `writeText` was called with `Hello`.

## Keep in Playwright

Keep `OSC 52 in PTY stream triggers server-side interception and clipboard write (integration)` in e2e. It exercises the server PTY echo/interception path plus browser delivery, which is real integration coverage.
