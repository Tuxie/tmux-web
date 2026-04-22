# tmux Control Mode Replacement: Design Spec

**Date:** 2026-04-22
**Goal:** Replace every `execFileAsync` / `Bun.spawnSync` invocation of tmux in `src/server/` with commands issued over persistent `tmux -C` control-mode connections, and replace OSC-title-triggered `\x00TT:session` / `\x00TT:windows` push notifications with push driven by tmux's own `%`-event stream.

**Scope:** Partial (scope "B"). The per-tab display PTY (`tmux -f <conf> new-session -A -s <name>`) stays exactly as it is. Rendering, OSC interception in the pane byte stream, mouse / keyboard passthrough, OSC 52 read framing, and the `\x00TT:title` pane-title push all remain unchanged because they operate on the display-PTY byte stream, not on `%output` from control mode.

**Out of scope:**
- Control-mode rendering of pane output (`%output` events are parsed and discarded).
- Any client-side change. xterm.js, `src/client/protocol.ts`, OSC handling all untouched.
- Multi-backend / remote-host support. A future "remote tmux-web over ssh/docker" aggregator spec will compose multiple single-backend tmux-web instances; B does not introduce a `TmuxBackend` abstraction.
- Replacing `execFileAsync` for non-tmux callers (`openssl`, `inotifywait`) or for tmux startup probes (`-V`, `source-file`). `src/server/exec.ts` stays.

---

## 1. User-visible wins

- Session rename via `,` inside tmux, or external `tmux rename-session` from another shell, updates the tmux-web dropdown live rather than on next OSC title emission.
- Window add / close / rename updates propagate the same way.
- Per-op latency (`kill-session`, `rename-session`, `select-window`, `new-window`, `set-environment`, `send-keys -H`) drops from fork+exec to a stdio write. Saves ~5–15 ms per op, avoids the 5 s `execFileAsync` timeout window.
- No change to anything the user sees when nothing is being renamed — the display path is unchanged.

## 2. Architecture

One new module: **`src/server/tmux-control.ts`**. Owns the pool of per-session control clients, primary election, command queue, and notification dispatch. Consumed by `http.ts`, `ws.ts`, `foreground-process.ts`, `tmux-inject.ts`, `osc52-reply.ts`.

### 2.1 Interface

```ts
export interface TmuxControl {
  /** Ensure a control client is attached to <session>. Idempotent. */
  attachSession(session: string): Promise<void>;
  /** Tear down the control client for <session>. Idempotent. */
  detachSession(session: string): void;
  /** Run a tmux command through the primary control client. Resolves with
   *  concatenated stdout (no trailing newline), or rejects on %error /
   *  protocol desync / timeout / empty pool. */
  run(args: readonly string[]): Promise<string>;
  /** Subscribe to parsed notifications. Returns an unsubscribe fn. */
  on(event: TmuxNotification['type'], cb: (n: TmuxNotification) => void): () => void;
  /** Shut down all control clients. */
  close(): Promise<void>;
}

export type TmuxNotification =
  | { type: 'sessionsChanged' }
  | { type: 'sessionRenamed'; id: string; name: string }
  | { type: 'sessionClosed'; id: string }
  | { type: 'windowAdd'; window: string }       // e.g., "@23"
  | { type: 'windowClose'; window: string }
  | { type: 'windowRenamed'; window: string; name: string };

export class TmuxCommandError extends Error {
  constructor(
    public args: readonly string[],
    public stderr: string,
    public exitCode?: number,
  ) { super(stderr); }
}

export class NoControlClientError extends Error {}
```

### 2.2 Internal structure

