# Themeable tmux Scrollbar Design

## Goal

Add a themeable scrollbar for tmux scrollback. The scrollbar is not an
xterm.js scrollbar: xterm remains configured with `scrollback: 0` and its
built-in scrollbar hidden. The new control reflects and manipulates tmux's
active-pane scroll state.

The scrollbar must use tmux as the source of truth. Its thumb size and
position reflect tmux state, including scroll changes made from keyboard
copy-mode commands. Client-side input should not maintain a parallel inferred
position.

## User Model

The scrollbar controls the active tmux pane. It does not follow the pane under
the mouse.

Mouse wheel over the terminal is routed through the same scrollbar controller
as wheel over the scrollbar, track clicks, and thumb dragging. This keeps a
single implementation for scrolling behavior instead of separate wheel,
scrollbar, and keyboard paths.

When the active pane is in an alternate-screen application, such as vim, less,
or htop, the scrollbar is unavailable. The scrollbar element receives the
state class `.unavailable`, and terminal wheel events pass through to the
application using the existing SGR wheel path. The `.disabled` class is
reserved for a future user/theme choice where the scrollbar is intentionally
not shown while the scroll controller can still process wheel input.

## Architecture

### Server State

The server subscribes to tmux control-mode format changes through the existing
`TmuxControl` client pool. For each websocket connection, it maintains the
latest active-pane scroll state and sends it to the browser as a new
server-to-client TT message named `scrollbar`:

```ts
{
  scrollbar: {
    paneId: "%3",
    paneHeight: 42,
    historySize: 1200,
    scrollPosition: 0,
    paneInMode: 0,
    paneMode: "",
    alternateOn: false
  }
}
```

The subscribed tmux format is a tab-separated string with these fields in this
order:

- `pane_id`
- `pane_height`
- `history_size`
- `scroll_position`
- `pane_in_mode`
- `pane_mode`
- `alternate_on`

Use `refresh-client -B` for this subscription because tmux reports format
changes from keyboard-driven copy-mode scrolling through that mechanism. The
subscription path must parse `%subscription-changed` notifications in
`src/server/tmux-control.ts` and route relevant updates to the websocket layer.

The subscription update rate is bounded by tmux at roughly once per second.
During pointer dragging, the client may optimistically hold the thumb under the
pointer for responsiveness, but the committed position must be reconciled from
the next tmux state update.

### Client Controller

Add `src/client/ui/scrollbar.ts`. This module owns all scroll input:

- terminal wheel
- scrollbar wheel
- track click
- thumb drag
- future keyboard shortcuts, if added

The existing terminal wheel hook in `src/client/index.ts` delegates to this
controller. The controller either sends a scrollbar action to the server or,
when tmux state says the active pane is in alternate screen, lets the existing
SGR wheel forwarding path run.

Client-to-server messages use one message family:

```ts
{ "type": "scrollbar", "action": "line-up", "count": 3 }
{ "type": "scrollbar", "action": "line-down", "count": 3 }
{ "type": "scrollbar", "action": "page-up" }
{ "type": "scrollbar", "action": "page-down" }
{ "type": "scrollbar", "action": "drag", "position": 840 }
```

Every scroll input path goes through this message family.

### Tmux Commands

The server resolves the active pane and targets tmux commands by pane id at
command time. This avoids applying a gesture to a stale pane after focus
changes.

Scrolling up from live output enters copy mode with exit-at-bottom behavior,
then scrolls:

```text
copy-mode -e -t <pane-id>
send-keys -X -t <pane-id> -N <n> scroll-up
```

Scrolling down while in copy mode sends:

```text
send-keys -X -t <pane-id> -N <n> scroll-down
```

Page actions use tmux copy-mode page commands or counted scroll commands,
whichever proves most reliable in tests. Track clicks map to page up or page
down relative to the current thumb position.

Thumb dragging maps to an absolute desired tmux `scroll_position`. The server
compares the requested target with the latest tmux state and sends a counted
`scroll-up` or `scroll-down` delta. If the current tmux state is stale or the
pane changed, the server should prefer a no-op or a fresh state read over
blindly issuing a large command.

