# Session switch tears down the PTY tmux client and spawns a new one — multi-second stall against busy sessions

**Status:** observed, root cause confirmed, not yet fixed.
**Date noticed:** 2026-04-23
**Context:** investigating "two-second delay when switching sessions" reported by the user, after the orphan-`-C`-clients fix landed.

## What the user sees

Switching from a busy tmux session (e.g. `tmux-web` with several real PTY clients attached and a heavy foreground process like `claude`) to another session via the topbar's session dropdown stalls for 2–4 seconds before the new session paints. The stall is not constant — it scales with how busy the *outgoing* session is. Switching to/within an empty session is sub-50 ms.

## Why it happens today

On every session switch, the client tears down the entire WebSocket and the server's PTY tmux client with it, then spawns a new PTY tmux client attached to the new session. This is the **"reconnect"** flow:

1. **`src/client/index.ts:194-203`** — `onSwitchSession` callback:
   ```ts
   onSwitchSession: (name) => {
     topbar.updateSession(name);    // history.replaceState + per-session settings
     connection.reconnect();        // close the WS + open a new one with ?session=name
   },
   ```
2. **`src/client/connection.ts:59-69`** — `reconnect()` closes the current WS and immediately opens a new one. The new WS URL contains `?session=<new-name>` (built in `src/client/index.ts` from `getSession()` after `updateSession`).
3. **`src/server/ws.ts:276-291`** — `handleClose` for the old WS:
   - Calls `state.pty?.kill()` on the *old* PTY tmux client (`tmux ... new-session -A -s <old>`).
   - Decrements `sessionRefs` and calls `tmuxControl.detachSession(<old>)` if no other tab is on that session.
4. **`src/server/ws.ts:199-265`** — `handleOpen` for the new WS:
   - Spawns a *new* PTY tmux client with `tmux ... new-session -A -s <new>`.
   - Calls `tmuxControl.attachSession(<new>, {cols, rows})`.

Step 3's PTY kill triggers tmux server-side detach processing for the busy `tmux-web` session: with `window-size latest` the leaving client's 200×60 was the latest size vote, tmux must pick a new size from the remaining clients, fire SIGWINCH on every pane in the session, and pump those panes' redraw bytes through tmux's single-threaded event loop. Step 4's new attach to the *other* session (`main`) sits behind that work in the same event loop and waits — measured at ~4 s for `tmux-web` → `main`, and at "never paints in 1.5 s" in a tighter back-to-back probe.

Empirical isolation (run from `/src/tmux-web`):

```ts
// Baseline attach to `main`, no preceding activity:
//   first byte at 28 ms.
//
// Attach to `main` immediately after detaching from `tmux-web`:
//   first byte at 4000 ms / never within 1.5 s.
//
// Attach to `main` immediately after detaching from a freshly-created
// empty session (`testlight`):
//   first byte at 30 ms.
```

So the cost is in tmux's processing of the *busy* session's detach, gating the new attach behind it. It is not (only) about orphan `-C` clients (a separate already-mitigated bug, `2026-04-23-tmux-c-clients-leak-on-restart.md`).

## Desired fix: keep the WS open, switch via `tmux switch-client -t <new>`

Don't tear down the PTY tmux client on session switch. The same `tmux ... new-session -A -s <orig>` client process can move between sessions via `tmux switch-client -t <new>` (or, equivalently for control-mode peers, `switch-client` from a control client targeting our PTY client). No detach, no SIGWINCH storm on the leaving session, no race for tmux's main loop. The user's terminal is repainted with the new session's content as a normal redraw, in tens of milliseconds.

`switch-client` is a server-side, fire-and-forget operation. It does not require any client-side reconnect, URL-only history change is enough.

## Concrete implementation steps

The work spans client connection logic, server WS routing, and the tmux-control plumbing. Order matters; each step compiles + tests cleanly on its own.

### 1. Add a new client-to-server message type

`src/shared/types.ts` — declare a `SwitchSessionMessage`:

