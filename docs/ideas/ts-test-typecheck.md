# Idea — typecheck the tests/** tree

> Tracking doc for the residue of cluster 06 F2/F3 (`docs/code-analysis/2026-04-26/clusters/06-ci-and-release-improvements.md`).
> Status: deferred. Scope captured here so future runs don't re-surface it as a fresh finding.

## Problem

`tsconfig.tooling.json` now typechecks `scripts/**`, `bun-build.ts`, `playwright.config.ts` — wired into both `make typecheck` and `release.yml`'s Typecheck step (post-commit `4ea6999` follow-up). The `tests/**` tree is intentionally **excluded** because the original cluster-06 ballpark surfaced ~62 errors when tests were included, of which ~18 cluster in a single file (`tests/unit/client/xterm-adapter.test.ts`) where the in-test xterm.js fakes have drifted from the current type surface.

`bun test` and `playwright test` execute the test files via Bun's transformer, so behavioural correctness is covered — the gap is only static-typecheck-time discovery. A test file with a stale type signature (e.g., a property renamed in `xterm.js` that the test mock didn't update) still passes in `make test-unit` because Bun erases types before running.

## Proposed approach

1. **Drive `tests/unit/client/xterm-adapter.test.ts` to zero errors first.** The fakes need to track current `@xterm/xterm` types. Likely means importing the real types and using `Partial<>` or `Pick<>` rather than re-declaring the shape. ~18 errors to fix here, mostly TS2345 / TS2554.
2. **After xterm-adapter is clean,** widen `tsconfig.tooling.json`'s include to add `tests/**/*.ts` and re-ballpark. Expect <20 errors remaining (the original 62 minus the ~18 above + any re-derived from the wider net).
3. **Drive the residue to zero,** wire `tests/**` into the gate (already wired for `scripts/**`).

## Out of scope

- Changing test runtime behaviour. This is a pure static-typing exercise.
- Trying to typecheck fuzz tests under stricter rules — `tests/fuzz/` runs only manually pre-tag and isn't on the `make typecheck` critical path.

## Tracking

- Cluster reference: cluster 06 F2/F3 (closed at follow-up commit; this residue split off into its own track).
- Don't conflate with cluster 20's `tests/unit/desktop/` work — that cluster's deferred re-attempt is separate (subagent budget exhaustion, not type-drift).

## Decision history

- 2026-04-26: option (c) picked for cluster 06's deferred-cleanup pass — scope tooling.json to non-test surfaces, leave tests/** for follow-up. Idea doc spawned to track.
