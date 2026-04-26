---
Status: closed
Autonomy: needs-decision
Resolved-in: a6ed60debe2d81babd6006ffda07d18731b5e3d9
Depends-on:
informally-unblocks:
Pre-conditions:
attribution:
Commit-guidance: each finding has ≥2 reasonable fix paths; expect a maintainer interview pass to pick directions before subagent dispatch
model-hint: senior
---

# Cluster 03 — endpoint-hardening

## TL;DR

- **Goal:** Tighten authenticated HTTP/WS endpoints whose post-auth amplifiers chain into denial-of-service or session hijack on a single stolen credential.
- **Impact:** Reduces blast radius of a stolen Basic Auth password / XSS / desktop-wrapper compromise. Each finding's vulnerability is gated by the existing auth boundary, but each removes a multiplier the attacker would otherwise compose.
- **Size:** Medium (half-day).
- **Depends on:** none
- **Severity:** Medium (highest in cluster)
- **Autonomy (cluster level):** needs-decision (every finding has at least two reasonable fix shapes)

## Header

> Session size: Medium · Analysts: Security · Depends on: none · Autonomy: needs-decision

## Files touched

- `src/server/http.ts` (3 findings)
- `src/server/ws-router.ts` (1 finding)
- `src/server/tmux-inject.ts` (1 finding)
- `src/server/file-drop.ts` (1 finding)
- `src/server/ws.ts` (1 finding)

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 2 · Low: 3
- autofix-ready: 1 · needs-decision: 4 · needs-spec: 0

## Findings

- **`/api/exit?action=…` lacks Origin/IP enforcement: a single authenticated POST kills or restarts the server** — The `/api/exit` branch in the request handler runs after `isAllowed`/`isOriginAllowed`/`isAuthorized`, so it is gated by Basic Auth, but it has *no per-route confirmation*, no CSRF token, and no method-protection beyond `POST`. Any attacker who has obtained the password (replay over an HTTP-only deployment, leaked systemd env, log exfiltration, or a credential-bearing URL) can exit or restart the daemon at will. The handler also uses `setTimeout(() => process.exit(code), 100)` and returns success before the exit fires, so even a single CSRF-style auto-submit POST from a same-origin XSS or a misconfigured `--allow-origin *` deployment is enough to kill the server. There is no rate limit and no log other than the regular `[debug] API POST` line.
  - Location: `src/server/http.ts:617-623`
  - Severity: Medium · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `endpoint-hardening`
  - Notes: Local-first calibration row "Missing authn on endpoint reachable via LAN binding" applies — the surface is auth-gated (so not "missing authn" outright), but the endpoint is destructive and bypasses the kind of confirmation users expect for "shut down the server". Reasonable fixes diverge: require a fresh challenge (re-prompt password), restrict to loopback IPs only, add a `--allow-exit-api` opt-in, or remove the route entirely and require `systemctl --user restart`.
  - Raised by: Security

- **OSC 52 read content is not size-checked between `clipboard-read-reply` and tmux injection: a 1 MiB base64 payload is hex-encoded byte-by-byte and shipped as a single `send-keys -H` argv** — The router caps `clipboard-read-reply.base64` at `MAX_BASE64 = 1 MiB` (`ws-router.ts:39`) but the OSC 52 reply byte string is then hex-encoded (one byte → 2 hex chars) and passed as positional args to `send-keys -H -t <target> <hex…>`. A 1 MiB base64 reply produces ~2 MiB of hex argv, which `tmux send-keys` accepts, but each hex byte becomes a separate argv element — argv length blows up, the tmux command queue fills, and any other concurrent `run()` against that control client is starved (`commandTimeoutMs: 5_000` × 3 → eviction). The hex split also encodes one position per byte, generating millions of array elements in `sendBytesToPane`'s loop, which is sub-quadratic but still ~50 ms per request on the warm path. A malicious client (compromised browser or XSS in an extension that talks to the WS) can amplify a single OSC 52 read into a control-client DOS.
  - Location: `src/server/ws-router.ts:39, 117`
  - Location: `src/server/tmux-inject.ts:16-22`
  - Severity: Medium · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `osc52-bounds`
  - Fix: Tighten the cap. The OSC 52 read path is interactive clipboard delivery; a sane cap is e.g. `64 * 1024` bytes of decoded base64 (i.e. ~88 KiB base64 string). Drop oversized replies with a single warn line, mirror the existing `MAX_OSC52_WRITE_BYTES` cap for symmetry, and document the chosen value in `ws-router.ts`. Caller already silently truncates to `''` when over the limit (`clipped`); just lower the constant.
  - Notes: The write side already caps at `MAX_OSC52_WRITE_BYTES = 1 MiB` and rate-limits via `MAX_OSC52_WRITES_PER_CHUNK` (`protocol.ts:29-35`); the read side is the asymmetric outlier.
  - Raised by: Security

