# Move title TT message DOM coverage to happy-dom

Date: 2026-04-23

## Source

`tests/e2e/title.test.ts`

## Problem

Most tests inject server TT title messages and assert `#tb-title` text content. That is pure client message handling and DOM update behavior.

## Migrate

- `TT title message renders raw unicode in #tb-title`
- `TT title preserves emoji and box-drawing characters`
- `a later TT title fully replaces the earlier one (no leftover chars)`
- `a "session:..."-shaped pane title is shown verbatim (no prefix stripping)`

Suggested unit shape:

- Mount `#tb-title` in happy-dom.
- Initialize the client protocol/message handler with a fake adapter/WebSocket.
- Dispatch TT title messages directly.
- Assert exact `textContent`, including Unicode and replacement behavior.

## Keep in Playwright

Keep `OSC title in the PTY stream does not update #tb-title (regression: no xterm onTitleChange)` in Playwright or another integration test. It depends on xterm parsing an OSC title sequence and proving it does not race the server-driven title path.
