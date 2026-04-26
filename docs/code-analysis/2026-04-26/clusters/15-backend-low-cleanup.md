---
Status: closed
Autonomy: needs-decision
Resolved-in: 401e0452a4b99bcfaa5f78dc8f4ad82928c9c8e4
Depends-on:
informally-unblocks:
Pre-conditions:
attribution:
Commit-guidance:
model-hint: standard
---

# Cluster 15 — backend-low-cleanup

## TL;DR

- **Goal:** Honest catch-all for seven Backend Low-severity findings sharing the "needs-decision" axis but no other natural topical home — startup probes, lifecycle shutdown, PTY env, sessions-store concurrency, clipboard-policy hash caching, body reader cancel timeout.
- **Impact:** Hardens edge cases. The lifecycle-shutdown sleep-poll is the most visible production smell (matches the "test-flaky-sleeps" theme); the sessions-store race is the most likely to bite under real concurrent UI (theme switch + opacity drag).
- **Size:** Medium (half-day; could split if a session opens with one in mind).
- **Depends on:** none
- **Severity:** Low
- **Autonomy (cluster level):** needs-decision

## Header

> Session size: Medium · Analysts: Backend · Depends on: none · Autonomy: needs-decision

## Files touched

- `src/server/http.ts` (3 findings)
- `src/server/file-drop.ts` (1 finding)
- `src/server/pty.ts` (2 findings)
- `src/server/sessions-store.ts` (1 finding)
- `src/server/clipboard-policy.ts` (1 finding)
- `src/server/index.ts` (1 finding)

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 0 · Low: 8
- autofix-ready: 0 · needs-decision: 8 · needs-spec: 0

## Findings

- **`/api/exit` schedules `process.exit` via `setTimeout(..., 100)` rather than awaiting the response flush** — `http.ts:617-623` returns the response then fires `setTimeout(() => process.exit(...), 100)`. The 100 ms is a guess at "long enough for Bun to flush the response and close the socket"; under load the response can still be in-flight when `process.exit` runs, dropping the body. The intent is "exit after this response is delivered" — Bun.serve's handler can return a `Response` and then signal shutdown via `server.stop()` in a `.then()` chain, or the caller can await `server.stop({ closeActiveConnections: false })` after the response promise resolves.
  - Location: `src/server/http.ts:617-623`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `lifecycle-shutdown`
  - Notes: Used by `--reset` and the desktop wrapper's quit path. T2 doesn't need a perfect graceful shutdown, but a 100ms sleep-poll is exactly the CONC-7 anti-pattern the rules call out. Possible fix: pass `Bun.Server` into the handler factory and call `server.stop()` inside `.then()` of the response object.
  - Raised by: Backend

- **`hasInotifywait` probe runs `inotifywait --help` synchronously at startup with no timeout** — `file-drop.ts:79-89` uses `Bun.spawnSync(['inotifywait', '--help'], …)`. Bun.spawnSync has no built-in timeout; on a system where `inotifywait` is itself wedged (e.g. an aging container with broken /proc), startup blocks forever. Likelihood low, but the only mitigation is "user notices the systemd unit never started and `journalctl`s for it." Worth a 2-second timeout via signal.
  - Location: `src/server/file-drop.ts:79-89`
  - Severity: Low · Confidence: Plausible · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `server-startup-resilience`
  - Notes: Bun.spawnSync's `timeout` option exists in 1.3+ but its semantics on a hung child are documented as best-effort. Alternative: skip the probe entirely on macOS/BSD via `process.platform`, only probe on Linux.
  - Raised by: Backend

- **`readBodyCapped` calls `reader.cancel()` inside an awaited try without a timeout** — `http.ts:224-244` reads request body with a 50 MiB / 1 MiB cap. When the cap is hit it calls `await reader.cancel()` which the WHATWG streams spec says "may signal the underlying source to abort." With Bun's Request body reader the cancel can hang if the upstream connection is alive but slow-feeding bytes. Wrapping the cancel in a 500-ms race would cap the worst case.
  - Location: `src/server/http.ts:233-237`
  - Severity: Low · Confidence: Speculative · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `server-startup-resilience`
  - Notes: Have not reproduced; flagged by reading shape only. The current `try { await reader.cancel() } catch {}` is a swallow but not a timeout.
  - Raised by: Backend

- **`buildPtyEnv` deletes `EDITOR` and `VISUAL` from the spawn environment but does not document why** — `pty.ts:41-52` strips `LANG`, `LANGUAGE`, `EDITOR`, `VISUAL`. The LANG strip is documented elsewhere (the LC_ALL=C.UTF-8 set in `index.ts`). The EDITOR/VISUAL strip has no comment. Unintended side effect: if a user runs `:!vim file` from inside vim/less inside tmux-web, the `$EDITOR` they expect (e.g. nvim) is gone — what wins instead is whatever the pane's shell rc-file sets, which may be empty.
  - Location: `src/server/pty.ts:43-46`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `pty-env`
  - Notes: Either restore `EDITOR/VISUAL` (no obvious reason for deletion) or add a comment explaining the rationale — `git log -p src/server/pty.ts` may surface it. Possibly a stale workaround for an older build that hardcoded an editor invocation.
  - Raised by: Backend

