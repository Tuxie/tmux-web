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

# Cluster 07 — security-low-defenses

## TL;DR

- **Goal:** Tighten file modes, add minimum-effort security headers, drop password-in-userinfo on the desktop URL, and fuzz the two remaining security-sensitive parsers.
- **Impact:** Closes small layered defences below the headline issues — multi-user host snooping of consent grants, click-jacking on first visit before HSTS is in place, Basic-Auth credentials lingering in WebKit history, and untested input shapes in `isAuthorized` / `parseAllowOriginFlag`.
- **Size:** Medium (half-day).
- **Depends on:** none.
- **Severity:** Low.
- **Autonomy (cluster level):** needs-decision — multiple findings have ≥2 reasonable fix shapes; only the file-mode change is purely mechanical.

## Header

> Session size: Medium · Analysts: Security · Depends on: none · Autonomy: needs-decision

## Files touched

- `src/server/sessions-store.ts` (1)
- `src/server/http.ts` (security headers — 2 response paths)
- `src/desktop/auth.ts` (1)
- `src/desktop/index.ts` (1)
- `tests/fuzz/` (2 new files: `isAuthorized` parser + `parseAllowOriginFlag`)

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 0 · Low: 4
- autofix-ready: 1 · needs-decision: 3 · needs-spec: 0

## Findings

- **`sessions.json` written without explicit file mode** — `saveConfig` writes the consent-grants file via `fs.writeFileSync(tmp, …)` with default mode (`0o666 & ~umask`, typically `0o644`). On a multi-user host with permissive umask, another local user can read which executables you have granted clipboard read/write to and the BLAKE3 hash of those binaries. Compare with `src/server/tls.ts:85`, which correctly uses `mode: 0o600` for `selfsigned.key`.
  - Location: `src/server/sessions-store.ts:117`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `file-mode-hardening`
  - Fix: Change line 117 to `fs.writeFileSync(tmp, JSON.stringify(config, null, 2), { mode: 0o600 });` and add `fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });` at line 115.
  - Raised by: Security Analyst

- **No security headers on HTML responses (CSP / X-Frame-Options / X-Content-Type-Options / Referrer-Policy / HSTS)** — `/` HTML template carries no security headers. Local-first auth-gated tool exposures: clickjacking via authenticated browser following a cross-origin iframe; MIME-sniff XSS on user-pasted theme files; HSTS missing means an attacker stripping TLS from a LAN connection on first visit can intercept Basic Auth.
  - Location: `src/server/http.ts:771`
  - Location: `src/server/http.ts:251`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `security-headers`
  - Raised by: Security Analyst
  - Notes: T1 calibration: minimum-effort `X-Content-Type-Options: nosniff` + `Referrer-Policy: no-referrer` is autofix-ready; `X-Frame-Options: DENY` is unconditional and easy. Full CSP requires `'unsafe-inline'` for the `<script>window.__TMUX_WEB_CONFIG…</script>` bootstrap and is more thought. HSTS only when `config.tls`. Decision: minimum set (XCTO + Referrer + XFO) vs. full CSP.

- **`buildAuthenticatedUrl` constructs `http://user:pass@host:port/` (desktop)** — Always produces a userinfo URL. The desktop wrapper runs the inner server with `--no-tls` on `127.0.0.1` (so `http` is correct), but embedding the password in URL userinfo means it reaches `process` titles, browser history (if copied), and any logging proxy in the WebKit/CEF view. The `tw_auth=<token>` query path is preferred and already implemented in `auth-fetch.ts`.
  - Location: `src/desktop/auth.ts:42`
  - Location: `src/desktop/index.ts:57`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `desktop-auth`
  - Raised by: Security Analyst
  - Notes: Switch `buildAuthenticatedUrl` to `http://${host}:${port}/?tw_auth=${token}` removing userinfo. T1 / local-only / single-user → real impact is "credential lingers in WebKit history". Decision: switch to query token (preferred — already implemented for the rest of the codebase) vs. accept the userinfo first-navigation cost.

- **FUZZ-1: missing fuzz coverage on Basic-Auth header parser and `parseAllowOriginFlag`** — `isAuthorized` in `src/server/http.ts` parses `Authorization: Basic <b64>` then colon-splits — corruption could allow `:`-bearing usernames to bypass. `parseAllowOriginFlag` for the `--allow-origin` CLI flag has unit tests but no `fc.string()` fuzz. Two of ~11 security-sensitive parsers lack fuzz; the remaining nine are covered.
  - Location: `tests/fuzz/` (new files)
  - Location: `src/server/http.ts` (`isAuthorized`)
  - Location: `src/server/origin.ts` (`parseAllowOriginFlag`)
  - Severity: Low · Confidence: Verified · Effort: Medium · Autonomy: needs-decision
  - Cluster hint: `fuzz-coverage`
  - Raised by: Security Analyst (joint with Test for FUZZ-1)
  - Notes: ~50 LOC each. Decision: write both, write only `isAuthorized` (the one with the credential boundary), or defer to a future fuzz-expansion pass. Recommend the first option — the marginal cost is small once the harness is set up.

## Suggested session approach

Mechanical first: ship the `0o600` file-mode change as autofix. Then a brainstorm of ~15 minutes covering security-headers (pick the minimum set), desktop-auth (recommend switching to `tw_auth` query), and fuzz-coverage scope (recommend both parsers). All four findings ship in one PR — they share the security-defense theme and are individually too small to merit separate review cycles.
