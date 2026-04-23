# Move OSC 52 consent modal E2E coverage to happy-dom

Date: 2026-04-23

## Source

`tests/e2e/osc52-consent.test.ts`

## Problem

This file explicitly avoids the real OSC 52 integration path and injects the prompt message directly. The tests then assert modal DOM text, Escape dismissal, and outbound decision messages. That is client modal behavior and can be unit tested in happy-dom.

## Migrate

- `renders with program name and three buttons`
- `Escape dismisses the modal`
- `clicking Deny sends a deny clipboard-decision message`
- `clicking Allow once sends an allow-once clipboard-decision`

Suggested unit shape:

- Mount the app shell in happy-dom.
- Initialize the clipboard prompt UI with a fake `send` function.
- Deliver `{ clipboardPrompt: { reqId, exePath, commandName } }` through the client message handler or prompt module API.
- Assert modal text/buttons.
- Dispatch Escape and button clicks.
- Assert modal removal and the exact `clipboard-decision` payload.
