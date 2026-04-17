# Frontend — analyst-native output

> Preserved for traceability. For fix work use the clusters under `../clusters/`.

## Summary

The frontend is in good health for a T2 project: the vanilla-TS architecture is clean and deliberate, the CSS split between `base.css` and theme files is well-maintained with only two structural violations (`.tw-dd-hidden-select` duplication; `accent-color` base-rule forcing an `!important` in the amiga theme), and all async operations are properly guarded. The main actionable items are small: the duplicate `ResizeObserver` on `#terminal`, the `(document as any).fonts.add()` unnecessary cast, and missing `aria-expanded`/`aria-haspopup` on custom dropdown triggers. The colour-only session-status dots and the `confirm()` vs. custom-modal inconsistency are the only user-visible UX gaps worth noting.

## Findings

- **Dual ResizeObserver on `#terminal` causes redundant fit() calls** — `src/client/adapters/xterm.ts:98`, `src/client/index.ts:244` · Low/Verified · Cluster hint: `resize-fit` · → see cluster 07-frontend-hygiene
- **`base.css` contains hardcoded dark-theme colours in components themes cannot cleanly override** — `src/client/base.css:32-122` · Low/Verified · Cluster hint: `css-theming` · → see cluster 08-css-theming
- **`.tw-dd-hidden-select` duplicated verbatim in both theme CSS files** — `themes/default/default.css:45`, `themes/amiga/amiga.css:256` · Low/Verified · Cluster hint: `css-theming` · → see cluster 08-css-theming
- **`(document as any).fonts.add(ff)` — unnecessary `any` cast** — `src/client/theme.ts:55` · Low/Verified · Cluster hint: `type-safety` · → see cluster 07-frontend-hygiene
- **`(window as any).__adapter = adapter` exposes adapter as untyped global** — `src/client/index.ts:89` · Low/Verified · Cluster hint: `type-safety` · → see cluster 07-frontend-hygiene
- **Session status dots are colour-only signals (A11Y-3)** — `src/client/ui/topbar.ts:144-146`, `themes/default/default.css:123-124` · Low/Verified · Cluster hint: `a11y` · → see cluster 07-frontend-hygiene
- **Custom dropdown triggers lack `aria-expanded` and `aria-haspopup`** — `src/client/ui/dropdown.ts:491-494`, `src/client/ui/topbar.ts:269-273` · Low/Verified · Cluster hint: `a11y` · → see cluster 07-frontend-hygiene
- **Native `confirm()` dialogs for destructive actions** — `src/client/ui/topbar.ts:192,631` · Low/Verified · Cluster hint: `ux-consistency` · → see cluster 07-frontend-hygiene
- **`MutationObserver` in `drops-panel.ts` never disconnected** — `src/client/ui/drops-panel.ts:156-160` · Low/Verified · Cluster hint: `resource-cleanup` · → see cluster 07-frontend-hygiene
- **Paste event handler can silently swallow text when WS not yet open** — `src/client/index.ts:259-266`, `src/client/connection.ts:32-34` · Low/Verified · Cluster hint: `error-handling` · → see cluster 07-frontend-hygiene
- **`amiga.css` uses `!important` on `input { accent-color }` and `#menu-footer:hover`** — `themes/amiga/amiga.css:422,424` · Low/Verified · Cluster hint: `css-theming` · → see cluster 08-css-theming

## Checklist (owned items)

- `EFF-1..3 [-] N/A — below profile threshold (project=T2)`
- `PERF-1 [x] src/client/theme.ts:26-39 clean — listThemes/listFonts use module-level cache`
- `PERF-2 [-] N/A — single-page app, bundle pre-split`
- `PERF-3 [-] N/A — below profile threshold (project=T2)`
- `PERF-5 [x] clean — Connection.reconnect() cancels pending timers`
- `QUAL-1..4 [-] N/A — below profile threshold (project=T2)`
- `QUAL-5a [-] N/A — below profile threshold (project=T2)`
- `QUAL-5b [x] clean — all fetch() calls check res.ok`
- `QUAL-5c [-] N/A — below profile threshold (project=T2)`
- `ERR-4 [x] clean — vanilla TS; defensive try/catch on async paths`
- `ERR-5 [-] N/A — below profile threshold (project=T2)`
- `CONC-1 [-] N/A — below profile threshold (project=T2)`
- `CONC-2 [x] src/client/index.ts:205,208,215,307 — void intentional on fire-and-forget async`
- `CONC-4 [x] clean — WS reconnect cancels timer; no uncancelled long-poll`
- `OBS-4 [-] N/A — no telemetry in scope`
- `TYPE-1 [x] src/client/index.ts:89 — (window as any).__adapter`
- `TYPE-2 [x] src/client/adapters/xterm.ts — internal any typed; public TerminalAdapter interface fully typed`
- `TYPE-3 [x] src/client/ui/topbar.ts:219,231 — as any on undeclared window props; not optional-chaining`
- `A11Y-1 [x] src/client/ui/dropdown.ts:491-494 — missing aria-expanded/haspopup`
- `A11Y-2 [x] clean — title attrs + keyboard actions (Esc, Enter) present`
- `A11Y-3 [x] src/client/ui/topbar.ts:144-146 — colour-only status dots`
- `A11Y-4 [?] inconclusive — no landmark roles on #topbar; not scoped to full assessment`
- `A11Y-5 [x] clean — no <img> elements in scope`
- `I18N [-] N/A — no i18n intent per scout`
- `SEO [-] N/A — LAN-oriented self-hosted tool; below profile threshold`
- `FE-1 [x] src/client/base.css:32-122 — hardcoded colours; dropdown.ts dynamic values are permitted`
- `FE-2..3 [-] N/A — below profile threshold (project=T2)`
- `FE-4 [x] clean — semantic HTML used throughout`
- `FE-5 [-] N/A — no framework; vanilla DOM is intended`
- `FE-6 [x] themes/default/default.css:45, themes/amiga/amiga.css:256 — structural rule duplicated across themes`
- `FE-7 [x] clean — CSS specificity well-controlled`
- `FE-8 [x] clean — rules scoped to IDs or semantic classes`
- `FE-9..13 [-] N/A — single UI approach; no overlapping libs/state/HTTP/date/icon`
- `FE-14 [-] N/A — no jQuery/Lodash`
- `FE-15 [-] N/A — no reactive framework`
- `FE-16..17 [-/x] N/A — no <img> in scope; xterm addons dynamically imported`
- `FE-18 [x] clean — <label> wraps <input>; title attrs on icon buttons`
- `FE-19 [x] src/client/ui/drops-panel.ts:156, xterm.ts:98 — observers never disconnected (page-lifetime)`
- `FE-20 [-] N/A — no node/server-only imports in client bundle`
- `UX-1 [x] src/client/ui/topbar.ts:192,631 — confirm() vs custom modal inconsistency`
- `UX-2 [x] clean — keyboard/mouse interactions consistent; Esc dismisses dropdowns`
- `NAM-1..4,6,7 [-] N/A — below profile threshold (project=T2)`
- `NAM-5 [-] N/A — frontend scope`
- `NAM-8 [x] clean — UI strings sampled; no typos`
- `DEAD-1 [x] clean — no feature flags`
- `DEAD-2 [x] clean — no @deprecated imports`
- `COM-1..3 [-] N/A — below profile threshold (project=T2)`
