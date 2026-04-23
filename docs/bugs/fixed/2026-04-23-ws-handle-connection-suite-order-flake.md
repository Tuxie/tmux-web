# ws-handle-connection tests fail in full-file run but pass directly

**Status:** fixed 2026-04-23.
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

## Root cause

`fake-tmux.ts` called `sync` on every invocation of the fake tmux binary, immediately after logging the command to the log file. On this host (Proxmox VE with a real disk), `sync` flushes the entire system's dirty page cache and takes ~2.7 s.

A single `sendWindowState` call issues three fake-tmux invocations sequentially: `select-window` (triggered by the window action), then `list-windows` and `display-message` in parallel. Three `sync` calls at ~2.7 s each pushed total latency past the 8 s `waitForMsg` timeout:

- `select-window`: 2.7 s
- `list-windows` / `display-message` (parallel): 2.7 s
- Total: ~5.4 s — close to the 8 s limit. Under heavier background I/O, the first `sync` can exceed 5 s, putting total over 8 s.

The `sync` was unnecessary. POSIX `append` writes via `printf` are atomic for payloads under `PIPE_BUF` (4096 bytes) — as the comment already noted. Tests read the log via `fs.readFileSync`, which reads from the kernel page cache; the write is visible immediately to another process on the same host without any explicit flush.

## Fix

Removed `sync 2>/dev/null || true` from the fake-tmux bash script template in `tests/unit/server/_harness/fake-tmux.ts`. The comment above the `printf` line was updated to explain that no sync is needed. 8/8 consecutive full-suite runs passed after the change (compared to ~20% failure rate before).
