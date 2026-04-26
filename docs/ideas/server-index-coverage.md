# Idea — server/index.ts coverage uplift

> Tracking ticket from `docs/code-analysis/2026-04-26/clusters/20-test-and-coverage-gaps.md` finding 4 (`coverage-broad-exclude`).
> Status: deferred — work not started, just scoped.

## Problem

`src/server/index.ts` reports 112/422 lines covered (26.5%) yet the entire file is in `EXCLUDES` at `scripts/check-coverage.ts:12` ("bootstrap / generated / IO-shell wrappers"). The exclusion is too coarse: substantial pure logic in the file already has tests (`parseConfig`, `parseListenAddr`, `resolveRuntimeBaseDir`, `runServerCleanup`); the remaining ~310 lines of `startServer()` body and helpers contain non-IO logic that the existing harness style can reach.

## Proposed approach (right-sized for T2 solo)

1. Extract three sub-flows from `startServer()` into directly-testable helpers; each becomes a small file with focused tests:
   - `--reset` POST flow (loopback fetch, TLS option construction, response handling) — see also cluster-04 F3 which already pulled `buildResetFetchOptions` out.
   - Password-scrub argv loop (mutating `process.argv` to remove `--password=…`).
   - `tmux -V` probe (version parse + minimum-version gate).
2. Once the sub-flows are factored out, drop `src/server/index.ts` from `EXCLUDES` and let `check-coverage` enforce a per-file floor (e.g., 60%) on whatever remains.
3. Document the residual untestable surface (Bun.serve construction, signal handling glue) so future refactors know what they can leave as-is.

## Out of scope

- Wholesale gate widening. The current EXCLUDES line is correct policy; it's the granularity that's wrong.
- Brittle integration tests that spawn the binary just to drive code paths a unit test could reach.

## Tracking

- Cluster reference: `docs/code-analysis/2026-04-26/clusters/20-test-and-coverage-gaps.md` finding 4.
- Auto-deferred during implement-analysis-report run on 2026-04-26.
- Pick this up after the immediate cluster-20 fixes ship.