When `alternate_on` is true, the server rejects scrollbar actions as
unavailable. The client should already avoid sending them in this state; the
server guard keeps the protocol robust.

## Layout And Theming

By default, the scrollbar reserves right-side space and terminal fitting
excludes that gutter. This prevents the scrollbar from covering terminal cells.

If the session setting `scrollbarAutohide` is true, the terminal uses the full
available width and the scrollbar overlays the right edge. It becomes visible
on hover, wheel input, drag, and relevant state changes, then hides after a
short idle delay.

Use project-owned `tw-` classes for structure, for example:

- `.tw-scrollbar`
- `.tw-scrollbar-track`
- `.tw-scrollbar-thumb`
- `.tw-scrollbar-autohide`
- `.tw-scrollbar-pinned`
- `.dragging`
- `.unavailable`

Base layout rules live in `src/client/base.css`. Theme material is controlled
with CSS custom properties, with fallbacks to existing gadget and slider
variables so current themes remain usable without immediate edits:

- `--tw-scrollbar-track-bg`
- `--tw-scrollbar-thumb-bg`
- `--tw-scrollbar-thumb-hover`
- `--tw-scrollbar-thumb-active`
- `--tw-scrollbar-track-bevel-hi`
- `--tw-scrollbar-track-bevel-lo`
- `--tw-scrollbar-thumb-bevel-hi`
- `--tw-scrollbar-thumb-bevel-lo`

Theme CSS may override those variables for a custom look. No inline styles
should be added except dynamic CSS custom-property writes that represent live
state, such as thumb position.

## Thumb Math

The thumb is derived from tmux state:

```text
totalScrollableLines = historySize + paneHeight
thumbSize = paneHeight / totalScrollableLines
thumbPosition = scrollPosition / max(historySize, 1)
```

The visual axis is inverted to match user expectation: live bottom places the
thumb at the bottom, and the oldest available history places it at the top.

The implementation should enforce a minimum hit size so the thumb remains
draggable with large histories.

If `historySize` is zero, the thumb fills the track and scroll actions are
no-ops.

## Session Settings

Move toolbar autohide into server-backed per-session settings and add
scrollbar autohide there too:

```ts
topbarAutohide: boolean
scrollbarAutohide: boolean
```

Both default to `false` when missing. Do not migrate the existing local toolbar
autohide value from localStorage or cookies.

The settings menu shows "Autohide toolbar" and "Autohide scrollbar" adjacent
to each other. Toggling either setting saves the current session settings and
immediately refits the terminal because the available viewport may change.

Session switching applies the target session's stored autohide settings at the
same time as the other per-session UI settings.

## Error Handling

If tmux state cannot be read or the control subscription is unavailable, the
server should send an unavailable state rather than letting the client infer
one. The scrollbar can be styled as unavailable and scroll actions should be
ignored until state returns.

If a scrollbar action races with a pane switch, the server should target the
current active pane and rely on the next tmux state update to correct the UI.
For drag actions with absolute positions, stale pane ids should cause a no-op
or fresh state read before applying a large delta.

Client input should be resilient to disconnected websocket state. If the
connection is closed, scroll input is ignored except for alternate-screen SGR
pass-through, which requires an open websocket like existing terminal input.

## Testing

Unit coverage should include:

- pure thumb size and position math
- scrollbar controller routing for wheel, track, drag, autohide, and
  alternate-screen pass-through
- session-settings defaults for `topbarAutohide` and `scrollbarAutohide`
- settings menu wiring for both autohide checkboxes
- websocket router handling for scrollbar messages
- tmux command selection for line, page, and drag actions
- `%subscription-changed` parsing and dispatch in the tmux control client

E2E coverage should include at least one real-tmux path:

- wheel over the terminal enters tmux copy mode and changes tmux
  `scroll_position`
- keyboard-driven tmux copy-mode scrolling updates the scrollbar thumb
- alternate-screen application state marks the scrollbar `.unavailable` and
  lets wheel events pass through to the app
- toggling scrollbar autohide changes terminal fit behavior

Tests should not weaken existing mouse forwarding behavior. The current SGR
wheel sequence path remains necessary for alternate-screen applications.
