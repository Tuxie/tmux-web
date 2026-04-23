# tmux -C control clients leak across bun server restarts

**Status:** fixed.
**Date noticed:** 2026-04-23
**Context:** running `ps -ef` to inspect the live production tmux-web while debugging the `cmdnum` mismatch.

## What I saw

```
$ ps -ef | grep 'tmux.conf -C attach-session' | grep -v grep | awk '{print $3}' | sort | uniq -c
     66 1175365     ← systemd --user (adopted; original bun parent died)
      2 2719012     ← currently-live bun
      1 2696089     ← stale bun
      1 2642206     ← stale bun
```

70 total `tmux -f /run/user/1000/tmux-web/tmux.conf -C attach-session -t <session>` processes are alive. 66 of them have been re-parented to systemd, meaning the bun process that spawned them exited without reaping its control-client children. A handful of long-dead bun PIDs still own the rest.

## Why this matters

- Every orphaned control client holds an open stdout pipe + a PTY-less attach against tmux. tmux's `list-clients` will return all of them, which:
  - Inflates `#{server_clients}` formats.
  - Slows broadcast operations tmux runs across all clients (status redraw, etc.).
  - Eats file descriptors on long-running hosts.
- Each one is also a tmux-side `attached` client, so under non-`latest` window-size policies they could still influence size negotiation. Under our shipped `latest` they're inert.
- Restart cycles compound the leak: each `systemctl --user restart tmux-web` (or each `make dev` cycle) adds another N. Over time it grows unboundedly.
- **User-visible symptom (added 2026-04-23):** every new attach to a session N orphans deep blocks ~30 ms × N waiting for tmux's per-client broadcast/serialisation. After the live host accumulated 79 control clients on `tmux-web` (78 orphans + 1 live), switching browser tabs to that session took ~2.5 s before the new PTY produced its first byte. The empty `main` session (1 client) attached in 38 ms. Confirmed by spawning two PTYs in sequence against the live tmux server: PTY1 first byte at 35 ms, PTY2 first byte at 2 515 ms; against a fresh tmux server with the same conf, PTY2 attached in 3 ms.

## Repro

1. Start the dev server: `make dev`.
2. Open a browser tab against it; observe one new `tmux ... -C attach-session ...` child of bun.
3. Kill the bun parent (Ctrl-C / `kill <bun-pid>`).
4. Re-run `ps -ef | grep 'tmux.*-C attach-session' | grep -v grep` — the child is now reparented to PID 1 (or systemd) instead of being reaped.

## Likely fix paths

- `ControlPool.close()` calls `kill()` on every client, but `process.on('exit')` in `src/server/index.ts` schedules the close as fire-and-forget. If bun exits before the SIGTERMs flush, the children survive. Need a synchronous teardown (or a `SIGTERM` handler that awaits `tmuxControl.close()` before exiting). **(Partially fixed in commit registering SIGINT/SIGTERM/SIGHUP handlers — future Ctrl-C of bun no longer leaks. Existing orphans on the live host still need a manual cleanup; sandbox refused mass-kill, so the user has to `tmux kill-server` or `pkill -f 'tmux.*-C attach-session.*-t tmux-web'`.)**
- `Bun.spawn` in `createTmuxControl` doesn't pass `serialization` / `stdio` flags that would die-with-parent. Linux `prctl(PR_SET_PDEATHSIG)` from the child or simply piping stdin so EOF kills tmux on parent death would help. Belt-and-braces against `SIGKILL` of the parent, which the signal-handler fix can't catch.
- Audit: do we ever call `proc.kill()` on the control client when its `proc.exited` fires unexpectedly? `evictClient` removes it from pool tracking but doesn't kill the proc — and if it's already exited that's fine, but if the bun parent is the one dying, tmux is still alive.

## Fixed root cause

The signal handlers already covered fully-attached control clients, but
`ControlPool.close()` only killed clients after they had been inserted into
`insertionOrder`. A control client spawned during `attachSession()` but still
waiting for the readiness probe lived only in the local `startSession()` stack
frame. If shutdown happened in that window, `close()` had no reference to kill
it before process exit.

The fix tracks these starting clients separately and includes them in
`ControlPool.close()`. The regression test `close kills clients that are still
completing their attach probe` verifies the previously missed shutdown window.

## What I was doing when I noticed

Probing the live tmux-web server (`ps`, `pstree`) to confirm that the cmdnum-mismatch fix had landed and that the `refresh-client -C` size came through correctly. The `list-clients` output for the `tmux-web` session showed dozens of `client-* attached,focused,control-mode` entries, which led me to count the `tmux -C` processes systemwide.
