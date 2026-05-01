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

# Cluster 10 — frontend-correctness-micro

## TL;DR

- **Goal:** Frontend cleanups: dedupe the `currentSession` derivation, decide on the server-side root cause for `stripTitleDecoration`, fix `clientLog` Basic-Auth bypass, and tighten xterm-adapter `any` types where vendor types are available.
- **Impact:** Removes one source of three-way derivation drift, restores client-log telemetry to working order in Basic-Auth deployments (which today silently 401), and adds first-class types to the most-exercised render path.
- **Size:** Small-to-Medium (half-day).
- **Depends on:** none.
- **Severity:** Low.
- **Autonomy (cluster level):** needs-decision.

## Header

> Session size: Small-to-Medium · Analysts: Frontend · Depends on: none · Autonomy: needs-decision

## Files touched

- `src/client/ui/topbar.ts` (1 site)
- `src/client/index.ts` (2 sites)
- `src/client/client-log.ts` (1)
- `src/client/adapters/xterm.ts` (1)
- `src/client/connection.ts` or `src/client/session-settings.ts` (new shared helper site)

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 0 · Low: 4
- autofix-ready: 0 · needs-decision: 4 · needs-spec: 0

## Findings

- **`currentSession` derivation duplicated at three sites** — Both `Topbar` class (`topbar.ts:948`) and `index.ts` (`:100` and `:357`) independently implement `location.pathname.replace(/^\/+|\/+$/g, '') || 'main'`. Three sites; risk of divergence.
  - Location: `src/client/ui/topbar.ts:948`
  - Location: `src/client/index.ts:100`
  - Location: `src/client/index.ts:357`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `naming-duplication`
  - Raised by: Frontend Analyst
  - Notes: Decision: where the helper lives — `src/client/connection.ts` (close to URL building), `src/client/session-settings.ts`, or a new `src/client/url.ts`. Pick one and move all three callsites in the same commit.

- **`stripTitleDecoration` parses tmux's `set-titles-string` output instead of consuming a structured field** — `topbar.ts:1287` regex-matches the formatted string `session:idx:winname - "Actual title"` to recover the pane title. The server already emits the raw `#{pane_title}` separately (per AGENTS.md §Server-Client Protocol). The regex path triggers when something other than the pure `#{pane_title}` arrives in the `title` field.
  - Location: `src/client/ui/topbar.ts:1287`
  - Severity: Low · Confidence: Plausible · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `text-parsing`
  - Raised by: Frontend Analyst
  - Notes: Cross-scope — root cause may be server-side where `#{pane_title}` vs `set-titles-string` disambiguation happens. If the server already guarantees `#{pane_title}` only, `stripTitleDecoration` can be removed entirely. Decision needs a server-side audit before the client side is touched.

- **`clientLog` silently fails in production with Basic Auth (uses `new Image().src`, bypasses installed authenticated fetch)** — `client-log.ts:6` uses `new Image()` for fire-and-forget telemetry; the `try/catch` swallows the resulting 401. The `installAuthenticatedFetch` wrapper covers `window.fetch`, not `new Image().src`. Result: every `clientLog` call returns 401 in browser-mode production; client-side diagnostics never reach the server.
  - Location: `src/client/client-log.ts:6`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `client-log-auth`
  - Raised by: Frontend Analyst
  - Notes: Two fix shapes: (a) switch to `void fetch(url)` (goes through the installed wrapper, gets `Authorization` header); (b) use `sendBeacon` (no auth integration; simpler if no auth needed). The implicit decision: should `clientLog` work in Basic-Auth production at all? If yes, option (a). If clientLog is intended as best-effort with no auth, document the no-auth design and stop logging in browser-mode.

- **`xterm.ts` private fields typed `any`** — `private term!: any`, `private fitAddon!: any`, `private webglAddon: any | null`. Vendored type aliases via `tsconfig.client.json` `paths` are available for `term`, `fitAddon`, and `webglAddon`. The internal renderer chain (`_renderService`, `_glyphRenderer`, etc.) must remain `any` since xterm does not export those types.
  - Location: `src/client/adapters/xterm.ts:15`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `type-safety`
  - Raised by: Frontend Analyst
  - Notes: Partial improvement — type top-level fields (`Terminal`, `FitAddon`, `WebglAddon | null`) and leave internal renderer as `any`. May require minor `tsconfig.client.json` lib adjustments. Decision: do the partial fix or accept the status quo until xterm exposes more types.

## Suggested session approach

Brainstorm session of 15–20 minutes covering all four — the decisions are interrelated. For `currentSession`, pick the helper location and move (mechanical once decided). For `stripTitleDecoration`, do a 5-minute server-side audit of `title` emission before touching client code. For `clientLog`, decide whether to migrate to `fetch` (recommended — diagnostics actually reach the server) or document the no-auth design. For xterm `any` types, recommend the partial fix (top-level fields with vendored types). Then ship in one commit.
