# Empty windows menu on cold start

**Status:** fixed 2026-04-24.
**Date noticed:** 2026-04-24
**Reported by:** user

## Fix summary

Two layered changes:

1. `ws.ts` title-change branch no longer blindly overwrites
   `state.lastSession` with the OSC-detected session. The new
   `TmuxControl.hasSession(name)` predicate validates the candidate
   against the live control-pool clients first; only known sessions
   trigger a session change + `sendWindowState` refresh. Unknown ones
   (typical shell prompt OSC `\x1b]0;user@host:~/p\x07`) ship as
   title-only frames under the registered session.
2. `sendWindowState` and `broadcastWindowsForSession` no longer ship
   `windows: []`. A tmux session always has ≥1 window, so an empty
   list means the query failed — the field is omitted instead, so the
   client's `if (msg.windows)` gate keeps the cache untouched.

## What I see

Starting a fresh `tmux-web` with no prior tmux server running, the
windows menu is often empty. Sometimes a Shift+Reload in the browser
populates it; sometimes it stays empty across reloads.

A tmux session **always** has at least one window (you cannot create
or attach to an empty session — `new-session` always creates window 0).
So `windows: []` is never the truth for a live session; it's always
either a stale-cache problem or a misdirected query.

## Suspected root cause

`src/server/ws.ts` keeps two session names per connection:

- `state.registeredSession` — the URL `?session=` parameter. Stable.
- `state.lastSession` — initially the URL session, but **overwritten**
  by OSC title sniffing at `ws.ts:240-243`:

  ```ts
  pty.onData((data) => {
    const result = processData(data, state.lastSession);
    ...
    if (result.titleChanged && result.detectedTitle !== state.lastTitle) {
      state.lastTitle = result.detectedTitle || '';
      if (result.detectedSession) state.lastSession = result.detectedSession;
      void sendWindowState(ws, state.lastSession, opts);
    }
  });
  ```

`processData` extracts `detectedSession` by splitting the OSC 0/2 title
on `:` and taking the first part (`src/server/protocol.ts:63`). The
regex matches *any* OSC 0/2 — including the title that the user's shell
emits from its prompt:

```bash
# default zsh / bash on most distros:
\x1b]0;user@host:~/path\x07
```

So `state.lastSession` flips from `"main"` (URL) to `"user@host"` the
moment the shell paints its first prompt. Then `sendWindowState(ws,
"user@host", opts)` runs:

```ts
const [winResult, titleResult] = await Promise.allSettled([
  opts.tmuxControl.run(['list-windows', '-t', 'user@host', ...]),
  opts.tmuxControl.run(['display-message', '-t', 'user@host', ...]),
]);
const windows = winResult.status === 'fulfilled'
  ? winResult.value.trim().split('\n').filter(Boolean).map(...)
  : [];
ws.send(frameTTMessage({ session: "user@host", windows, title }));
```

`list-windows -t user@host` fails (no such session) — winResult is
rejected → `windows = []` → the message `{session: "user@host",
windows: []}` ships to the client → `message-handler.ts:25` calls
`updateWindows([])` → the topbar's `cachedWindows` becomes `[]` and
the menu re-renders empty.

There is also a second `sendWindowState` chained on `attachSession`
(`ws.ts:253-254`) which uses the **URL session**, not `state.lastSession`,
and which *does* return a populated list. The race between the two
determines what the user sees:

| Order | Result |
|-------|--------|
| chained-on-attach first, then OSC-title | empty (the bad one wins) |
| OSC-title first, then chained-on-attach | populated |

Cold-start tmux is slow to probe (≈ 100–300 ms), and the shell prompt
fires its OSC title within 10–50 ms of the PTY going live. So the
"empty wins" ordering is the common case on a fresh server. After
Shift+Reload the tmux server is warm and the chained sendWindowState
sometimes wins — explaining the user's "sometimes a reload helps".

There is a smaller secondary issue: even on the URL-session path, if
the chained sendWindowState fires before the control client is in
`insertionOrder` (race against probe completion), `tmuxControl.run`
rejects with `NoControlClientError` and again `windows = []`.
`attachSession.then()` should prevent this on paper, but the
implementation chains via the cached `readyPromises` entry, and the
oldest-alive promotion happens inside `startSession` *after* probe
resolves — there is no atomic "this client is now in `insertionOrder`"
hook. Whether this race fires in practice is unclear; needs
instrumentation.

## Why this matters