- **`ControlClient`** — one per attached session. Wraps `Bun.spawn(['tmux', '-f', <conf>, '-C', 'attach-session', '-t', name])`. Maintains a single in-flight command slot and a FIFO backlog (serial, see §4.2). Parses stdout into `%begin / %end / %error` response frames and standalone `%<event>` notification frames. Emits notifications to the parent pool. Exits when its session exits (tmux emits `%exit` first, then stdout closes).
- **`ControlPool`** — holds `Map<sessionName, ControlClient>` keyed by session name, plus an `insertionOrder: ControlClient[]` array for primary tracking. Primary = `insertionOrder[0]`. On a client's death, `insertionOrder.shift()` promotes the next oldest.
- **Parser** — line-buffered. Frames:
  - Command response envelope: `%begin <time> <cmdnum> <flags>` → zero or more output lines → `%end <time> <cmdnum> <flags>` on success or `%error <time> <cmdnum> <flags>` on failure.
  - Standalone notifications: any `%<event> …` line emitted *outside* a `%begin / %end` envelope (e.g., `%sessions-changed`, `%session-renamed $2 foo`).
  - `%output %<pane-id> <bytes>` notifications: recognised and discarded (B does not use control-mode output).

### 2.3 Wiring

- `src/server/index.ts` constructs one `TmuxControl` instance at startup (after the `-V` probe + `source-file` reload), passes it into the request / WS handlers via the existing `config` / context plumbing.
- `src/server/http.ts`:
  - `GET /api/sessions` → `tmuxControl.run(['list-sessions', '-F', '…'])`, fallback to `execFileAsync` only if `run` rejects with `NoControlClientError` (cold path; see §4.3).
  - `GET /api/windows?session=…` → `tmuxControl.run(['list-windows', …])`.
- `src/server/ws.ts`:
  - On WS open: existing display-PTY spawn, then `await tmuxControl.attachSession(session)`.
  - On last-WS-close for a session: `tmuxControl.detachSession(session)` (best-effort cleanup; if the session persists with no tabs, its control client goes away).
  - Session actions (`rename-session`, `kill-session`), window actions (`select-window`, `new-window`, `kill-window`, `rename-window`), `set-environment` for `COLORFGBG` / `CLITHEME` → all go through `tmuxControl.run`.
  - Subscribes to `sessionsChanged`, `sessionRenamed`, `sessionClosed`, `windowAdd`, `windowClose`, `windowRenamed` — push handlers generate `\x00TT:session` / `\x00TT:windows` broadcasts (see §5).
- `src/server/tmux-inject.ts` `sendBytesToPane` → `tmuxControl.run(['send-keys', '-H', '-t', target, ...hex])`. The `execFileAsync` injection hook is replaced by a `RunCmd` hook for tests; production callers pass `tmuxControl.run.bind(tmuxControl)`.
- `src/server/foreground-process.ts` `getForegroundProcess` → same `RunCmd` injection for the `display-message -p -t <session> -F '#{pane_pid}\t#{pane_current_command}'` call.
- `src/server/osc52-reply.ts` inherits the `tmux-inject` change transitively.
- `src/server/protocol.ts` — remove the OSC-title-triggered refresh branch that currently fires `\x00TT:session` / `\x00TT:windows` pushes. Keep the `\x00TT:title` pane-title-push branch (tmux has no notification for pane foreground-process titles; that still needs OSC sniffing).

## 3. Lifecycle

### 3.1 Spawn policy

Lazy per-session. A control client for session X is created when the first WS tab for X opens (triggered from `ws.ts` immediately after the display PTY spawn). Sessions that exist in tmux but have never had a tmux-web tab opened onto them get no control client. `%sessions-changed` events alone do not trigger spawns.

Consequence: if the user has sessions A and B in tmux but only opens a tmux-web tab onto A, there is exactly one control client, attached to A, and it is primary. B appears in `/api/sessions` (via `list-sessions`) but has no control client until a tab opens on it.

### 3.2 Spawn sequence

`attachSession(name)`:

