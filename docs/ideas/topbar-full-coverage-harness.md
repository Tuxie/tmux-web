# Full unit coverage for `src/client/ui/topbar.ts`

## What we want

Bring `src/client/ui/topbar.ts` to the project's standard 95% line /
90% function coverage gate. Today the file sits around 42% line /
33% func under the smoke harness written in cluster 02.

## Why it isn't already there

`Topbar` is the orchestration class that wires the settings menu, the
sessions dropdown, the windows menu, the slider table (17 rows,
cluster 11), the auto-hide timer, the fullscreen checkbox, and the
drops panel. Full unit coverage requires stubbing:

- `fetch` for `/api/themes`, `/api/fonts`, `/api/colours`,
  `/api/sessions`, `/api/session-settings`, `/api/drops`
- `document.createElement` for every shape of element the menu builds
- `localStorage` for the `prefs` module cached values
- `MutationObserver` for the drops-panel menu observer
- `history.replaceState` + `location`
- `WebSocket` (via the `send` option) — already trivial
- `requestAnimationFrame` + `setTimeout` for the slide-in / auto-hide
- `document.fullscreenElement` / `requestFullscreen` / `exitFullscreen`

The cluster-02 work already did most of this plumbing (see
`tests/unit/client/ui/topbar.test.ts`), but the slider-table path
(`setupSettingsInputs`, ~400 lines) has 17 sliders × 3 listeners ×
clamp semantics to cover, and the sessions / windows menu render
paths each want their own 10–20 cases to walk every branch of the
item builder.

## Sketch of the remaining work

1. Mount each slider with a distinct value in the fake `SessionSettings`
   and assert `updateSliderFill` writes the right `--tw-slider-val`
   percentage. 17 quick cases.
2. For each slider, fire `input` on the range and `change` on the
   number-input, and assert `commit` routes through the right clamp
   function. 34 cases.
3. For each slider, fire `dblclick` and assert the default lookup
   lands on the active theme's `default*` field (with and without
   that theme declaring the field). Two variants × 17 sliders.
4. Session dropdown: render against a fixture of 0 / 1 / many running
   sessions × 0 / 1 / many stored settings entries. Assert the
   current-marker, the new-session row, the delete button wiring.
5. Windows menu: same shape as sessions — 0 / 1 / many windows,
   left-click vs. right-click, tab-mode vs. compact-mode.
6. Theme switch handler: verify `applyThemeDefaults` is invoked with
   the right `ThemeDefaults`, and that `syncUi` runs after.
7. Reset buttons: `btn-reset-colours` / `btn-reset-font` walk the
   right set of fields.

Each bullet is mechanical once the fixture harness exists. The shape
lives in `tests/unit/client/ui/topbar.test.ts` today — extend it
rather than start fresh.

## Why we're not doing this now

~150 test cases is a full day and a half on its own. The e2e suite
already exercises the menu, slider, and window flows at a black-box
level (`tests/e2e/theming.spec.ts`, `tests/e2e/windows.test.ts`,
`tests/e2e/sessions.test.ts`), so the risk of a regression slipping
through is bounded. Cluster 02 landed the testable public surface
(`currentSession`, `updateTitle`, `updateSession`, `updateWindows`,
`renderWinTabs`, `show`, `toggleFullscreen`) plus a passing init()
smoke; the rest of this is a pure tests-quality investment.

The file currently carries a per-file line-coverage override in
`scripts/check-coverage.ts` that pins the floor at cluster-02's
achieved percentage + a small safety margin. When this work is
picked up, raise that floor toward 95% as each section of the file
becomes covered.

## Pointers

- `scripts/check-coverage.ts` — `PER_FILE_LINE_OVERRIDES['src/client/ui/topbar.ts']`
- `tests/unit/client/ui/topbar.test.ts` — existing test scaffold
- `src/client/ui/topbar.ts:486` — `updateSliderFill`
- `src/client/ui/topbar.ts:526` — `sliders: SliderSpec[]` (cluster 11)
- `docs/code-analysis/2026-04-21/clusters/02-client-unit-test-coverage.md`
- `docs/ideas/webgl-mock-harness-for-xterm-adapter.md` — the parallel
  idea for the xterm.ts adapter
