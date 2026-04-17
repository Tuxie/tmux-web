# Cluster 02 — ci-supply-chain

> **Goal:** Harden the release workflow against action-tag hijack and token over-scoping.
>
> Session size: Small · Analysts: Security, Tooling · Depends on: none

## Files touched

- `.github/workflows/release.yml` (2 findings)
- `.github/workflows/bump-homebrew-tap.yml` (2 findings)

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 1 · Low: 2
- autofix-ready: 3 · needs-decision: 0 · needs-spec: 0

## Findings

- **Third-party Actions pinned to floating tags, not commit SHAs** — Every Action reference uses a mutable tag (`@v6`, `@v2`, `@v7`, `@v8`, `@v3`). A hijacked or force-pushed tag runs arbitrary code in the release job (which has `contents: write`) and in the homebrew-bump job (which holds `HOMEBREW_TAP_TOKEN`). `softprops/action-gh-release` is third-party and the highest-risk of the set.
  - Location: `.github/workflows/release.yml:30`, `.github/workflows/release.yml:35`, `.github/workflows/release.yml:84`, `.github/workflows/release.yml:100`, `.github/workflows/release.yml:103`, `.github/workflows/release.yml:130`, `.github/workflows/bump-homebrew-tap.yml:60`
  - Severity: Medium · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `ci-action-pin`
  - Raised by: Security, Tooling
  - Fix: Replace each tag with its current commit SHA (resolve via `gh api repos/<owner>/<repo>/git/refs/tags/<tag>`), leaving `# vX.Y.Z` as a trailing comment for humans. Actions: `actions/checkout`, `oven-sh/setup-bun`, `actions/upload-artifact`, `actions/download-artifact`, `softprops/action-gh-release`.

- **`build` job has no explicit `permissions` block** — The `release` job correctly narrows to `contents: write`, but the 4 `build` matrix jobs have no `permissions:` key and inherit the repo default, which is often broader than needed.
  - Location: `.github/workflows/release.yml:8-91`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `ci-permissions`
  - Raised by: Security, Tooling
  - Fix: Add `permissions: contents: read` to the `build` job (it only reads source and uploads artifacts).

- **`bump` job in `bump-homebrew-tap.yml` has no `permissions` block** — Same pattern: the job reads this repo's release assets and pushes to an external tap via a PAT. No `permissions:` declaration means repo-default scope on `GITHUB_TOKEN`.
  - Location: `.github/workflows/bump-homebrew-tap.yml:23`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `ci-permissions`
  - Raised by: Security, Tooling
  - Fix: Add `permissions: contents: read`. The PAT does the external write; `GITHUB_TOKEN` does not need write on this repo.

- **No `--frozen-lockfile` on `bun install` in CI** — If `bun.lock` drifts from `package.json` (e.g. after a manual `bun add`), CI silently updates the lockfile and builds with different resolved versions than what is committed.
  - Location: `.github/workflows/release.yml:40`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `ci-reproducibility`
  - Raised by: Tooling
  - Fix: `bun install --frozen-lockfile`.

## Suggested session approach

Mechanical. Resolve the 6 Action SHAs, add two `permissions:` blocks, add `--frozen-lockfile`, run `act -j build` locally per CLAUDE.md, push. No design tradeoff; subagent dispatch is appropriate here over brainstorming.
