# Tooling Analyst — analyst-native output

> Preserved for traceability. For fix work, use the clusters under `../clusters/` — they cross-cut these per-analyst sections.

## Summary

Tooling health is strong for a T2 project: every release artifact has a post-package verification script, every third-party Action is SHA-pinned, the vendor xterm patch loop is exhaustively commented and verified at runtime, and dependency freshness is essentially perfect (one patch lag on `@types/bun`). The two recurring shapes are (a) typecheck coverage that excludes the tooling/test surface (the three tsconfigs include only `src/`), and (b) renderer-pluralism residue in dev wrappers and packaging files. Both are mechanical to fix; both are the kind of thing a single-author high-velocity repo accumulates because nothing forces a tree-wide refactor when one file gets renamed.

## Findings

(Findings have been merged into clusters; cluster files carry the verbatim bodies.)

- **CI typecheck skips `tsconfig.electrobun.json`; local `make typecheck` runs all three** — `.github/workflows/release.yml:113` — Severity Medium, Confidence Verified · → see cluster 06-ci-and-release-improvements
- **`scripts/*.ts`, `bun-build.ts`, and `playwright.config.ts` are not covered by any tsconfig** — `tsconfig.json:28`, `tsconfig.client.json:26`, `tsconfig.electrobun.json:8` — Severity Medium, Confidence Verified · → see cluster 06-ci-and-release-improvements
- **`tests/` directory is also not typechecked** — `tsconfig.json:28` — Severity Medium, Confidence Verified · → see cluster 06-ci-and-release-improvements
- **Fuzz tests are excluded from CI; "manual pre-tag" gating is honor-system** — `bunfig.toml:2`, `.github/workflows/release.yml:131` — Severity Medium, Confidence Verified · → see cluster 06-ci-and-release-improvements
- **No HTTP/WS smoke test against the compiled binary in CI** — `.github/workflows/release.yml:141` — Severity Medium, Confidence Verified · → see cluster 05-ci-artifact-verification
- **Stale `dist/client/ghostty.js` marker in `tmux-web-dev` dev wrapper** — `tmux-web-dev:6` — Severity Low, Confidence Verified · → see cluster 07-release-pipeline-hygiene
- **`tmux-web-dev.service` passes a non-existent `--terminal xterm` flag** — `tmux-web-dev.service:8` — Severity Low, Confidence Verified · → see cluster 07-release-pipeline-hygiene
- **`packaging/homebrew/tmux-web.rb` is stale and committed with placeholder SHAs** — `packaging/homebrew/tmux-web.rb:1` — Severity Low, Confidence Verified · → see cluster 07-release-pipeline-hygiene
- **`tmux-web.service` ships without `Environment=TMUX_WEB_PASSWORD=...` placeholder** — `tmux-web.service:11` — Severity Low, Confidence Verified · → see cluster 07-release-pipeline-hygiene
- **`@types/bun` lags by one patch (1.3.12 → 1.3.13)** — `package.json:27` — Severity Low, Confidence Verified · → see cluster 07-release-pipeline-hygiene
- **`make fuzz` doesn't gate on `dist/client/xterm.js`** — `Makefile:68` — Severity Low, Confidence Verified · (informational; below cluster threshold)
- **CI `release.yml` lacks `concurrency:` group** — `.github/workflows/release.yml:1` — Severity Low, Confidence Verified · → see cluster 06-ci-and-release-improvements
- **`act` invocation in AGENTS.md doesn't cover the second-stage build matrix** — `AGENTS.md:30` — Severity Low, Confidence Verified · → see cluster 06-ci-and-release-improvements

## Checklist (owned items)

- TOOL-1 [x] `bun-build.ts:28-154` — vendor-xterm patching load-bearing and well-commented.
- TOOL-2 [x] clean — sampled 8/8 `scripts/`, `bun-build.ts`, `Makefile`; no shell-injection or unsafe spawn patterns.
- TOOL-3 [x] `package.json:27` — see cluster 07-release-pipeline-hygiene.
- TOOL-4 [x] `tsconfig.*` and `tests/` — see cluster 06-ci-and-release-improvements.
- TOOL-5 [x] `Makefile:42-69` — fuzz dep + CI typecheck divergence — see clusters 06 / 07.
- TOOL-6 [x] clean — `bunfig.toml`, `playwright.config.ts`, `electrobun.config.ts` correctly typed; no misconfigurations beyond fuzz-exclusion / e2e-act gap (already filed).
- TOOL-7 [x] `package.json:9-21` — `dev` script `&` background pattern; documented intent per AGENTS.md.
- BUILD-1 [x] `bun-build.ts:28-154` — vendor patching verified; restore-on-finally guarantees clean tree.
- BUILD-2 [x] `Makefile:73-77` — local and CI build flags match.
- BUILD-3 [x] clean — `Makefile:79-85` install target uses POSIX `install -m 755`.
- BUILD-4 [x] `.github/workflows/release.yml:141-142` — `verify-vendor-xterm.ts` is real artifact-level smoke; gap filed under cluster 05.
- GIT-2 [x] `.gitmodules:1-3` — single submodule, HTTPS URL, pinned HEAD; build pipeline tracks `.git/modules/vendor/xterm.js/HEAD` as rebuild trigger.
- GIT-4 [x] `.gitignore:1-26` — covers expected build outputs, repo-specific oddities, generated assets.
- CI-1 [x] `.github/workflows/release.yml:113` — see cluster 06-ci-and-release-improvements.
- CI-2 [x] `.github/workflows/release.yml:1` — see cluster 06-ci-and-release-improvements.
- CI-3 [x] clean — every third-party action SHA-pinned; convention consistent across both workflows.
- CI-4 [x] `.github/workflows/release.yml:131-137` and `bunfig.toml:2` — fuzz exclusion gap, no e2e-via-act gap, no compiled-binary WS smoke — see clusters 05 / 06.
- CI-5 [x] `.github/workflows/release.yml:141-142,174-175` — Bun-side content-level + Electrobun-side structural; gap under cluster 05.
- CONT-1 [-] N/A — container absent
- CONT-2 [-] N/A — container absent
- CONT-4 [-] N/A — container absent
- IAC-1 [-] N/A — iac absent
- IAC-2 [-] N/A — iac absent
- IAC-3 [-] N/A — iac absent