```ts
export interface SwitchSessionMessage {
  type: 'switch-session';
  /** The target tmux session name. Server validates and sanitises. */
  name: string;
}
```

…and ensure it's covered by whichever `ClientMessage` union the WS router consumes (`src/server/ws-router.ts` currently doesn't have a typed union; it pattern-matches by `parsed.type`).

### 2. Route it in `src/server/ws-router.ts`

Add a new branch under `routeClientMessage`:

```ts
if (parsed?.type === 'switch-session' && typeof parsed.name === 'string') {
  return [{ type: 'switch-session', name: parsed.name }];
}
```

…and extend `WsAction` accordingly:

```ts
| { type: 'switch-session'; name: string }
```

### 3. Handle the action in `src/server/ws.ts`

`dispatchAction` in `src/server/ws.ts` (around line 388) gets a new case. The handler should:

a. Sanitise the new name with the existing `sanitizeSession` helper from `src/server/pty.ts` (the same one used by `handleOpen`).
b. Update `ws.data.state.lastSession` to the new name BEFORE issuing the tmux command, so subsequent OSC-title pushes / drop notifications carry the right session name.
c. Move this WS connection between the per-session bookkeeping sets:
   - Decrement `reg.sessionRefs.get(oldSession)`; if it hits zero, remove from `wsClientsBySession` and call `opts.tmuxControl.detachSession(oldSession)`.
   - Increment `reg.sessionRefs.get(newSession)` (or seed at 1); add this `ws` to `wsClientsBySession.get(newSession)` (creating the Set if needed); update `state.sessionSet` to the new Set.
d. Call `opts.tmuxControl.attachSession(newSession, { cols, rows })` so the per-session control client exists for `%window-*` notifications etc.
e. Issue `opts.tmuxControl.run(['switch-client', '-c', '<our-client-name>', '-t', newSession])` to retarget the PTY tmux client. **The `-c` value is the tricky bit**: see "Identifying our PTY client to tmux" below. As a first cut, omit `-c` and let `switch-client` retarget *all* clients to the new session — that may be fine if each WS owns its own PTY exclusively.
f. Do NOT touch `state.pty`. The same PTY tmux client process keeps running; tmux just shows it a different session.
g. After the switch resolves, call `sendWindowState(ws, newSession, opts)` to push fresh windows + title to the browser.

### 4. Identifying our PTY client to tmux

`tmux switch-client -t <session>` defaults to the current client of the tmux command being run. For our control client (`-C`), "current client" is the control client itself, not the PTY client we want to retarget. Two options:

- **Easy:** name the PTY client when we spawn it. `tmux ... new-session -A -s <s>` doesn't take a `-c <name>` directly, but every client gets a tmux-internal name derived from its TTY (e.g. `/dev/pts/7`). We can read it back via `list-clients` post-spawn, or set our own via a `tmux set-environment -g TMUX_WEB_CLIENT_<n> $TMUX_PANE` trick. **Best:** capture the PTY client's tty path from `proc.terminal` and pass it as `switch-client -c <tty>` (tmux accepts the tty path as the client identifier).
- **Lazy:** issue `switch-client -t <session>` *from a tmux command that runs inside the PTY itself*: write `\x02 :switch-client -t <session>\r` to the PTY (where `\x02` is the prefix Ctrl-B). Hacky, depends on prefix not being remapped, exposes the user to a flicker of the command line.

The cleanest path is the first: thread the spawned PTY's tty path back to `BunPty`, then pass it via `-c <tty>` to `switch-client`. `Bun.spawn`'s `terminal` mode exposes the master FD; the slave name needs to be looked up via `ttyname` — investigate whether Bun surfaces it (if not, the per-client name from `tmux list-clients -F '#{client_tty}'` filtered by `#{client_pid}` of our spawn works as a runtime probe).

### 5. Wire the client side

`src/client/index.ts:194-203` — replace the `reconnect()` call with sending a `switch-session` message:

