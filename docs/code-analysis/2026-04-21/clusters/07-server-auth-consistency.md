---
Status: resolved
Resolved-in: PENDING
---

# Cluster 07 — server-auth-consistency

## TL;DR

- **Goal:** `safeStringEqual` actually behaves timing-safely, and the single source of truth for "localhost" IPs lives in `shared/constants.ts`.
- **Impact:** The timing-safe intent documented on the function is not met by the current length-check short-circuit; a single-user deployment model makes practical risk very low, but the function contradicts its own name. The duplicated `LOOPBACK_IPS` set in `index.ts` diverges from the canonical `LOCALHOST_IPS`, causing `warnIfDangerousOriginConfig` to misfire for clients reaching via `::ffff:127.0.0.1`.
- **Size:** Small (<2h)
- **Depends on:** none
- **Severity:** Low

## Header

> Session size: Small · Analysts: Backend · Depends on: none

## Files touched

- `src/server/http.ts` (safeStringEqual)
- `src/server/index.ts` (LOOPBACK_IPS duplicate)
- `src/shared/constants.ts` (canonical LOCALHOST_IPS)

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 0 · Low: 2
- autofix-ready: 2 · needs-decision: 0 · needs-spec: 0

## Findings

- **`safeStringEqual` length-leaks despite constant-time intent** — `http.ts:150-154` short-circuits at `if (bufA.length !== bufB.length) return false` before the `timingSafeEqual` call, leaking whether the submitted credential is the expected length. The function's comment and name both promise timing safety. The COM-3 lens (comments that lie) also applies here.
  - Location: `src/server/http.ts:150`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `auth-hardening`
  - Fix: Two standard options — (a) pad both buffers to `Math.max(bufA.length, bufB.length)` before calling `timingSafeEqual`; (b) HMAC-key both sides with the same random key and compare the 32-byte digests, always fixed-size. Option (b) is slightly more defensive but requires a per-process random key; option (a) is the smaller change.
  - Raised by: Backend Analyst

- **`LOOPBACK_IPS` defined twice and diverging — `::ffff:127.0.0.1` absent from the `index.ts` copy** — `src/shared/constants.ts:28-32` exports `LOCALHOST_IPS` with three entries (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`). `src/server/index.ts:127` defines a private `LOOPBACK_IPS` with only two entries (omitting `::ffff:127.0.0.1`) used exclusively by `warnIfDangerousOriginConfig`. When the server is reached via an IPv4-mapped IPv6 loopback, the warning logic sees that IP as "non-loopback" and fires even when all actual users are on localhost.
  - Location: `src/server/index.ts:127`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `auth-hardening`
  - Fix: Replace `const LOOPBACK_IPS = new Set(['127.0.0.1', '::1']);` with `import { LOCALHOST_IPS as LOOPBACK_IPS } from '../shared/constants.js';` and use it directly in `warnIfDangerousOriginConfig`. Delete the private set.
  - Raised by: Backend Analyst

## Suggested session approach

Mechanical — dispatch. Order: `LOCALHOST_IPS` import first (two-line change); `safeStringEqual` rewrite second. Add a unit test that confirms `safeStringEqual` returns `false` in the same number of microsecond-scale ticks for mismatched-length inputs and same-length-different-content inputs (a coarse timing check is sufficient — this is defensive, not a payment boundary).

## Commit-message guidance

1. Name the cluster slug and date — e.g., `fix(cluster 07-server-auth-consistency, 2026-04-21): real constant-time compare + unify LOCALHOST_IPS`.
2. No `Depends-on:` chain.
