# Cluster 07 — frontend-hygiene

> **Goal:** Small cleanups across the client: duplicated observer, type-escape hatches, missed teardown, paste-swallow, a11y gaps, UX inconsistency.
>
> Session size: Medium · Analysts: Frontend · Depends on: none

## Files touched

- `src/client/adapters/xterm.ts`, `src/client/index.ts` (dual observer)
- `src/client/theme.ts`, `src/client/index.ts` (type hygiene)
- `src/client/ui/drops-panel.ts`, `src/client/adapters/xterm.ts` (observer teardown)
- `src/client/index.ts`, `src/client/connection.ts` (paste-swallow)
- `src/client/ui/topbar.ts`, `src/client/ui/dropdown.ts` (a11y, UX)
- `themes/default/default.css` (a11y)

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 0 · Low: 9
- autofix-ready: 3 · needs-decision: 6 · needs-spec: 0

## Findings

- **Dual `ResizeObserver` on `#terminal`** — `xterm.ts:98` installs a `ResizeObserver` on `container` as part of adapter init; `index.ts:244` installs a second one on the same element for theme-swap detection. Every resize triggers two `fitAddon.fit()` calls on the same tick.
  - Location: `src/client/adapters/xterm.ts:98`, `src/client/index.ts:244`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `resize-fit`
  - Raised by: Frontend
  - Fix: Remove the `ResizeObserver` from `xterm.ts:98-99`; the outer one in `index.ts` already covers it.

- **`(document as any).fonts.add(ff)` — unnecessary `any` cast** — `theme.ts:55` casts `document` to `any` to call `.fonts.add()`. `document.fonts` is typed as `FontFaceSet` in `lib.dom.d.ts`; the cast is unnecessary and suppresses type checking on the call.
  - Location: `src/client/theme.ts:55`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `type-safety`
  - Raised by: Frontend
  - Fix: `document.fonts.add(ff);`

- **`(window as any).__adapter = adapter` exposes adapter as untyped global** — `index.ts:89` assigns the `TerminalAdapter` to `window.__adapter` via `any`, bypassing the `Window` interface augmentation at the top of the same file.
  - Location: `src/client/index.ts:89`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `type-safety`
  - Raised by: Frontend
  - Notes: If it needs to stay (debug shortcut), add `__adapter?: TerminalAdapter` to the `Window` augmentation at `index.ts:27-31`. Otherwise remove.

- **Session status dots convey running/stopped by colour only (A11Y-3)** — `.tw-dd-session-status.running` (green) and `.tw-dd-session-status.stopped` (red) have only `title` for non-colour users. Colour-blind users have no sighted signal.
  - Location: `src/client/ui/topbar.ts:144-146`, `themes/default/default.css:123-124`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `a11y`
  - Raised by: Frontend
  - Notes: Shape signal (circle vs square, or an inner glyph) fixes it without changing layout.

- **Custom dropdown trigger buttons lack `aria-expanded` and `aria-haspopup`** — Dropdown triggers and the session/settings menu buttons toggle popup visibility without ever setting these attributes. Screen readers cannot tell whether the associated popup is open.
  - Location: `src/client/ui/dropdown.ts:491-494`, `src/client/ui/topbar.ts:269-273`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `a11y`
  - Raised by: Frontend

- **Native `confirm()` dialogs for destructive actions** — Kill-session and close-window confirmations use `window.confirm()` (topbar.ts:192, topbar.ts:631). The project already has a custom styled async modal for the clipboard-read prompt (`showClipboardPrompt`). Borderline at T2 but inconsistent.
  - Location: `src/client/ui/topbar.ts:192`, `src/client/ui/topbar.ts:631`
  - Severity: Low · Confidence: Verified · Effort: Medium · Autonomy: needs-decision
  - Cluster hint: `ux-consistency`
  - Raised by: Frontend

- **`MutationObserver` in `drops-panel.ts` is never disconnected** — `drops-panel.ts:156` creates a `MutationObserver` and calls `.observe()` but the returned cleanup function does not call `.disconnect()`. Because the panel is page-lifetime this is harmless in practice, but it contradicts the `installFileDropHandler` teardown pattern in the same file.
  - Location: `src/client/ui/drops-panel.ts:156-160`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `resource-cleanup`
  - Raised by: Frontend
  - Notes: The `ResizeObserver` in `xterm.ts:98-99` has the same issue and will disappear if the dual-observer finding is applied.

- **Paste listener silently swallows text when WS is not OPEN** — `index.ts:259-266` registers a bubble-phase `paste` listener that calls `connection.send(text)`. `Connection.send()` silently drops data if `ws.readyState !== OPEN`. If the user pastes during an initial reconnect window, the text is lost with no feedback.
  - Location: `src/client/index.ts:259-266`, `src/client/connection.ts:32-34`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `error-handling`
  - Raised by: Frontend
  - Notes: Options: queue pending text until WS opens; show a toast "not connected — paste ignored"; block the paste handler entirely when disconnected.

## Suggested session approach

Two passes. First a mechanical pass: drop the duplicate `ResizeObserver`, fix the two unjustified `as any` casts, disconnect the `MutationObserver`. Then a small design pass on the three user-facing items: a11y attributes on dropdowns, status-dot shape signal, `confirm()` vs modal, paste-swallow feedback. Keep it short — none of these move the needle individually but together they raise the UX polish baseline.
