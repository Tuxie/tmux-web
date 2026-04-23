# Move topbar autohide E2E coverage to happy-dom

Date: 2026-04-23

## Source

`tests/e2e/topbar.test.ts`

## Problem

The tests only dispatch mouse movement and assert the `hidden` class on `#topbar`. They do not need real rendering. The behavior can be made faster and less timing-sensitive with fake timers in a unit test.

## Migrate

- `topbar auto-hides after inactivity`
- `topbar reappears when mouse moves near top`

Suggested unit shape:

- Mount `#topbar` in happy-dom.
- Enable the autohide preference in localStorage or through the topbar API.
- Initialize the topbar handler.
- Dispatch `mousemove` events with `clientY` near and away from the top.
- Use fake timers to advance the 1s hide timeout.
- Assert the `hidden` class toggles.
