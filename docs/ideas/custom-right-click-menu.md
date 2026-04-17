# Custom right-click menu that respects per-pane mouse mode

## What we want

Replace tmux's built-in `MouseDown3Pane` menu with a tmux-web-owned
context menu (copy, paste, "open link", "split pane", "paste dropped
file", etc.) — but *only* when the foreground program in the pane
under the cursor isn't itself using mouse reporting. If vim or htop
is running in that pane, the right-click must still reach the app.

## Why the naive approach fails

"Just check xterm.js's `_coreMouseService.activeProtocol`" doesn't
work in tmux.

Mouse mode in tmux is **per-pane state**. When a program inside a
pane sends `CSI ? 1000 h` / `1006 h` / etc., tmux intercepts the
sequence and records it as that pane's mouse-mode state. It does
*not* forward the DECSET to the outer terminal. The outer terminal
(xterm.js here) only ever sees tmux's aggregate mouse state — which
is essentially "on" whenever `set -g mouse on` is active.

So a client-side check on xterm's active protocol has the same value
whether the cursor is over a vim pane or a bash pane. Useless for our
routing decision.

## Approaches that would work

### 1. Query tmux at click time

On right-click, before deciding whether to show our menu:

```bash
tmux display-message -p -t '=%<paneid>' '#{?mouse_any_flag,1,0}'
```

…where `paneid` comes from computing which pane the click fell on
(tmux has `#{pane_at_x}` / `#{pane_at_y}` formats, or we can compute
it client-side from the pane layout we already know for the
window-tab strip).

- **Pros:** no persistent extra connection; works with any tmux
  version that has `mouse_any_flag` (3.0+).
- **Cons:** ~5–20 ms round-trip per right-click (noticeable but
  tolerable); race window between the query and the click (app could
  toggle mouse mode in between, though that's rare).

### 2. Push per-pane mouse state from the server

Run a tmux control-mode (`tmux -C attach`) connection alongside the
PTY, subscribe to the relevant hooks:

- `pane-focus-in` / `pane-focus-out`
- `client-session-changed` / window/layout change hooks
- (tmux also exposes `%mouse-mode-changed` or similar events in
  control mode — verify the exact event name per version)

…and stream a `{ paneId: mouseMode }` map to the client over WS as
another `\x00TT:` message type. Client decides synchronously.

- **Pros:** zero added latency on the click; state is always fresh.
- **Cons:** extra tmux connection to keep alive; more code surface;
  have to handle the control connection reconnecting in lockstep with
  the PTY one.

## Other considerations regardless of approach

- **Shift+right-click** should keep its current behaviour: bypass
  everything, hand to tmux (or the browser, depending on what we
  want). That's the user's escape hatch.
- **Customised `MouseDown3Pane` bindings in the user's tmux.conf
  won't carry over.** If the user has bound right-click to something
  non-default, taking it over is a regression. Worth a CLI flag
  (`--own-right-click` off-by-default?) or a settings toggle.
- **Pane boundary hit-testing**: we already know the pane geometry
  for the window-tab strip — clicking on a pane split requires
  computing which pane the coordinates fall inside. Approach 1 can
  ask tmux itself (`#{pane_at_x,y}`) at query time; approach 2 needs
  us to track layout client-side.
- **Copy-mode panes** are a third state: the app isn't consuming
  mouse events, but tmux's copy mode is. Right-click in copy mode
  should probably still be tmux's (or invoke our "copy selection" if
  we want to replace it there too).

## Recommendation

If this feature lands, start with **approach 1** — the extra round
trip is acceptable for a context menu, the code surface is tiny
compared to a control-mode session, and it degrades gracefully if
tmux is busy (fall back to tmux's built-in menu by not calling
`preventDefault`).

Only upgrade to approach 2 if the latency becomes visible or if
we end up needing the same pane-state stream for other features
(e.g. showing an indicator in the topbar when a pane's app owns the
mouse).

## Not blocking anything

This is a pure UX nicety — tmux's built-in menu is fine. Park
until someone asks for it specifically.
