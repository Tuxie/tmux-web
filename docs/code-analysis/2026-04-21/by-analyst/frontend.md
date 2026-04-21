# Frontend Analyst — analyst-native output

> Preserved for traceability. For fix work, use the clusters under `../clusters/` — they cross-cut these per-analyst sections.

## Summary

The frontend is well-structured for a T2 solo project: clean module boundaries, CSS custom-property theme system working correctly, the complex xterm WebGL patching is thoroughly documented. The two most impactful actionable findings are (1) the OKLab math duplication between `fg-contrast.ts` and `tui-saturation.ts` (a ~60-line extract-to-shared-module fix), and (2) the accessibility gaps in custom dropdowns — `role="option"`, `role="listbox"`, and keyboard arrow navigation are absent from all four dropdown types, which is a material usability issue for keyboard-only users even in a terminal context. The inline-`style` finding against `page.style.backgroundColor` is a genuine CLAUDE.md policy violation (look-and-feel colour, not a visibility toggle) but a trivially fixable one via `setProperty`. No misclassified tier items; all findings well within T2 scope.

## Findings (by cluster)

**→ cluster 02-client-unit-test-coverage** subsumes analyst's three TEST-3 findings (dropdown.ts, toast.ts, connection.ts) via the Coverage & Profiling analyst's overlapping lcov-verified evidence.

**→ cluster 05-dropdown-a11y**
- A11Y-1 dropdown items no `role="option"` — Medium / Verified
- A11Y-1-B status dots color-only for AT — Low / Verified
- A11Y-2 no keyboard operability for custom dropdown items — Medium / Verified

**→ cluster 09-xterm-oklab-dedup**
- OKLab math duplicated between `fg-contrast.ts` and `tui-saturation.ts` — Medium / Verified
- DEAD-2 `pushFgLightness` deprecated alias — Low / Verified
- EFF-3 `ThemeInfo.defaultTuiOpacity` dead field — Low / Verified

**→ cluster 10-client-robustness-cleanup**
- FE-1-A Inline `page.style.backgroundColor` violates "No inline CSS" — Low / Verified
- QUAL-5a Missing type coercion for `msg.title` before `textContent` — Low / Plausible
- QUAL-5b Silent boot-fetch failures in session/colours/theme — Low / Verified
- QUAL-5c `ResizeObserver` + document-level listeners no cleanup path — Low / Verified
- TYPE-1-B Unnecessary `(window as any)` casts — Low / Verified
- ERR-4 WebSocket `onerror` handler is a no-op — Low / Verified

**→ cluster 11-topbar-ergonomics**
- DEAD-1 `#btn-session-plus` with no wired action — Low / Verified
- QUAL-1-B 17 near-identical per-slider `addEventListener('input')` blocks — Low / Verified
- QUAL-3 Inconsistent clamping in slider commit paths — Low / Verified
- CONC-1 Potential race between `refreshCachedSessions` and dropdown render — Low / Speculative
- NAM-8 Ambiguous slider labels "Brightest", "Darkest", "Depth" — Low / Verified

**→ cluster 12-theme-css-cleanup**
- FE-21 `#menu-dropdown` slider rules duplicated across theme CSS files — Low / Verified
- FE-23 Inconsistent CSS class-naming convention — Low / Verified

**Dropped (not in any cluster)**
- TYPE-1 `xterm.ts` pervasive `any` for vendored internals — documented intentional; no fix without typing the vendored internals — dropped as rule-restatement (see `not-in-scope.md`).
- FE-1-B Inline position styles on dropdown positioning — justified by dynamic-value carve-out — dropped as stylistic.
- FE-1-C Probe inline styles in `getBodyBg()` — justified scratch element — dropped as stylistic.

## Checklist (owned items)

