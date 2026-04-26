# Coverage & Profiling Analyst — analyst-native output

> Preserved for traceability. For fix work, use the clusters under `../clusters/` — they cross-cut these per-analyst sections.

## Summary

Dynamic pass ran. Invoked `bun run coverage:check` once (auto-detected, confirmed at `package.json:16` as `bun test --coverage --coverage-reporter=lcov && bun run scripts/check-coverage.ts`); 1038 tests passed in 15s, gate failed 79.3% < 80% on `scripts/prepare-electrobun-bundle.ts`. Bench command was `none-detected` per dispatch — skipped per spec, but the absence is itself the PROF-1/PROF-2 finding (bench script and `make bench` target exist, but `package.json` doesn't expose a `bench` script and there's no baseline-comparison loop). Top two gaps: (1) `src/desktop/index.ts` has zero coverage and is invisible to the gate because the gate iterates only emitted lcov records — desktop wrapper main is uncovered and unflagged; (2) the WebGL render-math hot-path concern (Frontend's `webgl-hot-path-alloc` cluster) has no measurement loop — the bench script primes ns-per-call for primitives but never runs `withBlendedEffectiveBackground` end-to-end and writes no baseline.

## Findings

(Findings have been merged into clusters; cluster files carry the verbatim bodies.)

- **`scripts/prepare-electrobun-bundle.ts` failed coverage gate (79.3% lines vs. 80% override)** — `scripts/prepare-electrobun-bundle.ts:26-41` — Severity Medium, Confidence Verified · → see cluster 20-test-and-coverage-gaps
- **`src/desktop/index.ts` has zero coverage and is silently invisible to the gate** — `src/desktop/index.ts:1-117`, `scripts/check-coverage.ts:11-23` — Severity Medium, Confidence Verified · → see cluster 20-test-and-coverage-gaps
- **Coverage gate doesn't warn on missing-from-lcov files** — `scripts/check-coverage.ts:88-110` — Severity Medium, Confidence Verified · → see cluster 20-test-and-coverage-gaps
- **`src/server/index.ts` at 26.5% line coverage despite being the CLI/bootstrap entry point** — `src/server/index.ts:190-484` — Severity Low, Confidence Verified · → see cluster 20-test-and-coverage-gaps
- **PROF-1: WebGL render-math hot path bench exists but is not gated, has no baseline, and isn't runnable from `package.json`** — `scripts/bench-render-math.ts:1-85`, `Makefile:60-61`, `src/client/adapters/xterm.ts:338-376` — Severity Medium, Confidence Verified · → see cluster 10-bench-baseline-and-hot-path
- **PROF-2: No bench/profile artifacts checked in despite explicit hot-path concern** — `Makefile:60-61`, `scripts/bench-render-math.ts` — Severity Low, Confidence Verified · → see cluster 10-bench-baseline-and-hot-path

## Checklist (owned items)

- COV-1 [x] `src/desktop/index.ts` (0% — invisible to gate; coverage missing-record blind spot in `scripts/check-coverage.ts`)
- COV-2 [x] `src/server/index.ts` `startServer()` body (26.5% lines, ~310 uncovered) — public-surface entry point
- COV-3 [x] `scripts/check-coverage.ts:11-23` — `EXCLUDES` swallows whole `src/server/index.ts`/`src/client/index.ts`/`src/client/adapters/xterm.ts`/`src/client/ui/topbar.ts`; gate doesn't reconcile against `git ls-files src/` so missing-from-lcov files are silently OK; verified `bun run coverage:check` failed on `scripts/prepare-electrobun-bundle.ts: lines 79.3% < 80%` per dynamic run.
- PROF-1 [x] `scripts/bench-render-math.ts` covers only the cell-math primitives, not the actual per-cell allocation hot path in `xterm.ts:338-376`; no `package.json` `bench` script; no JSON output; bench script (2026-04-21) predates the latest `xterm.ts` change (2026-04-25).
- PROF-2 [x] No `*.prof`, no `flamegraph.*`, no `bench/results/`, no baseline JSON in tree; bench is a one-shot diagnostic with no comparison loop.
