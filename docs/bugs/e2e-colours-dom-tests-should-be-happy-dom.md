# Move colour control E2E coverage to happy-dom

Date: 2026-04-23

## Source

`tests/e2e/colours.test.ts`

## Problem

Both tests drive a settings control and inspect client-side state or outbound WebSocket messages. They do not verify canvas pixels, browser rendering, font loading, or browser quirks.

## Migrate

- `switch colour scheme applies new background hex live`
- `sends colour-variant message on connect and on colour change`

Suggested unit shape:

- Use happy-dom to mount the relevant settings DOM.
- Stub the terminal adapter with an object that records `term.options.theme`.
- Stub the WebSocket send path and `/api/colours`/settings data.
- Change `#inp-colours`.
- Assert the theme background format and the `colour-variant` messages.

These assertions should live near the client colour/session settings tests instead of requiring a Playwright page.