- **`/api/drops/paste` and `/api/drop` accept a `session` query param that bypasses the WS session policy and lets any authenticated request paste into any tmux session the server can see** — Both handlers call `sanitizeSession(url.searchParams.get('session') || 'main')` then `sendBytesToPane({ target: session, … })`. There is no validation that the requesting auth context actually has a live WS for that session. An authenticated client (or post-auth attacker) can pick *any* tmux session name (including ones not associated with their browser) and inject the bracketed-paste path bytes. On a single-user box this is "the user pasting into their own session", which is fine; on a multi-binary-grant clipboard model it lets a stale browser tab or stolen credential paste into sessions it never had a tab for.
  - Location: `src/server/http.ts:437-464, 502-550`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `endpoint-hardening`
  - Notes: Local-first calibration applies; the threat model is "authenticated requests are user-equivalent" so this is mostly a defence-in-depth gap. Two reasonable fixes: scope `/api/drop*` to a session validated against an open WS map, or accept the looseness explicitly (it matches the documented "drops are a per-user pool, not session-scoped") and document the cross-session paste behaviour.
  - Raised by: Security

- **`MAX_DROP_BYTES = 50 MiB` per upload is documented; there is no per-user quota across drops** — `defaultDropStorage()` sets `maxFilesPerSession: 20` and a `ttlMs: 10 min`. Twenty 50-MiB drops × concurrent sessions = 1 GiB on disk; the `sweepRoot` runs only on the next `writeDrop`, never proactively. An authenticated attacker can spike disk consumption by the cap × ring-buffer size and rely on the `inotifywait`-driven unlink only after the file is read. On a small VPS this is enough to fill `/run/user/<uid>` (tmpfs, typically 10 % of RAM).
  - Location: `src/server/http.ts:50` and `src/server/file-drop.ts:62-68`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `endpoint-hardening`
  - Notes: Single-user tool, so the actor is "the user themselves with a compromised tab". A periodic sweep (`setInterval(sweepRoot, ttlMs/2)` rather than write-only sweep) plus a global byte cap closes it cheaply.
  - Raised by: Security

- **WS upgrade does not honour the `tw_auth` query token; HTTP routes do** — In `src/server/http.ts:323-325`, the `tw_auth` query parameter (set by Electrobun-only `clientAuthToken` flow) bypasses Basic Auth on the HTTP handler. The matching WS upgrade in `src/server/ws.ts:164-171` only checks `Authorization: …` headers; there is no `tw_auth` query parsing. In production this isn't reachable because tmux-term sends Basic Auth via `wsBasicAuth` URL userinfo, but if the client ever migrates to query-token-only (e.g. Safari WKWebView, where URL userinfo is stripped pre-handshake), the WS will reject the upgrade. A quiet inconsistency rather than a security hole today.
  - Location: `src/server/ws.ts:164-171`
  - Location: `src/server/http.ts:323-325`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `auth-symmetry`
  - Fix: In `upgrade()`, pull `tw_auth` from `new URL(req.url).searchParams` and combine the same way HTTP does (`isClientAuthorized || isAuthorized(authHeader, config)`). Mechanical mirror of the HTTP branch.
  - Raised by: Security

## Suggested session approach

Brainstorming session, not subagent. The cluster has one cleanly-mechanical finding (OSC52 read cap — single constant edit) and four findings whose fix shape requires a maintainer call (deprecate `/api/exit` outright vs. add re-prompt? scope drops to WS-session-bound sessions vs. document the looseness? etc.). Run a 30-min interview pass that resolves each `needs-decision` to a concrete shape, then dispatch a subagent to apply the agreed fixes.

The OSC52 cap can ship independently as a small commit before the broader interview — it's a one-line constant change and the existing `clipped` truncation logic carries the silent-drop semantics.
