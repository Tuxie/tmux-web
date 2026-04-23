# Move mouse event forwarding E2E coverage to happy-dom

Date: 2026-04-23

## Source

`tests/e2e/mouse.test.ts`

## Problem

The tests dispatch mouse/wheel interactions and assert SGR sequences were sent. They do not inspect real rendering, browser selection behavior, or exact coordinate layout. The current assertions only check that the expected SGR prefix/suffix was emitted.

## Migrate

- `click sends SGR mouse press \x1b[<0;...M and release \x1b[<0;...m`
- `drag sends SGR motion sequence \x1b[<32;...M`
- `scroll up sends SGR wheel-up \x1b[<64;...M`
- `scroll down sends SGR wheel-down \x1b[<65;...M`
- `Shift+click does not send any SGR sequence (native selection bypass)`

Suggested unit shape:

- Use happy-dom to create the terminal container.
- Initialize `src/client/ui/mouse.ts` with a fake adapter exposing stable dimensions and a fake send/write callback.
- Dispatch `mousedown`, `mouseup`, `mousemove`, and `wheel` events with coordinates.
- Assert the collected SGR messages.
- Dispatch shift-modified events and assert no SGR message is emitted.

If exact coordinate translation becomes the important behavior, include explicit col/row assertions in the unit test rather than using Playwright just to check prefixes.
