---
Status: open
Resolved-in:
---

# Cluster 03 — server-http-cleanup

## TL;DR

- **Goal:** Fix the one real window-list parsing bug, gate read-only endpoints on `req.method`, cache the static lookups that currently re-run per request, and tighten the `any` on the WS message router.
- **Impact:** The window parsing bug corrupts the window-tabs UI for any tmux window named with a colon. The other items are correctness-hygiene with negligible runtime impact individually but accumulate into API-surface inconsistency.
- **Size:** Small (<2h)
- **Depends on:** none
- **Severity:** Medium

## Header

> Session size: Small · Analysts: Backend · Depends on: none

## Files touched

- `src/server/ws.ts` (1 finding — window parsing)
- `src/server/http.ts` (3 findings — window parsing, method guards ×6 sites, static-cache opportunities ×3 handlers)
- `src/server/ws-router.ts` (1 finding — `any` → `unknown`)

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 1 · Low: 3
- autofix-ready: 4 · needs-decision: 0 · needs-spec: 0

## Findings

- **Window name parsing breaks on colon-containing names** — `sendWindowState` in `ws.ts:222` and the `/api/windows` handler in `http.ts:316` parse tmux `list-windows` output using a `#{window_index}:#{window_name}:#{window_active}` format string and split naively with `line.split(':')`. A window named `node:server` or `2.0:api` has its `name` truncated to the first segment and its `active` flag receives a mid-name fragment instead of `1`/`0`. The `/api/sessions` handler at `http.ts:296` correctly uses `rest.join(':')` — the WS-path and `/api/windows` variants are the drifted copies. The WS-path parser is exercised on every OSC title change.
  - Location: `src/server/ws.ts:222`, `src/server/http.ts:316`
  - Severity: Medium · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `ws-router-cleanup`
  - Fix: Replace `const [index, name, active] = line.split(':')` with either a `indexOf`/`lastIndexOf` slice (`const c1 = line.indexOf(':'); const c2 = line.lastIndexOf(':'); const index = line.slice(0, c1); const name = line.slice(c1 + 1, c2); const active = line.slice(c2 + 1);`) or change the tmux format string to use an unambiguous separator (`#{window_index}\t#{window_name}\t#{window_active}` with `\t` split).
  - Raised by: Backend Analyst

- **Read-only API endpoints accept any HTTP method** — Six endpoints have no `req.method` guard and return 200 for POST, DELETE, PATCH, etc. identically to GET: `/api/fonts`, `/api/themes`, `/api/colours`, `/api/sessions`, `/api/windows`, `/api/terminal-versions`. All mutation endpoints do correctly guard by method. For `/api/sessions` in particular, any method triggers `execFileAsync` to query tmux — wrong semantics and a wasted subprocess. Behind IP allowlist + Basic Auth, so not a security boundary, but an API-surface bug.
  - Location: `src/server/http.ts:231`, `:237`, `:243`, `:290`, `:310`, `:554`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `ws-router-cleanup` (originally); API-4 owner
  - Fix: Add `if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }` at the top of each read-only endpoint handler block.
  - Raised by: Backend Analyst

- **Static lookups recomputed on every request — `listThemes`, `listFonts`, `getTerminalVersions`** — `/api/themes` calls `listThemes(packs)` per request; `/api/fonts` calls `listFonts(packs)` per request; `/api/terminal-versions` calls `fs.readFileSync` on the xterm bundle and runs a regex on every invocation. `packs` is frozen at `createHttpHandler` time and user themes are not hot-reloaded, so all three results are static for the process lifetime. `listThemes` does multi-pass inheritance resolution and a `localeCompare` sort; impact is imperceptible at normal usage, but the pattern contradicts the cached-at-startup approach used for `colourInfos` right next to these handlers.
  - Location: `src/server/http.ts:233`, `:239`, `:136`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `ws-router-cleanup` (originally); PERF-1 owner
  - Fix: Capture `const themesCache = listThemes(packs); const fontsCache = listFonts(packs); const terminalVersionsCache = getTerminalVersions(opts.projectRoot);` at the top of `createHttpHandler` (alongside the existing `colourInfos`), then return the cached values in each handler.
  - Raised by: Backend Analyst

- **`ws-router.ts` uses untyped `any` for the parsed JSON message** — Line 41 declares `let parsed: any` and then accesses `parsed?.type`, `parsed?.cols`, etc. with optional chaining. The optional chains already guard every access, so `parsed` can be typed as `unknown` without loss of ergonomics — and doing so makes TypeScript enforce the narrowing that's already present at runtime.
  - Location: `src/server/ws-router.ts:41`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `ws-router-cleanup` (originally); TYPE-1 owner
  - Fix: Change `let parsed: any` to `let parsed: unknown`. Existing guards (`parsed?.type === 'resize'`, etc.) narrow correctly under `unknown`.
  - Raised by: Backend Analyst

## Suggested session approach

Entirely mechanical — dispatch to a subagent rather than brainstorm. Order: window-parse fix first (real bug), then the three caching changes (one closure insertion at `createHttpHandler` top, three per-handler substitutions), then method guards on the six endpoints, then the `any → unknown` change. Verify locally with `bun test` plus a manual check that the tmux window named `foo:bar` renders correctly in the topbar.

## Commit-message guidance

When the fix for this cluster lands, the commit message should:

1. Name the cluster slug and date — e.g., `fix(cluster 03-server-http-cleanup, 2026-04-21): handle colon-named tmux windows + misc HTTP handler hygiene`.
2. Call out the window-parse fix as the headline (it's the one user-visible bug); treat the rest as housekeeping.
3. No expected `Depends-on:` chain.
