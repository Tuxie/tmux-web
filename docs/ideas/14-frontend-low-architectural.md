# 14 — frontend low-architectural notes (deferred)

> Status: deferred from `docs/code-analysis/2026-04-26/clusters/14-frontend-low-architectural.md`.
> All four items below are Low / no-production-impact at T2 and were flagged for completeness rather than action. Each one tracks a specific design observation so a future code-analysis run does not re-surface them as fresh findings.

---

## 1. Desktop-host messaging shape (`src/client/desktop-host.ts:13-29`)

**Observation.** `__electrobunSendToHost` is a side-channel for host messages that exists in parallel to `connection.send()` (which goes through WebSocket to the localhost server). There is no compile-time discriminator between host-side actions and server-side actions; any new host-side handler has to be hand-wired.

**Why deferred.** No production impact. The two channels carry different categories of message and the codebase is small enough that hand-wiring is fine.

**What would unblock action.** A second host-side feature lands and the host/server distinction becomes a recurring footgun. At that point, a typed discriminator (e.g. `sendHostAction(name, payload)` vs. `sendServerAction(name, payload)`) becomes worth the cost.

---

## 2. WS auth fallback to `location.href` userinfo (`src/client/connection.ts:75-79`)

**Observation.** `buildWsUrl` falls back to `current.username` / `current.password` parsed from `location.href`. Browsers behave differently:
- WebKit: strips URL userinfo after the HTTP Basic challenge → fallback is dead.
- Chromium: intermittently strips → fallback is unreliable.
- Firefox: preserves URL credentials longer → fallback still works.

The desktop wrapper sets `wsBasicAuth` explicitly, so the fallback is dead in that case.

**Why deferred.** The fallback isn't strictly dead — Firefox still relies on it. Removing it would regress Firefox-only deployments that don't set `wsBasicAuth` explicitly. Keeping it is defensible.

**What would unblock action.** A Firefox-side change that aligns with WebKit/Chromium credential stripping; or a maintainer decision that Firefox-without-`wsBasicAuth` is no longer a supported path. Either makes the branch removable.

---

## 3. Toast singleton (`src/client/ui/toast.ts:5-9, :39`)

**Observation.** Module-level `container` div is created at import time and reused across the page lifetime. `_resetForTest` clears children and detaches but doesn't replace the binding. Production: fine — the page is single-mount. Tests that repeatedly mount/dismount: the same `container` element is reused but never garbage-collected.

**Why deferred.** No production impact. The leak-of-listeners harness concern was investigated and the per-toast `click` listener is on the toast element itself (which `setTimeout(() => toast.remove(), 160)`s), so GC reclaims them. Module-level state is the project's prevailing test-harness concern, not specific to toast.

**What would unblock action.** A future multi-mount test harness (see `docs/ideas/topbar-full-coverage-harness.md`) wants to assert "no module-level state leaks across mounts". At that point toast joins the broader teardown contract.

---

## 4. i18n absence

**Observation.** UI strings are English-only literals throughout. No `t()` wrapper, no message keys. Examples: `'Drop to upload'`, `'No files. Drag one onto the terminal.'`, `'Allow clipboard read?'`, `'Click to paste path into the terminal'`.

**Why deferred.** Project's Scout-flagged `i18n-intent: absent`. Per applicability-flag calibration, i18n work is non-actionable at T2.

**What would unblock action.** A user-facing decision to support a second language. At that point the work becomes large (extraction, tooling, runtime resolution); ship as its own multi-cluster initiative, not piecemeal.

---

## Tracking

Cluster 14 carried `Autonomy: needs-spec` and the implement-analysis-report Step 0 preflight chose auto-defer to this file. The cluster's findings are reproduced inline above so the source-of-truth for these items is here, not the (frozen) cluster file. Cluster 14 is marked `Status: deferred` with `Resolved-in: (deferred — see docs/ideas/14-frontend-low-architectural.md)`.
