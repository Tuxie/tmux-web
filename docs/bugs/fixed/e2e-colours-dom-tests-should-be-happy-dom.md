# Move colour control E2E coverage to DOM unit tests

Date: 2026-04-23

Fixed: 2026-04-25

## Source

`tests/e2e/colours.test.ts`

## Problem

Both tests drove a settings control and inspected client-side state or outbound WebSocket messages. They did not verify canvas pixels, browser rendering, font loading, or browser quirks.

## Resolution

The colour application and colour-variant message logic now lives in `src/client/colour-controls.ts`, with DOM unit coverage in `tests/unit/client/colour-controls.test.ts`.

The replacement tests use the repo's existing `jsdom` dependency instead of adding `happy-dom`. They mount `#page` and `#inp-colours`, stub terminal theme application and WebSocket sends, change the colour select, and assert both the composed `rgba(...,0)` terminal background and the dark/light `colour-variant` messages.