1. If a live client already exists for `name`, return its ready-promise.
2. `Bun.spawn(['tmux', '-f', <conf>, '-C', 'attach-session', '-t', name], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', env: <tmux-web env> })`.
3. Issue `refresh-client -C 10000x10000` through the client's own command queue and await its response frame. Size-negotiation guard (§3.5). On `%error` (e.g., an older tmux that doesn't support `-C <WxH>`), log at debug level and continue — `window-size latest` in the bundled `tmux.conf` is the sufficient fallback.
4. Issue a sync probe `display-message -p 'ok'` and await its response frame. On `%end`, join `insertionOrder` and resolve the `attachSession` promise. On `%error` or stdout close, reject the promise and do not join `insertionOrder`.
5. Because `insertionOrder.push` happens only after a successful probe, a just-attached client is primary iff it is the only live client (i.e., `insertionOrder[0]` is itself). The pool's notification dispatcher always reads from `insertionOrder[0]`; no extra promotion step is needed here.

### 3.3 Death

`ControlClient.onExit` fires when:
- The attached session is killed (tmux emits `%exit` then closes stdout).
- The tmux server exits.
- The process is otherwise killed.
- `detachSession` calls `proc.kill()`.

Handling:
1. Any in-flight command rejects with `TmuxCommandError('control client exited')`.
2. All backlog commands reject the same way.
3. Pool removes the client from the `Map` and splices it out of `insertionOrder`.
4. If it was `insertionOrder[0]`, the next element becomes primary. Non-primary death has no visible effect.
5. If `insertionOrder` is now empty, primary is null. Subsequent `run()` calls reject with `NoControlClientError`.

**No automatic respawn.** If a session is still alive but its control client process crashed, the next WS connection for that session will call `attachSession` again. A session with an already-open tab whose control client crashed mid-flight silently loses notification subscription for that session until re-attached. If this proves a problem in practice, add exponential-backoff respawn later behind the same interface.

### 3.4 Primary election

- Primary = `insertionOrder[0]`. Deterministic, single-line bookkeeping.
- Promotion happens only on death of the current primary.
- Non-primary clients' notification streams are parsed and dropped (they would duplicate the primary's global events).
- Command dispatch: **every command goes to the primary**, regardless of which session it targets. Session scoping is done via `-t <target>` in the command args. Per-session control clients exist for subscription survival (so we always have *some* live client to be primary) and for natural lifetime coupling with user sessions, **not** for command routing.

### 3.5 Size negotiation

A `tmux -C` client participates in session size negotiation. With stdin piped (not a tty) tmux treats the client size as 80×24. tmux's default `window-size smallest` policy would shrink the session to 80×24 — this would break every display client attached to the same session.

Two mitigations, both required, both applied in this spec:

- **`set -g window-size latest`** added to the bundled `tmux.conf`. tmux then follows whichever client most recently resized. The control client never resizes, so display clients always win size negotiation.
- **`refresh-client -C 10000x10000`** issued immediately after attach (§3.2 step 3). The control client announces a huge view size; under any `window-size` policy, no display client will be bigger, so the session size follows display clients.

Regression guard: `tests/e2e/control-mode-window-size.spec.ts`.

## 4. Command dispatch

### 4.1 Routing

Every `run()` call dispatches through the primary. Session-scoping is per-argument (`-t <target>`). Simplicity win: the pool doesn't maintain a name → client routing table for commands.

### 4.2 Serialisation

Single in-flight command per primary. New `run()` calls append to a FIFO backlog of `{args, resolve, reject}`. The primary writes one command line, awaits its response frame, resolves or rejects the associated promise, advances the backlog.

Pipelining was considered and rejected: tmux assigns a monotonic `cmdnum` in `%begin` for correlation, so pipelining is technically possible, but current call-site patterns are almost entirely sequential (`Promise.all` of two `set-environment` writes is the only parallel case), and parser complexity for near-zero win isn't justified. Since the queue is serial, the correlation rule collapses to "the queue head IS the expected cmdnum." A cmdnum mismatch in an incoming `%begin` indicates a parser / protocol desync; the primary is torn down and the current command rejects with `TmuxCommandError('protocol desync')` (triggers re-election).

