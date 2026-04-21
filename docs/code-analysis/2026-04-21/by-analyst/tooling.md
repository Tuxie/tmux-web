# Tooling Analyst — analyst-native output

> Preserved for traceability. For fix work, use the clusters under `../clusters/` — they cross-cut these per-analyst sections.

## Summary

Six findings identified, all Medium or Low severity — no Critical or High issues. The most actionable are: the release CI running `bun test` bare instead of `bun run coverage:check` (Medium, autofix-ready — merged with Coverage & Profiling Analyst's COV-3 into cluster 01 at High severity), the absence of E2E tests from the release pipeline (Medium, needs-decision on scope), and the double-fire of the Homebrew tap bump (Medium — remove the inline `homebrew:` job from `release.yml` to eliminate the race). The remaining three (dead Makefile variables, `node` vs `bunx` for Playwright, committed generated file) are low-friction items. No over-engineering was flagged for T2 — the vendor xterm.js build pipeline complexity is fully justified by documented regression history.

## Findings (by cluster)

**→ cluster 01-ci-coverage-gate**
- F1 Coverage threshold gate absent from release CI — Medium / Verified (merged with COV-3 from Coverage Analyst → High at cluster level)

**→ cluster 13-ci-workflow-hygiene**
- F2 E2E tests absent from release CI — Medium / Verified
- F3 Duplicate Homebrew tap bump: inline job + standalone workflow both fire — Medium / Verified
- F4 Dead `PLATFORM`/`ARCH` Makefile shell expansions — Low / Verified
- F5 `node node_modules/.bin/playwright` vs `bunx` — Low / Verified
- F6 `assets-embedded.ts` committed generated file without `.gitignore` entry — Low / Verified

## Checklist (owned items)

- TOOL-1 [x] clean — single toolchain (bun + tsc). No pnpm/npm/vitest.
- TOOL-2 [x] (1 instance) `node node_modules/.bin/playwright` vs `bunx` → cluster 13.
- TOOL-3 [x] clean — Bun 1.3.12 pinned in `.bun-version`, `setup-bun`, `@types/bun` aligned. TypeScript `^5.8.0`, Playwright `^1.59.1` current.
- TOOL-4 [x] clean — bun-build.ts complexity is load-bearing (vendor patching), not over-engineering.
- TOOL-5 [x] clean — typecheck step present; coverage gate exists locally.
- TOOL-6 [x] (2 instances) → clusters 01 + 13 (coverage not in CI; E2E not in CI; Homebrew race).
- TOOL-7 [x] (1 instance) Homebrew double-fire → cluster 13.
- BUILD-1 [x] clean — `bun.lock` committed, `--frozen-lockfile` in CI.
- BUILD-2 [x] clean — no lockfile drift detected.
- BUILD-3 [x] clean — `.bun-version: 1.3.12`, `setup-bun` and `@types/bun` aligned.
- GIT-2 [x] clean — theme `.woff2` fonts are intentional embedded assets for the release binary (`.gitignore` has `fonts/**; !fonts/*.woff2` pattern showing deliberate choice).
- GIT-4 [x] (1 instance) `src/server/assets-embedded.ts` → cluster 13. Standard outputs (`dist/`, `tmux-web`, `tmp/`, `coverage/`, `playwright-report/`) correctly ignored.
- CI-1 [x] clean — all 5 action references use commit SHA + version comment (joint with Security).
- CI-2 [x] clean — top-level permissions not set; per-job scoping correct (`contents: read` for builds, `contents: write` only for release job).
- CI-3 [x] clean — no `pull_request` trigger; tag-push only.
- CI-4 [-] N/A — no self-hosted runner.
- CONT-1, CONT-2, CONT-4 [-] N/A — no container.
- IAC-1..3 [-] N/A — no IaC.
