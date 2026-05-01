---
Status: open
Autonomy: needs-decision
Resolved-in:
Depends-on:
informally-unblocks:
Pre-conditions:
attribution:
Commit-guidance:
model-hint: standard
---

# Cluster 05 — html-injection-and-csrf-chain

## TL;DR

- **Goal:** Close the JSON-into-`<script>` injection that turns "auth'd page" into "kill-the-server-via-XSS" in combination with `/api/exit` + WS resource saturation.
- **Impact:** Removes the only auth-pre-DOM injection sink in the app and breaks the chain to `/api/exit` (and WS PTY exhaustion under `--no-auth` opt-in). On a hostile-theme-pack supply chain (a user installs a malicious theme), this cluster's fix prevents that theme from killing the server or paste-flooding panes.
- **Size:** Small (<2h).
- **Depends on:** none.
- **Severity:** Medium (HTML injection); Low (exit-api CSRF chain, WS resource limits — local-first calibration).
- **Autonomy (cluster level):** needs-decision — three reasonable shapes for the exit-api token mechanism; HTML injection itself is autofix.

## Header

> Session size: Small · Analysts: Security · Depends on: none · Autonomy: needs-decision

## Files touched

- `src/server/http.ts` (2 sites)
- `src/server/ws.ts` (1 site)

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 1 · Low: 2
- autofix-ready: 1 · needs-decision: 2 · needs-spec: 0

## Findings

- **JSON `<script>` injection: `</script>` in `clientConfig` would close the inline script tag** — `makeHtml()` injects `JSON.stringify(clientConfig)` directly into a `<script>` block via simple string substitution. `JSON.stringify` does not escape `</` or `<!--`. A theme pack JSON whose `defaultColours` / `name` / equivalent string contains `</script>` would close the inline script tag and let arbitrary HTML follow. Same risk for `wsBasicAuth` if a username contains `</`. This is the **only** auth-pre-DOM injection sink in the app.
  - Location: `src/server/http.ts:414`
  - Severity: Medium · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `html-injection`
  - Fix: Replace the interpolation with `JSON.stringify(clientConfig).replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--')` (or escape `<` → `<` unconditionally) before substitution.
  - Raised by: Security Analyst
  - Notes: Theme manifests are author-controlled today (read from `themes/` and `~/.config/tmux-web/themes/`), so the practical attack requires a hostile theme pack the user installed. Local-first calibration would put this Low for a network-boundary issue, but the bug is "data-from-disk renders as HTML in an authenticated UI" — same pattern that bites other `__CONFIG__`-style templates. Cheap to fix.

- **`/api/exit` killable by anyone with auth + Origin allow — XSS-to-kill chain via the JSON-injection bug above** — `POST /api/exit?action={quit,restart}` calls `process.exit` after Basic Auth + IP/Origin allowlist. The maintainer's existing comment at `http.ts:740` documents the auth gate as sufficient — but a stored XSS (the JSON-injection finding above, or a hostile theme name) escalates from "browser tab" to "server kill" via `fetch('/api/exit?action=quit', {method:'POST'})`.
  - Location: `src/server/http.ts:740`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `exit-api-csrf`
  - Raised by: Security Analyst
  - Depends-on: same-cluster (the JSON-injection fix above closes the chain on its own; this finding is the second layer)
  - Notes: Local-first calibration: an authenticated, allowlisted endpoint that does `process.exit` is annoying-not-dangerous on T1; only realistic chain is XSS-in-browser → exit. Decision options for the second layer: (a) per-process exit token emitted server-side, required as header; (b) require POST body with a CSRF-style nonce; (c) accept the residual risk after fixing JSON-injection — auth gate becomes truly sufficient once XSS is closed. Option (c) is the lowest-cost path that's consistent with the maintainer's existing rationale.

- **No connection / WS rate limiting; no max concurrent WS clients per IP** — Bun.serve has no global cap; `ws.ts` maintains `sessionRefs`/`wsClientsBySession` maps without per-IP limits. With auth + IP allowlist this is fine in practice. Risk is concentrated on `--no-auth` (explicit opt-in, advanced use): an LAN attacker on an allowlisted IP could exhaust PTY count by opening many WS connections and triggering many tmux sessions.
  - Location: `src/server/ws.ts:289`
  - Location: `src/server/index.ts:562`
  - Severity: Low · Confidence: Plausible · Effort: Medium · Autonomy: needs-decision
  - Cluster hint: `ws-resource-limits`
  - Raised by: Security Analyst
  - Notes: T1 local-first; documented `--no-auth` warning in `--help`. Decision: (a) per-IP WS counter with a cap (e.g., 16 concurrent per IP); (b) accept the residual risk under the documented `--no-auth` opt-in. Option (a) is mechanical; option (b) keeps surface area small but requires no fix.

## Suggested session approach

Ship the HTML injection fix first as a standalone change — it's autofix-ready, mechanical, and closes the chain root cause. After that lands, decide whether the `/api/exit` token (finding 2) and the WS per-IP cap (finding 3) are worth additional defence-in-depth or whether the closed XSS chain plus the documented `--no-auth` opt-in suffice. The maintainer's existing rationale at `http.ts:740` already pre-decides this for the auth gate; the cluster's value is in the layered escalation chain, not in any one finding.