### 4.3 Cold-path fallback

When `run()` is called and the pool has no primary (no sessions attached yet), it rejects with `NoControlClientError`. The *only* caller that expects this is `GET /api/sessions` in `http.ts`, which serves the initial session-dropdown population *before* any WS tab is opened. That handler catches `NoControlClientError` and falls back to `execFileAsync(tmuxBin, ['list-sessions', '-F', '…'])`.

All other callers (`/api/windows?session=…`, session/window actions in `ws.ts`, `set-environment`, `send-keys -H`, `display-message` in `foreground-process.ts`) are invoked only in contexts where a tab is attached and therefore a primary exists. Those callers treat `NoControlClientError` as a bug (log + surface a 500).

Non-tmux `execFile*` callers stay on their current paths:
- `src/server/tls.ts` — `openssl` for self-signed cert generation.
- `src/server/file-drop.ts` — `inotifywait --help` probe.
- `src/server/index.ts` — startup `tmux -V` probe, `tmux source-file` conf reload probe. Both run before any session exists; keeping them on `execFileAsync` avoids a parallel cold-path for control mode.

### 4.4 Error mapping

`run()` rejects with `TmuxCommandError { args, stderr, exitCode? }`:

| Condition | `stderr` | `exitCode` |
|-----------|----------|-----------|
| `%error` frame | frame payload (one line) | undefined |
| client exits mid-command | `'control client exited'` | undefined |
| parser desync | `'protocol desync'` | undefined |
| timeout (5 s, soft) | `'timeout'` | undefined |

Existing call sites that `try { … } catch { return 500 }` or similar need no behavioural change — they just accept the new error shape. Tests that assert on error details are updated accordingly.

Soft timeout does **not** tear down the primary (tmux can be slow, not dead). The command slot is force-advanced after logging; if tmux eventually responds late, the stale response is dropped on `cmdnum` mismatch.

### 4.5 Command-line length

tmux commands over control mode are line-delimited on stdin; tmux's internal command-line buffer is large (≫1 MiB). The longest command tmux-web issues is `send-keys -H -t <target> <hex>×N` for clipboard / file-drop bytes. A 1 KiB clipboard paste = ~2 KiB hex + fixed overhead — well under any limit. No batching needed.

## 5. Notification-driven push

The existing push path in `src/server/protocol.ts` triggers `\x00TT:session` and `\x00TT:windows` pushes when it sees an OSC title escape in the display PTY byte stream. This mechanism is replaced for `session` and `windows` — the `title` branch stays.

### 5.1 New push triggers

| Notification | Action |
|--------------|--------|
| `%sessions-changed` | Run `list-sessions -F '#{session_id}:#{session_name}'`; broadcast `\x00TT:session` to all WS clients. |
| `%session-renamed $id name` | Same as above. (v1: just re-list; optimisation to patch a single name deferred.) |
| `%session-closed $id` | Same as above. Server does not auto-close any client whose URL points at the dead session — the client's display PTY will exit and the browser sees the WS close naturally. |
| `%window-add @N` | Resolve the owning session via `display-message -p -t @N '#{session_name}'` (cached briefly per `@N`); broadcast `\x00TT:windows` with a fresh `list-windows` only to WS clients on that session. |
| `%window-close @N` | Same. |
| `%window-renamed @N name` | Same. (v1: just re-list; single-name patch deferred.) |

### 5.2 Broadcast fan-out

`ws.ts` maintains a WS client registry already indexed by session name (used today for the polling-based pushes). Notification handlers reuse that registry. No new fan-out infrastructure.

### 5.3 Removed behaviour

