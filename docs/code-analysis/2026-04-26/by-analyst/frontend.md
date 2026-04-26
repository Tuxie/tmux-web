# Frontend Analyst — analyst-native output

> Preserved for traceability. For fix work, use the clusters under `../clusters/` — they cross-cut these per-analyst sections.

## Summary

Frontend is in good shape for a T2 OSS desktop+web tool: WebGL render-math is well-factored into pure `xterm-cell-math.ts` with a bench harness, dropdowns/menus carry proper ARIA roles and keyboard navigation per the audit cluster 05 work, and the `__twDispose` teardown surface exists. The notable gaps are: form-control labels in `index.html` use `<span>` instead of `<label for>` so screen readers don't get programmatic association (medium-impact a11y miss), the `Topbar` class adds five global document-level listeners that aren't part of the `__twDispose` chain (test-harness leak), and slider input events PUT to the server on every drag step without debounce (per-tick request fan-out). Nothing critical, no security regressions, no async-completion races. The Scout's tier classification (T2) and applicability flags (auth-gated UI, no i18n) match what I found.

## Findings

(Findings have been merged into clusters; cluster files carry the verbatim bodies.)

- **Settings-menu sliders/selects/number inputs lack programmatic label association** — `src/client/index.html:71-171` — Severity Medium, Confidence Verified · → see cluster 09-frontend-a11y
- **Topbar global event listeners have no teardown path** — `src/client/ui/topbar.ts:346,354,417,438,833` — Severity Medium, Confidence Verified · → see cluster 12-frontend-topbar-teardown
- **`Connection.send()` silently drops messages when WS is not OPEN** — `src/client/connection.ts:42-44`, `src/client/ui/topbar.ts:879,260,291,217` — Severity Medium, Confidence Verified · → see cluster 11-frontend-ws-and-input
- **`saveSessionSettings` makes a fire-and-forget PUT on every slider input event** — `src/client/session-settings.ts:143-149,179-182`, `src/client/ui/topbar.ts:541-546` — Severity Medium, Confidence Verified · → see cluster 11-frontend-ws-and-input
- **Dynamically-created `<button>` elements default to `type="submit"`** — `src/client/ui/topbar.ts:1016,1061`, `src/client/ui/drops-panel.ts:61` — Severity Low, Confidence Verified · → see cluster 09-frontend-a11y
- **`#tb-title` mousedown handler stops `pendingTitleDrag` reset on right-click + drag** — `src/client/ui/topbar.ts:342-356` — Severity Low, Confidence Verified · → see cluster 12-frontend-topbar-teardown
- **`xterm-cell-math.ts` per-cell hot path allocates two snapshot objects per cell per frame** — `src/client/adapters/xterm.ts:338-374` — Severity Low, Confidence Verified · → see cluster 10-bench-baseline-and-hot-path
- **`themeSnapshot` reads from `renderer._themeService` on every cell, but the result is identical for every cell of a single frame** — `src/client/adapters/xterm.ts:338-342` — Severity Low, Confidence Verified · → see cluster 10-bench-baseline-and-hot-path
- **Inconsistent module-extension convention: one `.ts` import among 30+ `.js`** — `src/client/index.ts:41` — Severity Low, Confidence Verified · → see cluster 17-naming-consistency
- **`ws.onerror` event ignores the `Event` type — generic Event passed to caller** — `src/client/index.ts:359-365` — Severity Low, Confidence Verified · → see cluster 11-frontend-ws-and-input
- **`extractTTMessages` parser does not bound JSON depth or size** — `src/client/protocol.ts:23-50` — Severity Low, Confidence Verified · → see cluster 11-frontend-ws-and-input
- **Slider double-click reset commits without first re-clamping the resolved default** — `src/client/ui/topbar.ts:621-625` — Severity Low, Confidence Verified · → see cluster 13-frontend-ui-quality
- **`setActive` casts `item.scrollIntoView` through `as any`** — `src/client/ui/dropdown.ts:551` — Severity Low, Confidence Verified · → see cluster 17-naming-consistency
- **Type assertion overload in topbar's `setupSettingsInputs` (54 explicit casts)** — `src/client/ui/topbar.ts:446-485` — Severity Low, Confidence Verified · → see cluster 13-frontend-ui-quality
- **Boot-error toast message lists labels but no actionable hint** — `src/client/index.ts:84-91` — Severity Low, Confidence Verified · → see cluster 13-frontend-ui-quality
- **Native `confirm()` dialogs for destructive tmux actions** — `src/client/ui/topbar.ts:288-291,975-978` — Severity Low, Confidence Verified · → see cluster 13-frontend-ui-quality
- **`Topbar` constructor depends on `getLiveSettings` callback that never resolves on cold start** — `src/client/ui/topbar.ts:810-819` — Severity Low, Confidence Plausible · → see cluster 12-frontend-topbar-teardown
- **`drops-panel.ts` row-click re-paste handler verification (no bug)** — `src/client/ui/drops-panel.ts:69` — Severity Low, Confidence Speculative · → see cluster 13-frontend-ui-quality
- **`sendWindowState` and other `connection.send()` callers don't check for desktop-wrapper origin** — `src/client/desktop-host.ts:13-29` — Severity Low, Confidence Plausible · → see cluster 14-frontend-low-architectural
- **`buildWsUrl` falls back to URL credentials post-WebKit-strip** — `src/client/connection.ts:75-79` — Severity Low, Confidence Verified · → see cluster 14-frontend-low-architectural
- **`extractTTMessages` re-emits prefix bytes when JSON malformed** — `src/client/protocol.ts:47-50` — Severity Low, Confidence Plausible · → see cluster 11-frontend-ws-and-input
- **`toast.ts` retains a module-level `container` div across page lifetime** — `src/client/ui/toast.ts:5-9,39` — Severity Low, Confidence Verified · → see cluster 14-frontend-low-architectural
- **`clipboard-prompt.ts` modal traps Escape but doesn't trap Tab** — `src/client/ui/clipboard-prompt.ts:79-95` — Severity Low, Confidence Verified · → see cluster 09-frontend-a11y
- **`installFileDropHandler`'s `depth` counter can desync with native dragenter/dragleave bubble order** — `src/client/ui/file-drop.ts:65-89` — Severity Low, Confidence Plausible · → see cluster 13-frontend-ui-quality
- **UI strings are English-only literals throughout (acceptable per i18n flag)** — multiple files — Severity Low, Confidence Verified · → see cluster 14-frontend-low-architectural

