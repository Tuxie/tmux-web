# Window add / rename / close in non-primary sessions never reaches the client

**Status:** observed empirically, not investigated beyond the surface.
**Date noticed:** 2026-04-23
**Context:** answering the question "do we get notified about created, deleted and renamed windows in other sessions?" while reviewing the cmd-id and `-u` fixes from the same session.

## What I saw

Test setup: a single `tmux -C attach-session -t sA` control client connected to a tmux server that hosts both sessions `sA` and `sB`. I then mutated `sB`'s windows from a separate tmux client and grepped the control stream for `%window-*` and `%session-*` events.

```
$ # operations performed on sB while attached to sA:
$ tmux new-window      -t sB -n B-new
$ tmux rename-window   -t sB:0 B-renamed
$ tmux kill-window     -t sB:1
$ # operations performed on sA (the attached session):
$ tmux new-window      -t sA -n A-new
$ tmux rename-window   -t sA:0 A-renamed

=== %-events seen on the sA-attached control client ===
%session-changed         $0 sA
%session-window-changed  $1 @2     ← sB active-window pointer (no name, no detail)
%session-window-changed  $1 @1
%session-window-changed  $0 @3
%window-add              @3        ← sA only
%window-renamed          @0 A-renamed   ← sA only
                                     (sB add / rename / close: silent)
```

So tmux itself emits `%window-add` / `%window-renamed` / `%window-close` only for the session the control client is attached to. For other sessions, the only signal is `%session-window-changed <session-id> <active-window-id>` when their *active* pointer moves — no name, no add/close detail.

## How our code makes it worse

`ControlPool.onNotification` in `src/server/tmux-control.ts` drops every notification that didn't come from `insertionOrder[0]` (the primary). The comment justifies it as "non-primary clients' notification streams are parsed and dropped (they would duplicate the primary's global events)" — true for *global* events like `%sessions-changed`, false for the per-session `%window-*` events that only fire on the session-specific client.

Net effect: even though we *do* spawn one control client per attached session (every WS open calls `attachSession(name)`), all but the primary's `%window-*` notifications are discarded. A user with WS tabs to both `sA` and `sB`, primary attached to `sA`, will see `sA`'s window adds/renames/closes pushed to the browser in real time but `sB`'s never arrive.

## What I want instead

The user wants the topbar's session dropdown to eventually show per-session window information (name lists, counts, window titles), not just session names. That requires us to react to **window events from every attached control client**, not just the primary. Concretely:

- **Global events** (`%sessions-changed`, `%session-renamed`, `%session-closed`) should keep coming from `insertionOrder[0]` only — the dedupe logic there is correct.
- **Session-scoped events** (`%window-add`, `%window-renamed`, `%window-close`) should be honoured *from each session's own control client*: the client tells us which session it belongs to (or we already know — we keyed it by `session` in `clients`), so we can route the notification to "refresh windows for THIS session" rather than guessing the owning session via `display-message` after the fact.

Bonus: this also lets us drop the `windowClose → fan-out-to-every-session` workaround in `src/server/ws.ts` that exists today because the closing-session is no longer queryable from the primary at the time the event fires (`display-message -t @<closed>` errors out). With the per-client approach the originating session is intrinsic to which control client emitted the event.

`%session-window-changed` should still trigger a `list-windows` refresh for the named session, since that's our only signal for "active pointer moved in some other session" (e.g., when an unrelated tmux client switches windows there).

## Likely shape of the fix

1. Augment `ControlPool.onNotification(from, n)` to:
   - Forward global events only when `from === insertionOrder[0]` (status quo).
   - Forward session-scoped events with the session name attached, so `ws.ts` listeners can route directly: `(n, sessionName) => …`.
2. Track session ownership for each `ControlClient`: the pool already does (`this.clients: Map<string, ControlClient>`), so a reverse-lookup or storing the session on the client is trivial.
3. Update the `ws.ts` subscriptions to take the session name from the notification rather than re-querying via `sessionForWindow` / fan-out-everywhere.
4. Add an integration test using two fake spawns (one per session), assert that a `%window-add` from the non-primary client triggers a windows refresh for *that* session.

## Repro

`src/server/tmux-control.ts` `ControlPool.onNotification` lines around 364–369. The discarded path is `if (this.insertionOrder[0] !== from) return;` — that's the early return that swallows non-primary `%window-*` events.

## What I was doing when I noticed

User asked whether the control session sees window events from other sessions. I ran the empirical test above (separate tmux server, control client attached to `sA`, mutations targeting `sB`), saw that tmux itself doesn't emit `%window-*` for non-attached sessions, then read `ControlPool.onNotification` and confirmed that even the per-session control clients we spawn would have their notifications dropped on top of that.
