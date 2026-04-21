---
Status: open
Resolved-in:
---

# Cluster 04 — pty-and-tmux-exec-safety

## TL;DR

- **Goal:** Bound the subprocess surface: give `sendBytesToPane` the same 5 s timeout the rest of the codebase uses, `--`-terminate all user-controlled positional args to tmux, and cap the count of OSC 52 write frames the server forwards per PTY data chunk.
- **Impact:** Prevents a hung tmux process from pinning an HTTP handler open; prevents a future tmux version's new short-option from turning a session-rename into an unintended flag; prevents a TUI from flooding the WS client with an unbounded burst of clipboard frames.
- **Size:** Small (<2h)
- **Depends on:** none
- **Severity:** Medium

## Header

> Session size: Small · Analysts: Backend, Security · Depends on: none

## Files touched

- `src/server/tmux-inject.ts` (1 finding)
- `src/server/ws.ts` (1 finding — rename/new-window argv sites)
- `src/server/protocol.ts` (1 finding — OSC 52 write count cap)

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 1 · Low: 2
- autofix-ready: 3 · needs-decision: 0 · needs-spec: 0

## Findings

- **`sendBytesToPane` uses unbounded `promisify(execFile)` with no timeout** — `src/server/tmux-inject.ts:4` wraps `execFile` via `promisify` without passing a `timeout` option. A hung or stalled `tmux send-keys` call (for example if tmux is blocked on a locked pseudo-terminal) will hold the HTTP drop-upload handler and the WS OSC 52 reply path open indefinitely. The sibling `src/server/exec.ts` helper used everywhere else explicitly sets `EXEC_FILE_TIMEOUT_MS = 5000` — this file is the drifted copy.
  - Location: `src/server/tmux-inject.ts:4`
  - Severity: Medium · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `pty-lifecycle`
  - Fix: Either call `execFile(file, args, { timeout: 5000, encoding: 'utf8' }, cb)` via a bound wrapper, or — cleaner — drop the private `defaultExecFile` here and import `execFileAsync` from `./exec.js` as the default.
  - Raised by: Backend Analyst

- **WS/HTTP rename and new-window positional args are not `--`-terminated** — `msg.name` from the WS channel is passed directly as a positional argument to `tmux rename-session`, `tmux rename-window`, and `tmux new-window -n`. Execution is via `execFile` (arg-array, no shell), so classic shell-injection is not reachable. There is no `--` separator before the user-controlled positional, however, so an authenticated client can supply a leading `-` and attempt to have tmux's own argument parser treat it as an option. Behaviour depends on the installed tmux; future tmux flags could widen the attack surface. tmux already rejects names containing `.` or `:` internally, but the check happens inside tmux, not in the server. `msg.action` strings (`rename`, `kill`, `select`, `new`, `close`) are already whitelisted by the switch; only `msg.name` is exposed.
  - Location: `src/server/ws.ts:138`, `src/server/ws.ts:170`, `src/server/ws.ts:181`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `pty-exec-argv`
  - Fix: Insert a literal `'--'` before each user-controlled positional — `['rename-session', '-t', sessionName, '--', msg.name]`, same pattern for `rename-window` and `new-window -n`. Optionally add a server-side sanity check that rejects names starting with `-` or containing `:` / `.` so the error surfaces before reaching tmux.
  - Raised by: Security Analyst
  - Notes: Post-auth footgun; privilege boundary (tmux user session) is not broken, but this is the kind of thing that silently degrades if tmux adds new options.

- **OSC 52 write has no per-frame count cap (only per-payload size)** — `processData` in `src/server/protocol.ts:63-72` loops over all OSC 52 WRITE matches and emits a TT message per match. Per-payload size is capped at 1 MiB, but there is no cap on the number of write sequences per PTY data chunk. A (local) tmux user can therefore force the WS client to buffer an unbounded number of `{clipboard:…}` frames in one burst. Since tmux is local-only, the worst-case impact is "DoS your own browser tab".
  - Location: `src/server/protocol.ts:63-72`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `osc52-boundary`
  - Fix: Cap to the last N (e.g. 8) OSC 52 writes per `processData` call; older ones are already superseded on the client side anyway (clipboard overwrites).
  - Raised by: Security Analyst

## Suggested session approach

Mechanical dispatch. Order: timeout first (single import change or single options addition), `--` separators second (three call sites in one file), OSC 52 count cap third (one loop rewrite). Verify with `bun test`. None of these changes should require new tests beyond what already exists for `tmux-inject` / `ws` message routing, but add a test for the `--` separator behavior if one doesn't already cover it.

## Commit-message guidance

1. Name the cluster slug and date — e.g., `fix(cluster 04-pty-and-tmux-exec-safety, 2026-04-21): timeout tmux send-keys, --terminate rename args, cap OSC 52 write bursts`.
2. No `Depends-on:` chain.
