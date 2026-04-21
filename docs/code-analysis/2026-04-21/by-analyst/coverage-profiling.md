# Coverage & Profiling Analyst — analyst-native output

> Preserved for traceability. For fix work, use the clusters under `../clusters/` — they cross-cut these per-analyst sections.

## Summary

The dynamic pass ran (`bun test --coverage` from `/src/tmux-web`, one invocation, 587 tests passing, 0 failures). The two dominant gaps are: (1) five entire client-side modules — `topbar.ts`, `dropdown.ts`, `connection.ts`, `drops-panel.ts`, `toast.ts` (2,062 lines combined) — are completely absent from the coverage report because no unit test imports them, and `xterm.ts` (the core WebGL adapter) sits at 61%/72% and is permanently excluded from the threshold gate; and (2) the coverage gate itself (`bun run coverage:check`) is never invoked in `release.yml` — CI runs bare `bun test` — so the 95% per-file thresholds enforced locally are invisible to every tag-triggered release build.

## Findings (by cluster)

**→ cluster 01-ci-coverage-gate**
- COV-3 Coverage gate (`bun run coverage:check`) not invoked in `release.yml` — High / Verified (merged with Tooling's F1)
- COV-3b `check-coverage.ts` permanently excludes `src/client/adapters/xterm.ts` without tracking issue or review date — Medium / Verified

**→ cluster 02-client-unit-test-coverage**
- COV-1a Five client modules entirely absent from coverage report (0% lcov by omission) — High / Verified
- COV-1b `src/client/adapters/xterm.ts` at 61%/72% — below thresholds — High / Verified
- COV-2 `clampFgContrastStrength` (exported public API from `fg-contrast.ts`) has no test coverage — Low / Verified
- COV-2b `/api/terminal-versions` and `POST /api/exit` HTTP routes have no unit-test exercise — Low / Verified

**→ cluster 16-bench-and-stale-artifacts**
- PROF-1 No bench target for the per-frame pixel-math loop inside `_patchWebglExplicitBackgroundOpacity` / OKLab path — Medium / Plausible
- PROF-2 Stale Bun-internal coverage `.tmp` files orphaned in `coverage/` — Low / Verified

## Checklist (owned items)

- COV-1 [x] (2 findings) 5 client modules absent from lcov entirely; xterm.ts at 72% lines → cluster 02
- COV-2 [x] (2 findings) `clampFgContrastStrength` untested; `/api/terminal-versions` + `POST /api/exit` not exercised → cluster 02
- COV-3 [x] (2 findings) CI runs `bun test` bare not `coverage:check`; xterm.ts permanently excluded → cluster 01
- PROF-1 [x] (1 finding) WebGL per-frame OKLab math loop has no bench → cluster 16
- PROF-2 [x] (1 finding) Bun-internal `.tmp` coverage artifacts in `coverage/` → cluster 16. No `.prof` or flamegraph files in repo.
