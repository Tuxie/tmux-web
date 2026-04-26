---
Status: deferred
Autonomy: needs-spec
Resolved-in: 0c71b57 (deferred to docs/ideas/14-frontend-low-architectural.md)
Deferred-reason: needs-spec; auto-deferred per implement-analysis-report 2026-04-26 preflight default — tracked in docs/ideas/14-frontend-low-architectural.md
Depends-on:
informally-unblocks:
Pre-conditions:
attribution:
Commit-guidance:
model-hint: standard
---

# Cluster 14 — frontend-low-architectural

## TL;DR

- **Goal:** Four architectural notes flagged for completeness — desktop-host messaging shape, WS auth fallback (Firefox-only), toast singleton state, i18n absence.
- **Impact:** None of these are bugs at T2; all are deferred design considerations or "noted-for-future" items. Cluster surfaced via the synthesis singleton-merge rule rather than because work is needed now.
- **Size:** Small (<2h reading + decision; no code change required for most).
- **Depends on:** none
- **Severity:** Low (all four)
- **Autonomy (cluster level):** needs-spec

## Header

> Session size: Small · Analysts: Frontend · Depends on: none · Autonomy: needs-spec

## Files touched

- `src/client/desktop-host.ts` (1 finding — informational)
- `src/client/connection.ts` (1 finding)
- `src/client/ui/toast.ts` (1 finding)
- multiple files (1 finding — i18n future)

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 0 · Low: 4
- autofix-ready: 0 · needs-decision: 2 · needs-spec: 2

## Findings

- **`sendWindowState` and other `connection.send()` callers don't check for desktop-wrapper origin** — `desktop-host.ts:13-29` exposes `__electrobunSendToHost` for window messages, but the WebSocket-message paths assume browser context. Inside the Electrobun wrapper, `__electrobunSendToHost` is set by the host but `connection.send()` still goes through the WS to localhost. Minor consistency issue: there's no compile-time discriminator between host messages and server messages — any future host-side action handler has to be hand-wired. T2-acceptable, noted only because the desktop scope is in roster.
  - Location: `src/client/desktop-host.ts:13-29`
  - Severity: Low · Confidence: Plausible · Effort: Medium · Autonomy: needs-spec
  - Cluster hint: `desktop-host-shape`
  - Notes: Listed informationally; design-level critique.
  - Raised by: Frontend

- **`buildWsUrl` falls back to `current.username` / `current.password` from `location.href` even though browsers (esp. WebKit) strip these post-Basic-challenge** — `src/client/connection.ts:73-80`. The CHANGELOG notes this exact rationale for the `wsBasicAuth` field on `ClientConfig`: "WebKit strips URL userinfo from `location.href` after the HTTP Basic challenge." So the `else if (current.username) ...` branch is dead in WebKit and survives only in Chromium, which itself is intermittent. The desktop wrapper now explicitly sets `wsBasicAuth`, so the fallback is dead in the desktop case too. Worth flagging as `DEAD-2` but the fallback isn't strictly dead — Firefox preserves URL credentials longer than WebKit/Chromium do.
  - Location: `src/client/connection.ts:75-79`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `ws-auth-fallback`
  - Notes: Reasonable defensive code; could be removed but Firefox behaviour argues for keeping it. Listed as inconclusive on whether to delete.
  - Raised by: Frontend

- **`toast.ts` retains a module-level `container` div that's reused across the page lifetime — but `_resetForTest` removes it from DOM without clearing internal state** — `src/client/ui/toast.ts:5-9` creates the container at module-load time. `showToast` re-attaches it if `container.parentNode !== document.body`. `_resetForTest` clears children and detaches. Fine for production; for tests that mount/dismount the page repeatedly, the same `container` element is reused but never garbage-collected (module-level binding). On a leak-of-listeners harness, every toast added a `click` listener that's never removed — but the listener is on the toast element which is `setTimeout(() => toast.remove(), 160)`, so the GC reclaims them.
  - Location: `src/client/ui/toast.ts:5-9`, `:39`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `toast-state`
  - Notes: Behaviour is fine; flagging the module-level singleton as a test-harness concern only. No production impact.
  - Raised by: Frontend

- **UI strings are English-only literals throughout, no extraction layer (acceptable per i18n flag)** — Strings like `'Drop to upload'`, `'No files. Drag one onto the terminal.'`, `'Allow clipboard read?'`, `'Click to paste path into the terminal'` are inline. No `t()` wrapper, no message keys. The Scout flagged i18n-intent as absent; this confirms it. Mentioned only to avoid the I18N-class checklist looking accidentally clean.
  - Location: many; representative `src/client/ui/file-drop.ts:62`, `src/client/ui/clipboard-prompt.ts:30`, `src/client/ui/drops-panel.ts:38`
  - Severity: Low · Confidence: Verified · Effort: Unknown · Autonomy: needs-spec
  - Cluster hint: `i18n-future`
  - Notes: Per applicability flag `i18n-intent: absent`, this is non-actionable at T2. Filed for completeness, not for fix.
  - Raised by: Frontend

## Suggested session approach

Read-only review. Three of the four findings are explicitly noted as "no production impact, listed for completeness"; only the WS-auth-fallback finding has a real "should we delete this Firefox branch" decision and even that is debatable. Skip the cluster unless a maintainer interview surfaces a concrete reason to act on one of them. If the cluster is unactioned at the next code-analysis run, mark its findings `[~] deferred` against `docs/ideas/<slug>.md` per the deferring-shaped-work workflow.
