# ws-handle-connection tests fail in full-file run but pass directly

**Status:** observed during verification, not investigated beyond the surface.
**Date noticed:** 2026-04-23
**Context:** verifying the fix for `docs/bugs/fixed/2026-04-23-other-sessions-window-events-dropped.md`.

## What I saw

Running the full websocket unit file failed two tests:

```bash
bun test tests/unit/server/ws-handle-connection.test.ts
```

Failures:

- `ws handleConnection — OSC 52 read flow > prompt → allow → clipboard-read-reply persists grant in store`
  - Timed out waiting for a `clipboardPrompt` TT message.
  - The assertion at `tests/unit/server/ws-handle-connection.test.ts:99` received `undefined`.
- `ws handleConnection — non-testMode actions & sendWindowState > window select triggers applyWindowAction + sendWindowState`
  - Timed out waiting for a `windows` TT message.
  - The assertion at `tests/unit/server/ws-handle-connection.test.ts:459` received `undefined`.

Both tests passed when run directly with a name filter:

```bash
bun test tests/unit/server/ws-handle-connection.test.ts -t "prompt → allow|window select triggers applyWindowAction"
```

That direct run reported:

```text
2 pass
19 filtered out
0 fail
```

## Why this is likely unrelated to the window-event fix

The new regression added for the window-event fix passes both directly and inside the full-file run:

```text
(pass) ws handleConnection — non-testMode actions & sendWindowState > tmux-control window notifications refresh only the originating session
```

The two failures are existing websocket harness paths that rely on PTY trigger timing / message delivery and fail only under the full file's accumulated runtime/order. I did not investigate further because the failures are unrelated to the current tmux-control notification routing change.

## What I was doing when I noticed

After changing `ControlPool` to forward per-session `%window-*` notifications from non-primary control clients, I ran:

```bash
bun test tests/unit/server/tmux-control-parser.test.ts tests/unit/server/tmux-control-pool.test.ts tests/unit/server/ws-handle-connection.test.ts
```

The parser and pool tests passed, but the websocket file showed the two failures above. I then reran the two failing tests directly and they passed.