- **`spawnPty` ignores `Bun.spawn` errors silently — a PTY that fails to spawn still returns a `BunPty` shape that null-no-ops on every method** — `pty.ts:75-118` calls `Bun.spawn` without try/catch and returns immediately. If `Bun.spawn` throws synchronously (e.g. `tmuxBin` was deleted between the `-V` probe and now), the error propagates up, but `spawnPty`'s consumer in `ws.ts:252` does not try/catch the call, so the WS handler crashes mid-handle and the WS closes with an uninformative server error.
  - Location: `src/server/pty.ts:75-86`
  - Location: `src/server/ws.ts:252`
  - Severity: Low · Confidence: Plausible · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `pty-env`
  - Notes: Wrap `Bun.spawn` in try/catch; on failure, send `{ptyExit: true}` + close WS with reason. T2 enough for "service ran fine before, then suddenly the binary is gone" recovery.
  - Raised by: Backend

- **`applyPatch` does read-modify-write of `sessions.json` with no concurrency guard** — `sessions-store.ts:121-126` calls `loadConfig`, mutates in memory, then `saveConfig`. Two near-simultaneous `PUT /api/session-settings` requests (e.g. theme switch + opacity drag) interleave: T1 reads config v1, T2 reads config v1, T1 writes v2 with theme, T2 writes v2 with opacity → theme update lost. The `.part` → rename atomic write is filesystem-atomic for the file replacement but not for the read-modify-write.
  - Location: `src/server/sessions-store.ts:121-126`
  - Severity: Low · Confidence: Verified · Effort: Medium · Autonomy: needs-decision
  - Cluster hint: `session-settings-schema`
  - Notes: T2 single-user-app — likelihood of true concurrent writes is low; the client serialises its own PUTs. Bigger concern is `recordGrant` (`clipboard-policy.ts:71-102`) which loads, mutates clipboard map, applies — a concurrent unrelated PUT can overwrite a grant decision. T2 fix: an in-process async mutex for sessions.json writes (like `p-limit(1)`).
  - Raised by: Backend

- **`hasClipboardField` uses string parsing on a structured value when a typed schema would suffice** — `http.ts:62-73` walks a parsed JSON object looking for the literal `'clipboard'` key on any session entry. It iterates `Object.values(sessions)` after the fact rather than validating the shape on parse. Functional but means there is no schema gate keeping unknown fields out, no central place to assert the patch shape, and no protection against a future refactor that adds another protected field.
  - Location: `src/server/http.ts:62-73`
  - Location: `src/server/sessions-store.ts:102-112`
  - Severity: Low · Confidence: Plausible · Effort: Medium · Autonomy: needs-decision
  - Cluster hint: `session-settings-schema`
  - Notes: T2 fix would be a small typed validator (zod/valibot or hand-rolled `validateSessionPatch`) returning `{ok: true, value}` / `{ok: false, reason}`. Keep `hasClipboardField` as belt-and-braces if schema lands.
  - Raised by: Backend

- **`hashFile` (BLAKE3) creates a fresh hasher per call but reads via the synchronous-ish `for await` over `fs.createReadStream`** — `hash.ts:11-18` is correct but called from `clipboard-policy.ts:resolvePolicy` on every OSC 52 read decision. For a 100 MB Claude Code binary that's ~50-100 ms of read+hash on every clipboard request. There's no caching by `(exePath, mtime)` despite the surrounding policy machinery already keying decisions by exePath. Resolution of "binary unchanged → hash unchanged" via a `(exePath → {mtime, blake3})` cache invalidated on mtime mismatch would amortise the cost.
  - Location: `src/server/clipboard-policy.ts:32-40`
  - Location: `src/server/hash.ts:11-18`
  - Severity: Low · Confidence: Verified · Effort: Medium · Autonomy: needs-decision
  - Cluster hint: `clipboard-policy-perf`
  - Notes: T2 single-user is unlikely to hit this in practice (one clipboard read every few seconds at peak), but the design treats the hash as a first-class identity check; it shouldn't cost 100ms on the happy path. Cache trades freshness for speed — re-hashing is the security-sensitive part, so the cache must be `mtime`-keyed and cleared on mtime change.
  - Raised by: Backend

## Suggested session approach

Brainstorming pass — every finding is needs-decision and several have ≥2 reasonable shapes. Group decisions into one ~30-min interview: the lifecycle-shutdown question (server.stop vs. signal), the sessions-store mutex shape, the clipboard-policy cache (mtime keyed vs. content-addressed), the PTY env documentation, and the inotifywait timeout. After decisions land, dispatch a subagent.

The lifecycle-shutdown finding is the most cross-cutting — it shares shape with `tests/unit/server/ws-handle-connection.test.ts`'s many setTimeout sleeps (cluster 18) and with the broader Theme: sleep/poll synchronisation surfaced in `themes.md`. Coordinated fix lets you reuse the same `server.stop()` pattern in both production and tests.
