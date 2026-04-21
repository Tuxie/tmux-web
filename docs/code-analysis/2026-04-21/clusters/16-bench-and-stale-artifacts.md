---
Status: resolved
Resolved-in: c7affc0
---

# Cluster 16 — bench-and-stale-artifacts

## TL;DR

- **Goal:** Add a repeatable bench for the WebGL OKLab math hot path; gitignore (or remove) the stale Bun-internal coverage `.tmp` files.
- **Impact:** Bench absence means a regression in the per-frame pixel math goes invisible until a user reports frame-rate degradation. The stale `.tmp` files are mere clutter.
- **Size:** Medium (bench work is the bulk; cleanup is minutes)
- **Depends on:** cluster 09 (extracting the OKLab helper makes it bench-addressable in isolation)
- **Severity:** Medium

## Header

> Session size: Medium · Analysts: Coverage & Profiling · Depends on: cluster 09-xterm-oklab-dedup

## Files touched

- `scripts/` (new — `bench-render-math.ts` or similar)
- `Makefile` (new `bench` target)
- `package.json` (optional — `bench` script)
- `coverage/` (stale `.tmp` files)
- `.gitignore` (potential new entry)

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 1 · Low: 1
- autofix-ready: 1 · needs-decision: 1 · needs-spec: 0

## Findings

- **No bench target for the per-frame pixel-math loop inside `_patchWebglExplicitBackgroundOpacity` / OKLab path** — `_patchWebglExplicitBackgroundOpacity` in `src/client/adapters/xterm.ts:175` monkey-patches the WebGL rectangle renderer's `_updateRectangle` callback. The closure runs for every rectangle on every frame and executes `blendFgTowardCellBg` / `resolveCellBgRgb` at lines 336-393, which call `pushLightness` (sRGB → OKLab → L-reshape → OKLab → sRGB, with 4× `Math.cbrt` + 3× `Math.pow`) and `adjustSaturation` (2× OKLab round-trips) per rectangle. At 60 fps in a large terminal (e.g., 240×50 = 12,000 cells), this is a hot path. There is no `scripts/bench*.ts`, no Makefile `bench` target, no `bun bench` invocation anywhere in the repo.
  - Location: `src/client/adapters/xterm.ts:175` · `src/client/fg-contrast.ts:104` (`pushLightness`) · `src/client/tui-saturation.ts` (`adjustSaturation`)
  - Severity: Medium · Confidence: Plausible · Effort: Medium · Autonomy: needs-decision
  - Cluster hint: `bench-missing`
  - Depends-on: cluster 09-xterm-oklab-dedup (once the OKLab helper is its own module, a micro-bench against that module alone is tractable without pulling in the full WebGL stack)
  - Raised by: Coverage & Profiling Analyst (PROF-1)
  - Notes: Minimum-viable bench: a `scripts/bench-render-math.ts` that builds a synthetic N-cell array, calls `pushLightness` / `adjustSaturation` N times inside a `Bun.nanoseconds()` timed block, prints per-call ns. Add to Makefile as `make bench`. A full WebGL-context bench is larger scope and not required to catch algorithmic regressions in the math itself.

- **Stale Bun-internal coverage `.tmp` files orphaned in `coverage/`** — Multiple `lcov.info.*.tmp` files from prior partial coverage runs are visible in `/src/tmux-web/coverage/`. These are Bun-internal scratch files, not application artifacts.
  - Location: `/src/tmux-web/coverage/`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `stale-artifacts`
  - Fix: Add `coverage/` (or at minimum `coverage/*.tmp`) to `.gitignore`. If any `.tmp` files are tracked (check `git status` first), `git rm --cached coverage/*.tmp`. If `coverage/lcov.info` itself is already untracked, leave it; no action needed.
  - Raised by: Coverage & Profiling Analyst (PROF-2)

## Suggested session approach

Two independent items. The cleanup is 5 minutes — bundle into any other session that touches `.gitignore`. The bench design is the actual work: decide scope (micro-bench against the OKLab helper only, vs a fuller rectangle-renderer bench), pick Bun's built-in bench vs a hand-rolled `Bun.nanoseconds()` loop, and land a baseline. If cluster 09 hasn't landed yet, wait — testing the OKLab math in isolation is easier once it's its own module.

## Commit-message guidance

1. Name the cluster slug and date — e.g., `perf(cluster 16-bench-and-stale-artifacts, 2026-04-21): add bench target for OKLab math + gitignore coverage tmp files`.
2. Note dependency on cluster 09 if that hasn't landed.
3. If only the cleanup ships and the bench is deferred, mark the cluster `in-progress` not `closed`, and capture the deferral in `not-in-scope.md`.
