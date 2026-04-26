---
Status: partial
Autonomy: needs-decision
Resolved-in: 5752a225fd667d0272257d61510447432f927dc4 (partial — F2/F3 widened-typecheck scaffolded as tsconfig.tooling.json with 62 surfaced errors > 20-error threshold; not wired into make typecheck or release.yml. F1, F4, F5, F6 fully landed.)
Depends-on:
informally-unblocks:
Pre-conditions:
- src/desktop/index.ts: typecheck currently green; widening CI to include tsconfig.electrobun.json should not surface new errors but ballpark before flipping
- scripts/**, bun-build.ts, tests/**: typecheck not currently run; widening will surface unknown error count — see Surfaced-errors lines on individual findings
attribution:
Commit-guidance: gate-widening findings (typecheck coverage) carry unknown surfaced-error counts; the fix coordinator must ballpark before declaring autofix-ready
model-hint: standard
---

# Cluster 06 — ci-and-release-improvements

## TL;DR

- **Goal:** Bring CI's typecheck and fuzz/e2e gating closer to local `make` parity, plus add a workflow `concurrency:` group to prevent racing tag pushes.
- **Impact:** Closes the gap where local `make typecheck` runs three tsconfigs but CI runs two; closes the honor-system fuzz-gate; eliminates a tag-push race for the homebrew-tap bump.
- **Size:** Medium (half-day; depends how many surfaced-errors come out of widening typecheck to scripts/tests).
- **Depends on:** none
- **Severity:** Medium
- **Autonomy (cluster level):** needs-decision

## Header

> Session size: Medium · Analysts: Tooling · Depends on: none · Autonomy: needs-decision

## Files touched

- `.github/workflows/release.yml` (3 findings)
- `tsconfig.json` (1 finding) and possibly new `tsconfig.tooling.json`
- `bunfig.toml` (1 finding via fuzz-gate decision)
- `AGENTS.md` (1 finding — pre-release-verification doc)

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 5 · Low: 1
- autofix-ready: 1 · needs-decision: 5 · needs-spec: 0

## Findings

- **CI typecheck skips `tsconfig.electrobun.json`; local `make typecheck` runs all three** — `Makefile:47-50` typechecks server, client, AND electrobun configs, but `release.yml:113-117` only typechecks `tsconfig.json` and `tsconfig.client.json`. The desktop wrapper (`src/desktop/`, `electrobun.config.ts`) is part of every release leg's `bun run desktop:stable` step (`release.yml:171`), and the electrobun typecheck has caught real issues historically (the project ships a dedicated `tsconfig.electrobun.json`). A type error introduced in `electrobun.config.ts` or `src/desktop/electrobun-types.d.ts` will pass CI and only break at desktop-build time.
  - Location: `.github/workflows/release.yml:113`
  - Severity: Medium · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `ci-typecheck-coverage`
  - Fix: Add `bun x tsc --noEmit -p tsconfig.electrobun.json` as a third line under the existing `Typecheck` step in `release.yml`, mirroring `Makefile:50`.
  - Raised by: Tooling

- **`scripts/*.ts`, `bun-build.ts`, and `playwright.config.ts` are not covered by any tsconfig** — None of the three `tsconfig*.json` `include` patterns reach `scripts/`, `bun-build.ts`, or `playwright.config.ts`. These are load-bearing release-pipeline files: `bun-build.ts` patches the vendor/xterm tree, `scripts/verify-vendor-xterm.ts` is the post-compile artifact gate, `scripts/generate-assets.ts` produces the embed manifest. A type error in any of them would not be caught by `make typecheck` and would only manifest at runtime during `make build` / `make tmux-web` / CI. Adding a fourth `tsconfig.tooling.json` (or extending `tsconfig.json`'s include) is a one-shot widening with manageable cleanup cost given how few files we're talking about (≤10).
  - Location: `tsconfig.json:28`, `tsconfig.client.json:26`, `tsconfig.electrobun.json:8`
  - Severity: Medium · Confidence: Verified · Effort: Medium · Autonomy: needs-decision
  - Cluster hint: `ci-typecheck-coverage`
  - Surfaced-errors: widened-check not run; error count unknown at report time — fix coordinator must ballpark before proceeding.
  - Notes: needs-decision because there are ≥2 reasonable layouts (extend `tsconfig.json` include vs. add a new `tsconfig.tooling.json` so `noEmit`/`rootDir` semantics stay clean for the existing three projects). Both are valid.
  - Raised by: Tooling

- **`tests/` directory is also not typechecked** — Same root cause: `tests/unit/`, `tests/e2e/`, `tests/fuzz/` (147 files per the codebase map) are out of every `tsconfig*.json` include set. `bun test` and `playwright test` execute TypeScript via Bun's transformer, so a type bug in a test file lives undiscovered until that test runs (or — for fuzz — until someone runs `make fuzz` manually pre-release). Project tier T2 with property/fuzz tests excluded from CI makes this more acute: a fuzz file with a stale type signature won't be caught by `make typecheck`, won't be caught by CI, and won't be caught until the manual pre-release pass.
  - Location: `tsconfig.json:28`
  - Severity: Medium · Confidence: Verified · Effort: Medium · Autonomy: needs-decision
  - Cluster hint: `ci-typecheck-coverage`
  - Surfaced-errors: widened-check not run; error count unknown at report time — fix coordinator must ballpark before proceeding (147 test files; expect non-trivial cleanup if existing tests rely on lax types). If `Surfaced-errors > 20`, `Effort` upgrades to `Large` and `Autonomy` cannot be `autofix-ready` per ground rules.
  - Notes: Effort downgraded to Medium pending the actual count; if `Surfaced-errors > 20` the contract requires upgrading to Large.
  - Raised by: Tooling

- **Fuzz tests are excluded from CI; "manual pre-tag" gating is honor-system** — `bunfig.toml:2` pins `root = "tests/unit"`, deliberately excluding `tests/fuzz/` from the `bun test` path that CI runs (`release.yml:132-137`). AGENTS.md:38-51 documents `make fuzz` as a manual pre-tag step covering nine security-sensitive parsers. For a T2 project with 36 release tags and an explicit security surface, gating these on solo-maintainer discipline is fragile — one rushed tag and a regression in a security-sensitive parser ships unobserved. The trade-off (per-release time cost of fuzz) is real; the mitigation is lightweight.
  - Location: `bunfig.toml:2`
  - Location: `.github/workflows/release.yml:131`
  - Severity: Medium · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `ci-fuzz-gate`
  - Notes: needs-decision because the fuzz-cost tradeoff is documented explicitly in AGENTS.md:46-51 — adding a `make fuzz` step to the `e2e` job (it already runs once on linux only) would catch regressions but lengthens the release path. Alternative: a separate scheduled (cron) workflow that runs fuzz nightly against `main`, decoupling it from the release tag.
  - Raised by: Tooling

- **CI `release.yml` lacks `concurrency:` group** — A second tag pushed before the prior tag's release finishes will run a parallel matrix, potentially racing on `softprops/action-gh-release` (creating duplicate releases on the same tag is fine — the action is idempotent — but the homebrew-tap bump can race). For a solo-maintainer T2 project this is unlikely to bite, but `concurrency: { group: ${{ github.ref }}, cancel-in-progress: false }` is a one-line guard.
  - Location: `.github/workflows/release.yml:1`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `ci-workflow-ergonomics`
  - Fix: Add at top level (after `on:` block):
    ```
    concurrency:
      group: release-${{ github.ref }}
      cancel-in-progress: false
    ```
  - Raised by: Tooling

- **`act` invocation in AGENTS.md doesn't cover the second-stage build matrix** — AGENTS.md:30-32 documents `act -j build --matrix name:linux-x64 ...`, which validates one of four release legs. The fuzz step is also documented separately. But the `e2e` job (which gates the build) is not part of the documented `act` invocation, and Playwright requires browser install (`release.yml:48-49 bunx playwright install --with-deps chromium`). The pre-release verification surface advertised is partial; a regression that only manifests in the Playwright run will pass `act` and only fail when the tag is pushed. Per the ground rules' artifact verification pass: "act" is the project's documented gate; if it doesn't include the actual e2e run that gates `build`, the gate is incomplete.
  - Location: `AGENTS.md:30`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `pre-release-verification`
  - Notes: needs-decision because Playwright under `act` is its own deployment headache (browser cache, container resources). Two reasonable paths: (a) document `act -j e2e` invocation alongside `act -j build`, or (b) accept the gap and document it as such ("e2e validation is provided by GitHub-side CI, not act").
  - Raised by: Tooling

## Suggested session approach

Two pieces of mechanical work and three decisions. Land the two autofix-ready findings (electrobun typecheck added to CI, concurrency group added to release.yml) as a small commit before the larger interview pass. Then a 30-minute interview to decide:

1. New `tsconfig.tooling.json` vs. extending `tsconfig.json` include (and ballpark surfaced-errors for tests/scripts) — see Pre-conditions in frontmatter.
2. CI fuzz gate (in-workflow vs. scheduled-nightly).
3. AGENTS.md `act` doc update vs. accept-the-gap.

After decisions land, dispatch a subagent to apply.

The `Surfaced-errors:` line is the load-bearing constraint: until someone runs `bun x tsc --noEmit -p <new-config>` mentally or via dry-run on the candidate widened scope, the cluster cannot be `autofix-ready` per the ground rules' "Gate-widening findings must ballpark the surfaced-error count" rule. If >20 errors surface, `Effort` upgrades to Large and the cleanup decisions become per-error.
