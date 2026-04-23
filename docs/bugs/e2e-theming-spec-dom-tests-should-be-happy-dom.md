# Move theming spec DOM coverage to happy-dom

Date: 2026-04-23

## Source

`tests/e2e/theming.spec.ts`

## Problem

Most tests in this Playwright spec exercise theme/settings DOM state, fixture option population, fallback selection, custom dropdown labels, and mocked session-store updates. They do not verify browser rendering, WebGL/canvas pixels, real font loading, or tmux/server behavior.

The two control-mode `.spec.ts` files were checked too:

- `tests/e2e/control-mode-window-size.spec.ts` should stay Playwright because it uses a real tmux server, viewport sizing, and tmux-reported window dimensions.
- `tests/e2e/control-mode-notifications.spec.ts` should stay Playwright because it verifies a real tmux `%session-renamed` notification reaches an attached WebSocket.

## Migrate

- `fixture primary theme loads, terminal renders`
- `Theme dropdown lists the fixture themes`
- `unknown saved theme falls back to the first bundled theme without crashing`
- `colours trigger label reflects the saved value on initial render`
- `reset colours resets background hue and TUI opacity to theme defaults`
- `font picker is populated from the fixture`

Suggested unit shape:

- Mount the app shell/settings DOM in happy-dom, including `#theme-css`, `#terminal`, `#btn-menu`, `#inp-theme`, `#inp-colours`, `#inp-font-bundled`, `#btn-reset-colours`, and the paired slider inputs.
- Provide fixture theme, colour, and font data via fake `fetch` or the same helper layer used by unit tests.
- Stub the terminal adapter so app initialization can run without xterm/WebGL.
- Assert the theme stylesheet href, theme/font option lists, fallback behavior for unknown saved theme/colours, custom colour dropdown label synchronization, and reset-to-theme-default session-store updates.

If keeping one browser-level smoke test is still useful, narrow it to proving the real fixture theme pack loads in Playwright. The detailed dropdown and reset behavior belongs in happy-dom unit coverage.
