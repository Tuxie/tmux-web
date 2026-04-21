---
Status: open
Resolved-in:
---

# Cluster 10 — client-robustness-cleanup

## TL;DR

- **Goal:** Six small client-side hygiene fixes that together tighten error-surfacing, type safety, and cleanup paths: boot-fetch failures reach the user via toast, `ws.onerror` stops being a silent no-op, `page.style.backgroundColor` moves to a CSS custom property, the already-declared `Window` global types drop their unnecessary `as any` casts, `msg.title` gets a `String()` coercion, and the `ResizeObserver` + document-level listeners get proper teardown paths.
- **Impact:** Individually small; together they close three silent-failure channels (boot fetch, ws.onerror, silent subscription leak in tests) and remove one CLAUDE.md policy violation.
- **Size:** Medium (half-day)
- **Depends on:** none
- **Severity:** Low

## Header

> Session size: Medium · Analysts: Frontend · Depends on: none

## Files touched

- `src/client/index.ts` (page.style, ResizeObserver cleanup)
- `src/client/connection.ts` (ws.onerror)
- `src/client/session-settings.ts` (silent boot fetch failure)
- `src/client/colours.ts` (silent boot fetch failure)
- `src/client/theme.ts` (silent boot fetch failure)
- `src/client/ui/topbar.ts` (window-as-any casts, title coercion, document-level listener cleanup)
- `src/client/base.css` (new `--tw-page-bg` custom property rule)

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 0 · Low: 6
- autofix-ready: 3 · needs-decision: 3 · needs-spec: 0

## Findings

- **Inline `page.style.backgroundColor` violates CLAUDE.md "No inline CSS, ever"** — `src/client/index.ts:140,200` sets `page.style.backgroundColor` at boot and on every settings change, to a dynamic `rgba(...)` computed from the colour scheme plus opacity slider. CLAUDE.md's carve-out is explicitly for visibility toggles like `display: flex|none`, not for computed look-and-feel colours. The clean idiom CLAUDE.md endorses (`setProperty`) applies here.
  - Location: `src/client/index.ts:140`, `src/client/index.ts:200`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `inline-style-audit`
  - Fix: Replace `page.style.backgroundColor = composeBgColor(...)` with `page.style.setProperty('--tw-page-bg', composeBgColor(...))`; add `#page { background-color: var(--tw-page-bg); }` to `base.css`.
  - Raised by: Frontend Analyst

- **Silent boot-fetch failures in `initSessionStore`, `fetchColours`, `listThemes`** — `session-settings.ts:100-110`, `colours.ts:68-70`, `theme.ts:42-46` each wrap a boot-time fetch in `try/catch {}` that returns an empty default. If the server 500s on any of the three at boot, the client silently starts with no saved settings / no colours / no themes — the settings menu renders blank without any user-visible signal.
  - Location: `src/client/session-settings.ts:100-110` · `src/client/colours.ts:68-70` · `src/client/theme.ts:42-46`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `xterm-adapter-patches`
  - Raised by: Frontend Analyst
  - Notes: Straightforward fix: `showToast('Failed to load {settings|colours|themes}', { variant: 'error' })` on each catch path. The needs-decision is whether a single combined toast on page load (when ≥1 of the three fails) would be less noisy than three independent ones.

- **WebSocket `onerror` handler is a no-op; error state is not surfaced to the user** — `src/client/connection.ts:29` assigns `this.ws.onerror = () => {}`. Browsers fire `onerror` before `onclose` on connection failures. For `--no-tls` deployments where CORS or protocol errors fire `onerror` without a subsequent clean close, the empty handler drops the diagnostic entirely. Users see the generic "Disconnected. Reconnecting..." from `onclose` but get no upstream detail.
  - Location: `src/client/connection.ts:29`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `xterm-adapter-patches`
  - Fix: At minimum, log the error: `this.ws.onerror = (e) => { console.warn('WebSocket error', e); }`. Optionally also surface via `showToast` for the first error within a reconnect burst.
  - Raised by: Frontend Analyst

- **`ResizeObserver` and document-level listeners in `index.ts`/`topbar.ts` have no cleanup path** — `index.ts:329-333` creates a `ResizeObserver` and adds a `window.addEventListener('resize', ...)`. Neither is stored with a cleanup hook. `installMouseHandler` / `installKeyboardHandler` return values are not stored either. `topbar.ts` document-level `pointerdown` / `mousemove` / `fullscreenchange` listeners are also permanent. In a single-page-lifetime app this is not a runtime leak, but tests that instantiate `main()` more than once would accumulate listeners.
  - Location: `src/client/index.ts:324,329` · `src/client/ui/topbar.ts:*` (document-level listeners)
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `xterm-adapter-patches`
  - Raised by: Frontend Analyst
  - Notes: Two options: (a) return a `dispose()` function from `main()` that cleans all subscriptions; (b) accept the permanence and document it explicitly, so future test authors know not to call `main()` twice. Option (a) is tidier and opens the door to richer JSDOM unit tests for cluster 02.

- **Unnecessary `(window as any)` casts where `Window` global is already declared** — `topbar.ts:307` reads `(window as any).__TMUX_WEB_CONFIG?.version` even though `index.ts:39-44` already declares `Window.__TMUX_WEB_CONFIG: ClientConfig` on the global interface. Similar casts appear at `topbar.ts:327-328` (`__menuReopen`). Both can simply drop the `as any`.
  - Location: `src/client/ui/topbar.ts:307`, `src/client/ui/topbar.ts:327-328`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `xterm-adapter-patches`
  - Fix: Remove `as any`. For `__menuReopen`, also add `__menuReopen?: boolean` to the `Window` interface declaration in `index.ts` so TypeScript checks it.
  - Raised by: Frontend Analyst

- **`msg.title` set via `textContent` without a type coercion** — `topbar.ts:1194` sets `this.tbTitle.textContent = title` where `title` is a raw field from a server-pushed JSON message. `textContent` is safe from XSS, so this is not a security finding; it is a type-hygiene case where a server message with `title: 42` (a number) silently coerces.
  - Location: `src/client/index.ts:282` · `src/client/ui/topbar.ts:1194`
  - Severity: Low · Confidence: Plausible · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `xterm-adapter-patches`
  - Fix: Either `textContent = String(title ?? '')` or a typeof guard before the assignment.
  - Raised by: Frontend Analyst

## Suggested session approach

Mechanical bundle. Three decisions to answer up front as a 10-minute brainstorm: (1) combined vs separate boot-fetch toasts, (2) `main()` returns a `dispose()` vs document-permanent listener policy, (3) should `ws.onerror` also toast or just log. Once decided, all six fixes are small and can be dispatched.

## Commit-message guidance

1. Name the cluster slug and date — e.g., `cleanup(cluster 10-client-robustness-cleanup, 2026-04-21): surface boot-fetch errors + remove inline CSS + tighten window global types`.
2. No `Depends-on:` chain.