| Code | Status | Notes |
|---|---|---|
| EFF-1 | [x] clean — OKLab math O(1); patched WebGL loop inherent to cell/frame rendering | |
| EFF-2 | [x] clean — fetches appropriately deduped via in-memory caches | |
| EFF-3 | [x] cluster 09 (pushFgLightness, defaultTuiOpacity); cluster 11 (#btn-session-plus) | |
| PERF-1 | [x] clean — module-level caches for lists/themes/fonts adequate | |
| PERF-2 | [x] clean — xterm addons dynamically imported after Terminal init | |
| PERF-3 | [x] cluster 10 (uncleanable listeners in `main()`) | |
| PERF-5 | [x] clean — no AbortSignal in client fetch; acceptable at T2 | |
| QUAL-1 | [x] cluster 09 (OKLab math dup); cluster 11 (slider event wiring) | |
| QUAL-2 | [x] clean — adapters/ui/shared/protocol well-separated | |
| QUAL-3 | [x] cluster 11 (clamping inconsistency) | |
| QUAL-4 | [x] clean — WebGL patcher complex but documented workaround, not over-engineering | |
| QUAL-5a | [x] cluster 10 (title coercion) | |
| QUAL-5b | [x] cluster 10 (silent boot failures, ws.onerror noop) | |
| QUAL-5c | [x] cluster 10 (ResizeObserver, window resize, topbar document listeners) | |
| QUAL-6 | [-] N/A — plain TS+DOM by design | |
| QUAL-7 | [x] clean — hexToRgb is a small necessary utility | |
| QUAL-8 | [x] clean — xterm workarounds all documented in CLAUDE.md | |
| QUAL-9 | [x] clean — `colours.ts`/`protocol.ts` client-only; server counterparts separate | |
| ERR-4 | [x] cluster 10 | |
| ERR-5 | [x] clean — JSON parses wrapped; try/catch present | |
| CONC-1 | [x] cluster 11 (speculative race) | |
| CONC-2 | [x] clean — `void` used correctly as fire-and-forget intent | |
| CONC-4 | [x] clean — dropped with PERF-5 | |
| OBS-4 | [-] N/A — no telemetry | |
| TYPE-1 | [x] cluster 10 (window-as-any); xterm internals `any` dropped as documented | |
| TYPE-2 | [x] clean — `TerminalAdapter` fully typed; `any` confined to xterm internals | |
| TYPE-3 | [x] clean — optional chains guard real undefined | |
| A11Y-1 | [x] cluster 05 | |
| A11Y-2 | [x] cluster 05 | |
| A11Y-3 | [x] clean — shape cue (border ring) in base.css for stopped dot | |
| A11Y-4 | [-] N/A — auth-gated terminal, no crawlable surface | |
| A11Y-5 | [x] clean — no `<img>` elements in frontend | |
| I18N-1..3 | [-] N/A — no i18n intent | |
| SEO-1..3 | [-] N/A — auth-gated terminal, no crawlable surface | |
| FE-1 | [x] cluster 10 (page.style.backgroundColor); other instances dropped as justified | |
| FE-2 | [x] clean — layout uses flex/grid/absolute throughout | |
| FE-3 | [x] clean — no inline `onclick=` in `index.html` | |
| FE-4 | [x] cluster 05 subsumes (dropdown items as `<div>` → A11Y-1) | |
| FE-5 | [-] N/A — plain TS+DOM project by design | |
| FE-6 | [x] clean — single styling system: CSS custom properties + class cascade | |
| FE-7 | [x] `!important` confined to two xterm override lines in `base.css` (documented); acceptable | |
| FE-8 | [x] clean — deliberately global CSS in a single-page app | |
| FE-9..FE-13 | [x] clean — no overlapping libraries | |
| FE-14 | [x] clean — no jQuery or polyfills | |
| FE-15 | [-] N/A — plain-DOM project | |
| FE-16 | [x] clean — no `<img>` in UI | |
| FE-17 | [x] clean — no images to lazy-load; fonts loaded via FontFace API | |
| FE-18 | [x] clean — form labels implicit-wrap; dynamic context inputs have visible span labels | |
| FE-19 | [x] cluster 10 subsumes (QUAL-5c) | |
| FE-20 | [x] clean — no Node/Bun-specific imports in client | |
| FE-21 | [x] cluster 12 (slider rules in theme files) | |
| FE-22 | [x] clean — repeated patterns all have base classes | |
| FE-23 | [x] cluster 12 (class-naming convention) | |
| UX-1 | [x] clean — theme divergences intentional; confirm() use has code-comment rationale | |
| UX-2 | [x] clean — only Cmd+F and Cmd+R custom shortcuts | |
| DEP-1..DEP-8 | [x] clean (frontend-scoped) — no overlapping frontend packages | |
| NAM-1..NAM-7 | [x] clean (frontend-scoped) | |
| NAM-8 | [x] cluster 11 (ambiguous slider labels) | |
| DEAD-1 | [x] cluster 11 (#btn-session-plus) | |
| DEAD-2 | [x] cluster 09 (pushFgLightness) | |
| COM-1..3 | [x] clean — comment quality high throughout | |
| MONO-1, MONO-2 | [-] N/A — not monorepo | |