## Checklist (owned items)

(See checklist.md for the full ID-grouped view; every owned item is reproduced there.)

- EFF-1 [x] `src/client/index.ts:62` — `main()` does serial work where parallel would help; net cost small at T2.
- EFF-2 [x] `src/client/session-settings.ts:144` — see cluster 11-frontend-ws-and-input.
- EFF-3 [x] `src/client/ui/topbar.ts:541` — see cluster 11-frontend-ws-and-input.
- PERF-1 [x] `src/client/adapters/xterm.ts:338-374` — see cluster 10-bench-baseline-and-hot-path.
- PERF-2 [x] clean — sampled `oklab.ts`, `fg-contrast.ts`, `tui-saturation.ts`, `xterm-cell-math.ts`; bench script covers them.
- PERF-3 [x] clean — `src/client/ui/scrollbar.ts` uses RAF-equivalent throttling; no obvious frame waste.
- PERF-5 [x] `src/client/adapters/xterm.ts:119` — load order intentional per upstream xterm constraints.
- QUAL-1 [x] `src/client/index.ts:41` — see cluster 17-naming-consistency.
- QUAL-2 [x] clean — sampled all 33 client files; Topbar size reflects 17-slider table, not sprawl.
- QUAL-3 [x] clean — sampled `oklab.ts`, `fg-contrast.ts`, `tui-saturation.ts`, etc; pure code, well-decomposed.
- QUAL-4 [x] clean — no over-engineering relative to T2.
- QUAL-5 [x] clean — error-path coverage in `connection.ts`, `theme.ts`, `colours.ts`, `session-settings.ts`.
- QUAL-6 [x] clean — `client-log.ts` `try/catch` with no-op fallback intentional.
- QUAL-7 [x] clean — sampled magic-number sites; all named.
- QUAL-8 [x] `src/client/ui/topbar.ts:621` — see cluster 13-frontend-ui-quality.
- QUAL-9 [x] clean — sampled inputs (slider clamp, extractTTMessages, decodeClipboardBase64, composeBgColor).
- QUAL-10 [x] clean — text-parsing pass: structured value already exists smell not present in client.
- QUAL-11 [x] clean — same as QUAL-10.
- ERR-4 [x] `src/client/index.ts:359` — see cluster 11-frontend-ws-and-input.
- ERR-5 [x] `src/client/connection.ts:42` — see cluster 11-frontend-ws-and-input.
- CONC-1 [x] clean — sampled all WS / async-data sites.
- CONC-2 [x] clean — `index.ts` boot path awaits cleanly; no orphan promises.
- CONC-4 [x] clean — `Topbar.refreshCachedSessions` serialises concurrent calls.
- CONC-6 [x] clean — async-event pass: all wait for real events (WebSocket lifecycle, drag/drop, server pushes).
- CONC-7 [x] clean — sleep/poll pass: all `setTimeout` instances are one-shots.
- OBS-4 [x] clean — `client-log.ts` for diagnostic posts; appropriate severity levels.
- TYPE-1 [x] `src/client/adapters/xterm.ts:15` — `private term!: any` plus 6 other `: any` casts justified by xterm.js WebGL internals lack of types.
- TYPE-2 [x] `src/client/ui/topbar.ts:446` — see cluster 13-frontend-ui-quality.
- TYPE-3 [x] clean — no `@ts-ignore` / `@ts-expect-error` in client/desktop/shared scope.
- A11Y-1 [x] `src/client/index.html:71-171` — see cluster 09-frontend-a11y.
- A11Y-2 [x] `src/client/ui/clipboard-prompt.ts:79-95` — see cluster 09-frontend-a11y.
- A11Y-3 [x] clean — status-dot `aria-label` added in cluster 05 of 2026-04-21; verified.
- A11Y-4 [x] clean — keyboard navigation per AGENTS.md §7b; `aria-activedescendant` correctly toggled.
- A11Y-5 [x] `src/client/ui/topbar.ts` — see cluster 09-frontend-a11y. Otherwise clean.
- I18N-1 [-] N/A — no i18n intent
- I18N-2 [-] N/A — no i18n intent
- I18N-3 [-] N/A — no i18n intent
- SEO-1 [-] N/A — auth-gated UI, no crawlable surface
- SEO-2 [-] N/A — auth-gated UI, no crawlable surface
- SEO-3 [-] N/A — auth-gated UI, no crawlable surface
- FE-1 [x] `src/client/index.html:7-19` — sync-before-deferred-module pattern documented inline.
- FE-2 [x] `src/client/ui/topbar.ts:346` — see cluster 12-frontend-topbar-teardown.
- FE-3 [x] clean — no XSS surface; `textContent` everywhere except `innerHTML = ''` clear-pattern.
- FE-4 [x] clean — `getComputedStyle` reads in `index.ts:151-164` intentional, not hot-path.
- FE-5 [x] `src/client/ui/topbar.ts:541-619` — see cluster 11-frontend-ws-and-input.
- FE-6 [x] clean — `Connection.reconnect` clears timer and nullifies onclose correctly.
- FE-7 [x] `src/client/connection.ts:75-79` — see cluster 14-frontend-low-architectural.
- FE-8 [x] clean — `setStyleProperty` defensive JSDOM fallback reasonable.
- FE-9 [x] clean — sole runtime dep `@noble/hashes` server-side; client has no runtime deps beyond vendored xterm.
- FE-10 [x] clean — vendored `@xterm/xterm` build pinned via git submodule.
- FE-11 [x] clean — bun-build.ts inlines all xterm addons.
- FE-12 [x] clean — no third-party JS at runtime.
- FE-13 [-] N/A — no third-party CSS.
- FE-14 [x] clean — favicon is inline `data:` URL.
- FE-15 [x] clean — no service worker / manifest needed.
- FE-16 [x] clean — bun-build.ts bundles correctly.
- FE-17 [x] clean — single SPA route.
- FE-18 [x] clean — WebSocket reconnect with 2s linear backoff appropriate at T2.
- FE-19 [x] `src/client/ui/topbar.ts:1052` — `lastWinTabsKey` JSON.stringify memoisation reasonable.
- FE-20 [x] clean — `installAuthenticatedFetch` returns original fetch unchanged.
- FE-21 [x] clean — `auth-url.ts:withClientAuth` correctly preserves cross-origin URLs.
- FE-22 [x] `src/client/index.ts:194-196` — `adapter.focus()` after init; `setupFocusHandling` returns focus correctly.
- FE-23 [x] clean — `index.html` has charset/viewport/icon metadata fundamentals.
- UX-1 [x] `src/client/ui/topbar.ts:288,977` — see cluster 13-frontend-ui-quality.
- UX-2 [x] `src/client/index.ts:84-91` — see cluster 13-frontend-ui-quality.
- DEP-1 [x] clean — frontend deps refreshed 2026-04-23 per CHANGELOG; treat as fresh.
- DEP-2 [x] clean — `electrobun` 1.16.0 pinned exactly; others use `^` per project convention.
- DEP-3 [-] N/A — no peer-dep declaration in client scope.
- DEP-4 [x] clean — vendor/xterm.js submodule pin enforced by `scripts/verify-vendor-xterm.ts`.
- DEP-5 [x] clean — no transitive dep risk in client scope.
- DEP-6 [x] clean — no abandoned packages.
- DEP-7 [-] N/A — frontend has no separate lockfile.
- DEP-8 [x] clean — license MIT matches.
- DEP-9 [x] clean — `electrobun` 1.16.0, `fast-check` 4.7.0, `jsdom` 29.0.2 all current as of 2026-04-23.
- NAM-1 [x] `src/client/index.ts:41` — see cluster 17-naming-consistency.
- NAM-2 [x] clean — kebab-case files, PascalCase classes, camelCase functions.
- NAM-3 [x] clean — `tw-` class prefix per AGENTS.md.
- NAM-4 [x] clean — element ids per "DOM Contract (E2E Tests)" section.
- NAM-5 [x] clean — module/file names match exported symbol names.
- NAM-6 [x] clean — type names follow PascalCase with `Info`/`Options`/`Settings` suffixes.
- NAM-7 [x] clean — constants screaming-snake-case consistent.
- NAM-8 [x] UI strings English-only; consistent capitalisation/tone.
- DEAD-1 [x] clean — sampled exports; only unused-fields documented for desktop-future use.
- DEAD-2 [x] `src/client/connection.ts:75-79` — see cluster 14-frontend-low-architectural.
- COM-1 [x] clean — sampled comment density; workarounds annotated.
- COM-2 [x] clean — no stale comments in sampled files.
- COM-3 [x] clean — no commented-out code blocks.