`src/server/protocol.ts` currently parses OSC 0 / OSC 2 title sequences from the pane byte stream and triggers `list-sessions` + `list-windows` refreshes. After this spec, the branch that triggers session / windows push is removed. The branch that parses the title and produces `\x00TT:title` stays — tmux has no per-pane-foreground-process-title notification, so OSC sniffing is still the only way to drive that.

## 6. Testing

### 6.1 Unit tests (`tests/unit/server/`)

- `tmux-control-parser.test.ts` — byte-level parser. Feed scripted stdout streams, assert:
  - `%begin / %end` response envelope emits joined stdout.
  - `%error` envelope rejects with the frame payload.
  - Notification lines (`%sessions-changed`, `%session-renamed`, `%session-closed`, `%window-add`, `%window-close`, `%window-renamed`, `%exit`) emit correctly-typed events.
  - `%output` lines are discarded.
  - Split-across-chunks lines re-assemble correctly.
  - Octal-escaped payload bytes in `%output` are not mis-parsed as envelope lines.
  - `cmdnum` increments monotonically; mismatch rejects with `'protocol desync'`.
- `tmux-control-pool.test.ts` — mock `ControlClient`. Verify:
  - `attachSession` is idempotent (same name returns same ready-promise).
  - `insertionOrder` records spawn order.
  - Primary is `insertionOrder[0]`.
  - On primary death, next-oldest is promoted.
  - On non-primary death, nothing observable changes.
  - Empty pool → `run()` rejects with `NoControlClientError`.
  - `detachSession` kills the correct client and removes it from both structures.
- `tmux-control-cmd.test.ts` — single `ControlClient` with injected stdio. Verify:
  - Serial FIFO: backlog advances only after response.
  - `%end` resolves with joined stdout.
  - `%error` rejects with `TmuxCommandError`.
  - Client exit mid-command rejects in-flight + backlog.
  - Parser desync rejects with `'protocol desync'` and tears down the client.
  - 5 s timeout rejects with `'timeout'` but does NOT tear down the client.

### 6.2 Updated unit tests

- `tests/unit/server/tmux-inject.test.ts` — accepts a `RunCmd` injection instead of `ExecFileAsync`. Verifies `send-keys -H` arg construction unchanged.
- `tests/unit/server/foreground-process.test.ts` — same injection swap for the `display-message` call; `/proc/<pid>/stat` parsing and `/proc/<pid>/exe` readlink paths unchanged.
- `tests/unit/server/osc52-reply.test.ts` — inherits `tmux-inject` injection swap.
- `tests/unit/server/protocol.test.ts` — remove assertions about OSC-title-triggered session/windows push. Keep title-push assertions.

### 6.3 E2E tests (`tests/e2e/`)

Existing e2e suite runs under `--test` mode (PTY = `cat`, no real tmux). Two new e2e files run against a real tmux binary:

- `control-mode-notifications.spec.ts` — start tmux-web against real tmux, open two WS tabs onto two sessions, `tmux rename-session -t foo bar` from a separate shell, assert the active WS tabs receive updated `\x00TT:session` broadcasts within 500 ms. Covers the notification → push path end-to-end.
- `control-mode-window-size.spec.ts` — open a 200×50 tab, wait for control-client attach, assert xterm dimensions are still 200×50 after 500 ms. Regression guard for §3.5.

### 6.4 What is unchanged

- All of `src/client/` and its tests.
- All tests for `src/server/pty.ts`, `src/server/ws-router.ts`, `src/server/themes.ts`, `src/server/colours.ts`, `src/server/sessions-store.ts`, `src/server/tls.ts`, `src/server/file-drop.ts`, `src/server/allowlist.ts`, `src/server/origin.ts`, `src/server/shell-quote.ts`, `src/server/hash.ts`, `src/server/clipboard-policy.ts`, `src/server/drop-paste.ts`.

## 7. Migration plan

Staged so each commit is independently shippable and reverts cleanly. `make test` must be green before the next commit.

