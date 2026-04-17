# Tooling — analyst-native output

> Preserved for traceability. For fix work use the clusters under `../clusters/`.

## Summary

Six findings across three clusters. The most impactful are **CI-1** (all Actions on mutable tags — supply-chain risk for a binary distributed via Homebrew) and **BUILD-3** / **TOOL-6** (non-reproducible builds: `latest` Bun + 2 of 4 release matrix legs silently skipping tests and the vendor-xterm sentinel). These are all low-effort fixes. The missing typecheck (TOOL-5) is a code quality gap that is easy to close given that both tsconfigs already have `strict: true`. No over-engineering, no GIT-2 issue (binary is correctly excluded), and the xterm vendor strategy is sound and should not be touched.

## Findings

- **All third-party Actions pinned to mutable tags, not commit SHAs** — `.github/workflows/release.yml:30,35,84,100,103,130`, `.github/workflows/bump-homebrew-tap.yml:60` · Medium/Verified · Cluster hint: `ci-supply-chain` · → see cluster 02-ci-supply-chain
- **`build` job has no explicit `permissions` block** — `.github/workflows/release.yml:8-93` · Low/Verified · Cluster hint: `ci-permissions` · → see cluster 02-ci-supply-chain
- **`bump` job in `bump-homebrew-tap.yml` has no `permissions` block** — `.github/workflows/bump-homebrew-tap.yml:23` · Low/Verified · Cluster hint: `ci-permissions` · → see cluster 02-ci-supply-chain
- **Bun toolchain pinned to `latest` in CI** — `.github/workflows/release.yml:37` · Medium/Verified · Cluster hint: `toolchain-pin` · → see cluster 03-ci-repro-coverage
- **No typecheck step in Makefile or CI** — `Makefile:35-38`, `.github/workflows/release.yml:58-60` · Low/Verified · Cluster hint: `dx-typecheck` · → see cluster 03-ci-repro-coverage
- **Unit tests and vendor verification only run on 2 of 4 matrix legs** — `.github/workflows/release.yml:59,63` · Medium/Verified · Cluster hint: `ci-coverage` · → see cluster 03-ci-repro-coverage
- **No `bun install --frozen-lockfile` in CI** — `.github/workflows/release.yml:40` · Low/Verified · Cluster hint: `ci-reproducibility` · → see cluster 02-ci-supply-chain

## Checklist (owned items)

- `TOOL-1 [x] clean — no redundant tooling observed`
- `TOOL-2 [x] clean — Bun-native patterns used correctly throughout`
- `TOOL-3 [x] clean — no obviously outdated tool; @types/bun tracks 1.3.12`
- `TOOL-4 [x] clean — custom bun-build.ts is justified by vendor-xterm strategy (CLAUDE.md load-bearing)`
- `TOOL-5 [x] Makefile:35-38, release.yml:58-60 — no tsc --noEmit typecheck step`
- `TOOL-6 [x] release.yml:59,63,40 — unit tests/vendor-verify skip 2 of 4 matrix legs; no --frozen-lockfile`
- `TOOL-7 [x] clean — no workflow logic errors found`
- `BUILD-1 [x] clean — bun.lock is tracked`
- `BUILD-2 [x] clean — bun.lock workspace section matches package.json`
- `BUILD-3 [x] release.yml:37 — bun-version: latest`
- `GIT-2 [x] clean — tmux-web binary is .gitignore'd and not tracked (.gitignore:3)`
- `GIT-4 [x] clean — .gitignore covers node_modules, dist, tmp, test artifacts, editor swap`
- `CI-1 [x] release.yml + bump-homebrew-tap.yml — Actions pinned to tags → cluster 02`
- `CI-2 [x] release.yml, bump-homebrew-tap.yml — missing permissions blocks → cluster 02`
- `CI-3 [x] clean — neither workflow triggers on pull_request`
- `CI-4 [-] N/A — no self-hosted runners`
- `CONT-* [-] N/A — no Dockerfile`
- `IAC-* [-] N/A — no iac`
