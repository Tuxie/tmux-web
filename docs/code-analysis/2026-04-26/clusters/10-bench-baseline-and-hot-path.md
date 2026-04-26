---
Status: closed
Autonomy: needs-decision
Resolved-in: 4ea6999 (F3/F4 bench infrastructure) + 3ccc50d (F1/F2 per-cell snapshot hoist; identity -21%, active -1.6% noise; flattening would not materially help — OKLab math dominates the active path)
Depends-on:
informally-unblocks:
Pre-conditions:
attribution:
Commit-guidance:
model-hint: standard
---

# Cluster 10 — bench-baseline-and-hot-path

## TL;DR

- **Goal:** Add a measurement loop for the WebGL render-math hot path and address the per-cell allocation pattern that flows through it.
- **Impact:** Today the bench script (`scripts/bench-render-math.ts`) covers only the cell-math primitives, not the actual per-cell hot path in `xterm.ts:338-374` (`themeSnapshot()` + `stateSnapshot()` allocations × cells × frames). A regression in the per-cell allocation cost won't surface in the existing bench and there is no baseline to compare against.
- **Size:** Medium (half-day).
- **Depends on:** none
- **Severity:** Medium (highest in cluster)
- **Autonomy (cluster level):** needs-decision

## Header

> Session size: Medium · Analysts: Frontend, Coverage · Depends on: none · Autonomy: needs-decision

## Files touched

- `src/client/adapters/xterm.ts` (2 findings)
- `scripts/bench-render-math.ts` (extension)
- `package.json` (add `bench` script)
- new `bench/baseline.json` (proposed)

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 1 · Low: 3
- autofix-ready: 0 · needs-decision: 4 · needs-spec: 0

## Findings

- **`xterm-cell-math.ts` per-cell hot path allocates two snapshot objects per cell per frame** — `themeSnapshot()` and `stateSnapshot()` in `_patchWebglExplicitBackgroundOpacity` (xterm.ts:338-350) build a fresh `XtermCellTheme` and `XtermCellState` object on every cell that triggers `withBlendedEffectiveBackground`. At a 240×50 grid × 60 fps that's up to 1.4M small-object allocations/sec when the user is dragging a slider, plus the GC pressure on top. The bench script (`scripts/bench-render-math.ts`) does not capture this path, so a regression won't surface there. Comment at xterm.ts:336 acknowledges "the cost is one tiny object allocation per cell" — but it's two per cell, on every cell, every frame. The math itself is in `xterm-cell-math.ts` as pure functions; the cost is purely the snapshot/closure capture style.
  - Location: `src/client/adapters/xterm.ts:338-374`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `webgl-hot-path-alloc`
  - Notes: T2 scale, this is a micro-optimisation — visible only under continuous redraws (slider drag, cursor blink on busy panes). Worth noting for the bench. Fix shape options: (a) hoist both snapshots out of `updateCell` and refresh from a `_renderInvalidate`-equivalent; (b) flatten to direct adapter-property reads in the patched function. (a) is closer to the existing pattern but invalidating on bg/contrast/sat changes adds plumbing.
  - Raised by: Frontend

- **`themeSnapshot` reads from `renderer._themeService` on every cell, but the result is identical for every cell of a single frame** — Same site as above. The `bgDefaultRgba`/`fgDefaultRgba`/`ansi` values are frame-stable; only the adapter-state values can change between frames. Per-frame caching would eliminate the per-cell theme-service walks. The per-cell allocation cost is the bigger hit, but the lookup chain `renderer._themeService?.colors?.background?.rgba ?? 0x000000ff` runs on every cell too.
  - Location: `src/client/adapters/xterm.ts:338-342`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `webgl-hot-path-alloc`
  - Depends-on: cluster 10-bench-baseline-and-hot-path (internal — both findings share the same call site)
  - Raised by: Frontend

- **PROF-1: WebGL render-math hot path bench exists but is not gated, has no baseline, and isn't runnable from `package.json`** — `scripts/bench-render-math.ts` and `make bench` exist, but: (a) no `bench` script in `package.json` (verified — `package.json:9-21` has `dev/build/test/coverage/start/desktop:*` only); (b) the bench prints ns-per-call to stdout with no JSON sink and no checked-in baseline (`bench/results/`, `*.json` baselines all absent); (c) it covers only the cell-math primitives (`pushLightness`, `adjustSaturation`, `srgbByteToOklab`, `oklabToSrgbByte`) and **does not bench the actual per-cell hot path** in `src/client/adapters/xterm.ts:368-376` and `:218-278` — i.e., the `themeSnapshot()`/`stateSnapshot()` per-cell allocation pattern flagged by Frontend. So a regression in the per-cell allocation cost or in `withBlendedEffectiveBackground`'s allocation pattern won't show up. `xterm.ts` was last modified 2026-04-25 (verified via `git log`) — three days after the bench was added 2026-04-21. There is no measurement loop catching drift.
  - Location: `scripts/bench-render-math.ts:1-85`, `Makefile:60-61`, `src/client/adapters/xterm.ts:338-376`
  - Severity: Medium · Confidence: Verified · Effort: Medium · Autonomy: needs-decision
  - Cluster hint: `bench-no-baseline`
  - Notes: Two complementary fixes (any subagent can pick one): (a) add `withBlendedEffectiveBackground` to the bench cases — it's the function actually called per-cell and exercises both `themeSnapshot()` and `stateSnapshot()` allocation paths; (b) emit machine-readable output (a `bench/results/<git-sha>.json` line per case) and a tiny compare script so a delta vs. main is visible. T2-appropriate: solo maintainer, no need for full benchmarking infra; just a baseline JSON committed and a `bun run bench` script that exits non-zero on >X% regression. Without a measurement loop, the bench is a one-shot diagnostic, not a guard.
  - Raised by: Coverage

- **PROF-2: No bench/profile artifacts checked in despite explicit hot-path concern** — `docs/ideas/webgl-mock-harness-for-xterm-adapter.md` exists, the bench script is in-tree, and `_patchWebglExplicitBackgroundOpacity` is documented in `bench-render-math.ts:1-12` as running "720k calls/sec per transform" at 60fps in a 240x50 terminal. But: zero `*.prof`, zero `flamegraph.*`, zero `bench/results/`, zero baseline files in tree. Frontend analyst flagged a per-cell allocation in the same hot path. There is no historical measurement to confirm or deny that flag, and no place to write one when subagent runs `make bench`.
  - Location: `Makefile:60-61`, `scripts/bench-render-math.ts`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `bench-no-baseline`
  - Notes: Right-sized for T2 solo: a single committed `bench/baseline.json` produced by the current bench, plus a `scripts/bench-compare.ts` wrapper that fails on >20% regression, would close PROF-1 and PROF-2 together. No need for CI integration at T2 — a documented "run `make bench` before tagging" line in `AGENTS.md` (next to the existing `make fuzz` step) is the proportional fix.
  - Raised by: Coverage

## Suggested session approach

Two-step. (1) Extend `scripts/bench-render-math.ts` to cover `withBlendedEffectiveBackground` (the actual per-cell function) and emit JSON to stdout when invoked with `--json`. (2) Commit a `bench/baseline.json` from a clean run, add a `bench` and `bench:check` script to `package.json`, and add a one-line `make bench` mention to AGENTS.md's pre-release verification surface (next to `make fuzz`).

The actual allocation-fix decision (hoist snapshots vs. flatten property reads) can ship after the baseline lands — once measurement is in place, the maintainer can pick the cheaper fix shape based on real numbers rather than reading code.
