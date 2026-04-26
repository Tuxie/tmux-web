# Idea — populate `tests/unit/build/` with bun-build.ts coverage

> Tracking ticket from `docs/code-analysis/2026-04-26/clusters/20-test-and-coverage-gaps.md` finding 5 (`release-pipeline-coverage`).
> Status: deferred — directory is currently empty; this scopes the first test design.

## Problem

`bun-build.ts` is the load-bearing client bundler that AGENTS.md flags as "regressed at least five times." `scripts/verify-vendor-xterm.ts` runs post-compile in CI but a regression that bundles the npm `@xterm/xterm@6.0.0` instead of the vendor submodule only fails at the end of the release workflow, never during fast unit feedback. The directory `tests/unit/build/` exists but is empty — adding the first test is its own session because the fixture surface (vendor submodule, sentinel marker) is non-trivial.

## Proposed first tests

1. **Sentinel marker round-trip.** Run `bun-build.ts` against a fixture vendor tree; assert the produced `dist/client/xterm.js` ends with `tmux-web: vendor xterm.js rev <SHA>` and that the SHA matches the fixture's pinned commit.
2. **Vendor-tree absence throws.** Stub out `vendor/xterm.js` (or point `bun-build.ts` at a temp dir lacking the submodule); assert the build fails with a clear error rather than silently picking up `node_modules/@xterm/xterm`.
3. **Module-shape exports.** Import `bun-build.ts` and assert the exported helpers (entry point, vendor-rev resolver if exported, sentinel constant) match expected shapes — guards against accidental rename / removal during refactors.

## Coordination with cluster-16 sentinel sidecar

Cluster 16 introduced `dist/client/xterm-version.json` as the runtime-readable form of the sentinel. The build-side test should assert both representations (bundle suffix sentinel + JSON sidecar) are produced and agree on the SHA.

## Out of scope

- Replacing `scripts/verify-vendor-xterm.ts`; it stays as the post-compile artifact gate.
- Asserting on bundle byte size or asset embedding (those are coverage by inspection rather than tests).

## Tracking

- Cluster reference: `docs/code-analysis/2026-04-26/clusters/20-test-and-coverage-gaps.md` finding 5.
- Auto-deferred during implement-analysis-report run on 2026-04-26.