The user's invariant is correct: `windows: []` for a live session is
not just a UX glitch, it's a wire protocol lie. The server should
never send it. Treating "empty windows list" as a bug rather than
plausibly-truthful data also closes off a class of future races where
some other code path computes empty by accident.

## Repro

1. `tmux kill-server` (ensure no tmux running)
2. `bun src/server/index.ts --debug`
3. Open the browser to `https://localhost:7878/?session=main`
4. Watch the windows tab strip / open the windows menu
5. Reload (Shift+Reload) — sometimes fixes, sometimes not

Server-side `--debug` shows the `attachSession(...)` log; tail the WS
frames with a probe script to see the order of `{windows: []}` vs
`{windows: [...]}` messages.

## Fix plan

Two layered fixes; pick both for defense in depth.

### Fix 1: stop trusting OSC titles for session identity

The OSC-title-sets-session heuristic predates control mode. Pre-control,
tmux's session name leaked through the terminal title because the user
might have set a `set-titles-string` template that included `#S`, and
sniffing it was the cheapest way to learn about external session
changes. With control mode, `%session-changed` events drive that
properly via `tmux-control.ts`'s `onNotification`.

Concrete change:
- `ws.ts:242` — remove the `state.lastSession = result.detectedSession`
  assignment. `lastSession` should only change via:
  (a) explicit `switchSession` action from the client, or
  (b) `%session-changed` from control mode.
- `ws.ts:243` — remove the `void sendWindowState(...)` call from this
  branch. Title changes are title changes; they don't imply windows
  changed. Title is already pushed via the chained `sendWindowState`
  on attach and via `%window-renamed` events.
- `state.lastSession` field can probably be deleted entirely after
  this — replace every read with `state.registeredSession`. Audit:
  `ws.ts:229,243,291,373,399,409,444,453,454,457,465`.

This fixes the wrong-session query at the source.

### Fix 2: server never emits `windows: []`

Defense-in-depth: even if some future bug computes empty windows,
the server should refuse to push it.

Concrete change in `sendWindowState`:
```ts
const windows = winResult.status === 'fulfilled' ? parse(winResult.value) : null;
const title = titleResult.status === 'fulfilled' ? titleResult.value.trim() : undefined;
if (ws.readyState === WS_OPEN) {
  // Tmux sessions always have ≥1 window. An empty list means our query
  // failed — omit the field so the client keeps its existing cache.
  const msg: ServerMessage = { session: sessionName };
  if (windows && windows.length > 0) msg.windows = windows;
  if (title !== undefined) msg.title = title;
  ws.send(frameTTMessage(msg));
}
```

Same for `broadcastWindowsForSession` (`ws.ts:769-790`).

The client-side `message-handler.ts:25` already guards with `if
(msg.windows)`, so omitting the field cleanly avoids an
`updateWindows([])` call.

### Tests to add

Unit:
- `sendWindowState` returns a valid list → `{session, windows, title}`
  emitted with the populated list. (existing coverage)
- `sendWindowState` with the underlying `tmuxControl.run` rejecting →
  `{session, title}` emitted with NO `windows` field. (new)
- ws-handle-connection: a PTY-emitted OSC `\x1b]0;user@host:~\x07` does
  NOT cause `state.lastSession` to mutate, and does NOT trigger a
  redundant `sendWindowState`. (new)

Real-tmux e2e:
- Boot fresh tmux server. Open WS. Assert the first `{windows}` push
  has length ≥ 1 and never `[]`. Run 10 cold-start iterations to catch
  the race. (new)

## Touchpoints

- `src/server/ws.ts` — handleOpen onData callback, sendWindowState,
  broadcastWindowsForSession, every read of `state.lastSession`.
- `src/server/protocol.ts` — `detectedSession` field becomes unused
  after fix 1. Either delete it or leave it for `detectedTitle`'s sake
  (title-only OSC). Decision: keep, but `detectedSession` field can
  be dropped or marked unused.
- `src/client/message-handler.ts` — no change needed (already
  `if (msg.windows)` gated).
- `tests/unit/server/ws-handle-connection.test.ts` — add OSC-title
  no-mutation case.
- `tests/unit/server/ws.test.ts` (or wherever sendWindowState lives) —
  add empty-windows-omitted case.
- `tests/e2e/cold-start-windows.spec.ts` — new real-tmux e2e.

## Leave alone

- The chained `sendWindowState` on `attachSession.then(...)` —
  it's the correct path.
- `processData` OSC parsing — keeps working for title-only updates
  (`detectedTitle` is still consumed correctly).
- The control-mode `%window-*` event broadcast path — orthogonal.
