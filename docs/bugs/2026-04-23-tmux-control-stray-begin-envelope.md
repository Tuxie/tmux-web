# tmux -C emits an unattributed %begin/%end envelope after our last command

**Status:** observed, not investigated.
**Date noticed:** 2026-04-23
**Context:** debugging the `cmdnum=1 vs server-global cmdnum` mismatch in `ControlClient` (commit `0eb1cd5`).

## What I saw

While instrumenting `src/server/tmux-control.ts` with stderr probes around `dispatch` / `handleBegin` / `handleResponse` to confirm the cmd-id mismatch, the trace for one WS attach contained an envelope I didn't issue:

```
[ctl-w id=4] display-message -t tmux-web -p "#{pane_title}"
[ctl-begin] cmdnum=88258 headId=4 headTmux=null pendingStale=0
[ctl-resp] cmdnum=88258 headTmux=88258              ← resolves id=4 (mine)
[ctl-begin] cmdnum=88259 headId=undefined headTmux=undefined pendingStale=0   ← envelope I never wrote
[ctl-resp] cmdnum=88259 headTmux=undefined          ← dropped by ControlClient
[ctl-w id=5] list-windows -t tmux-web -F "..."
[ctl-begin] cmdnum=88276 headId=5 headTmux=null pendingStale=0
```

The `cmdnum=88259` envelope appeared between two of *my* writes, with no preceding `[ctl-w]`. The post-fix `ControlClient.handleBegin` correctly marks it stale (no head with `tmuxCmdnum===null`), and `handleResponse` drops it via the `staleCmdnums` set, so today this is harmless.

## Why it might still matter

Today's stale-drop is fortunate. If tmux ever emits such an envelope **while** one of our commands is in flight (head with `tmuxCmdnum===null`), `handleBegin` would currently attribute that cmd-id to our head, and the unrelated envelope's body would be delivered to the wrong caller — silently. The whole reason cmd-id matching exists (and the reason this commit was written) is to prevent exactly that class of misattribution.

Mitigation paths to investigate:
- Identify what tmux command produces cmd-id 88259 in this trace (probably an internal effect of `attach-session` / `session-changed`, since the envelope arrived right after the readiness probe completed and the `%session-changed` notification fired).
- If we can characterise it, treat any `%begin` whose write we didn't issue as stale unconditionally — e.g., gate `head.tmuxCmdnum = cmdnum` on a "we wrote since the last %begin" flag.
- Or: parse / surface tmux's own correlation hints (the `%begin` line carries flags after the cmd-id; reverse-engineering those might let us discriminate).

## Repro

Set `bun src/server/index.ts --listen 127.0.0.1:4099 --no-auth --no-tls --debug` against a real tmux server with at least one session, add stderr probes around the parser callbacks in `ControlClient`, open one WS, watch for a `[ctl-begin]` line whose preceding `[ctl-w]` was already responded to.

## What I was doing when I noticed

Investigating the bigger "window tabs aren't displayed" bug — the cmdnum=1-vs-server-global mismatch — by adding `process.stderr.write` lines to `dispatch` / `handleBegin` / `handleResponse` and running the server against the live `tmux-web` session. The stray envelope showed up in the same trace.