```ts
onSwitchSession: (name) => {
  topbar.updateSession(name);
  connection.send(JSON.stringify({ type: 'switch-session', name }));
  // Optionally: clear the terminal scrollback locally (`adapter.clear()`)
  // so the user sees a clean canvas while tmux paints the new session.
},
```

Drop `connection.reconnect()` from this path. The old PTY isn't going away, so the WS doesn't need to either. The browser stays connected to the same WS the entire session.

URL handling stays as-is (`history.replaceState`); `getSession()` still returns the canonical current session because `topbar.updateSession` updated the URL.

### 6. Update existing reconnect callers that *should* stay

`src/client/index.ts:321-328` — the `ptyExit` server message currently calls `connection.reconnect()` to recover from the underlying PTY dying. Keep this; it is unrelated to user-initiated session switches. (It now triggers when the PTY tmux client itself crashes, which is rare.)

### 7. Tests

- `tests/unit/server/ws-router.test.ts` — add a case asserting `{type:'switch-session', name:'X'}` produces a `[{type:'switch-session', name:'X'}]` action, and that an empty / non-string `name` is rejected.
- `tests/unit/server/ws-handle-connection.test.ts` — add a test that opens a WS to session A, sends `{type:'switch-session', name:'B'}`, and asserts:
  - The PTY process is *not* killed (e.g. `state.pty` reference identity stays the same — exposed via a hook or by counting `Bun.spawn` calls on the harness).
  - `tmuxControl.run` was called with `['switch-client', '-c', <client>, '-t', 'B']` (or `['switch-client', '-t', 'B']` in the omit-`-c` first cut).
  - `reg.sessionRefs` was decremented for A and incremented for B.
  - A subsequent `sendWindowState` push targets B.
- `tests/e2e/session-switch.spec.ts` (new) — Playwright test: open a tab on session A, click another session in the dropdown, assert the new session's content paints within (say) 200 ms and the WS connection identity (e.g. via `performance.getEntries()` or a server-side probe) is unchanged.

## Expected outcome

After the fix, switching sessions:

- Completes in tens of milliseconds regardless of how busy the outgoing session is (no SIGWINCH storm on the old session, no detach-attach cycle through tmux's main loop).
- Reuses the same WebSocket — `connection.reconnect()` is no longer called.
- Reuses the same PTY tmux client — `state.pty` is the same process; no `Bun.spawn` of `tmux new-session`.
- The user-visible URL still updates (`history.replaceState`), per-session settings still load, the topbar still re-renders.
- `tmuxControl.attachSession`'s per-session control clients still exist for the new session (so `%window-*` notifications keep working); the old session's control client gets detached if the refcount drops to zero.

Regression watch: keyboard / mouse / clipboard handling must continue to work post-switch (they're tied to the WS connection, which is preserved, so this should be free). Drops panel state is per-user, not per-session, so unaffected. The reconnect-on-`ptyExit` path must still trigger when the *underlying* PTY dies (not on user-initiated switches).

## Things to leave alone

- Don't change `connection.reconnect()`'s semantics — it's still the right thing on `ptyExit` and on auto-reconnect after WS errors.
- Don't add a third "connect" path; reuse the existing WS.
- Don't try to rename "switch-session" to "session-switch" or similar — pick one and stick with it across `shared/types.ts`, `ws-router.ts`, and the client.

## What I was doing when I noticed

User reported a 2 s delay when switching from `tmux-web` to `main`. We first chased the orphan-`-C`-clients leak (filed and partially fixed in `2026-04-23-tmux-c-clients-leak-on-restart.md`) and the user manually killed the orphans. The slowness persisted at ~4 s. I isolated it with timed `Bun.spawn` probes against the live tmux server (light session detach: 30 ms; busy session detach immediately followed by attach to a different session: 4 s / never), then read the `onSwitchSession` flow and confirmed we kill+respawn the PTY tmux client on every switch. The user expected — reasonably — that we already used `switch-client`.