1. **Scaffold `tmux-control.ts`.** Parser + `ControlClient` + `ControlPool` + `TmuxControl` interface. Unit tests only. Nothing wired to production code.
2. **Wire lifecycle.** `src/server/index.ts` constructs the `TmuxControl` instance. `src/server/ws.ts` calls `attachSession` on WS open and `detachSession` on last-WS-close. Not yet used for commands. Visible effect: one extra tmux client per open-tab session, observable via `tmux list-clients`.
3. **Size-negotiation guard.** Add `set -g window-size latest` to bundled `tmux.conf`. Issue `refresh-client -C 10000x10000` on attach. Landed alone so a regression bisects here.
4. **Notification → broadcast path.** Register handlers in `ws.ts` that produce `\x00TT:session` / `\x00TT:windows` pushes from `%` events. OSC-title-triggered pushes still fire in parallel — harmless, payload-identical duplicates.
5. **Remove OSC-title-triggered session/windows push.** Trim the branch in `src/server/protocol.ts`. Keep the `title` branch. User-visible: live rename starts working; OSC-title activity no longer spuriously refreshes session lists.
6. **Convert `execFileAsync` call sites.** One file per commit:
   - `src/server/foreground-process.ts`.
   - `src/server/tmux-inject.ts`.
   - `src/server/osc52-reply.ts` (inherits tmux-inject change).
   - `src/server/http.ts` (list-sessions with `NoControlClientError` cold-path fallback, list-windows without fallback).
   - `src/server/ws.ts` (rename/kill session/window, new-window, select-window, set-environment).
7. **Cleanup.** Remove dead imports. `exec.ts` stays (serves `tls.ts`, `file-drop.ts`, startup probes in `index.ts`).

## 8. File list

### New

- `src/server/tmux-control.ts` (~400–500 LOC target).
- `tests/unit/server/tmux-control-parser.test.ts`.
- `tests/unit/server/tmux-control-pool.test.ts`.
- `tests/unit/server/tmux-control-cmd.test.ts`.
- `tests/e2e/control-mode-notifications.spec.ts`.
- `tests/e2e/control-mode-window-size.spec.ts`.

### Modified (production)

- `src/server/index.ts` — construct `TmuxControl`, pass into handlers, close on shutdown.
- `src/server/http.ts` — `list-sessions` / `list-windows` via control mode, cold-path fallback for `list-sessions`.
- `src/server/ws.ts` — `attachSession` / `detachSession` lifecycle on WS open/close, command dispatch via `tmuxControl.run`, subscribe to notifications for push broadcast.
- `src/server/foreground-process.ts` — `RunCmd` injection replaces `ExecFileAsync` injection.
- `src/server/tmux-inject.ts` — same injection swap.
- `src/server/osc52-reply.ts` — inherits from `tmux-inject`.
- `src/server/protocol.ts` — drop OSC-title-triggered session/windows push branch; keep title branch.
- `tmux.conf` (bundled) — add `set -g window-size latest`.

### Modified (tests)

- `tests/unit/server/tmux-inject.test.ts`.
- `tests/unit/server/foreground-process.test.ts`.
- `tests/unit/server/osc52-reply.test.ts`.
- `tests/unit/server/protocol.test.ts`.

### Unchanged

- All of `src/client/`.
- `src/server/pty.ts` — per-tab display PTY stays as is.
- `src/server/ws-router.ts` — pure translation.
- `src/server/exec.ts` — retained for `tls.ts`, `file-drop.ts`, `index.ts` startup probes.
- `src/server/tls.ts`, `src/server/file-drop.ts`, `src/server/sessions-store.ts`, `src/server/themes.ts`, `src/server/colours.ts`, `src/server/allowlist.ts`, `src/server/origin.ts`, `src/server/shell-quote.ts`, `src/server/hash.ts`, `src/server/clipboard-policy.ts`, `src/server/drop-paste.ts`.
