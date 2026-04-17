# Cluster 03 — ci-repro-coverage

> **Goal:** Make the release build deterministic and ensure all 4 matrix legs actually run tests + vendor verification.
>
> Session size: Small · Analysts: Tooling · Depends on: none

## Files touched

- `.github/workflows/release.yml` (2 findings)
- `Makefile` (1 finding)

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 2 · Low: 1
- autofix-ready: 3 · needs-decision: 0 · needs-spec: 0

## Findings

- **Bun toolchain pinned to `latest` in CI** — `bun-version: latest` in `setup-bun` means every re-run of the release workflow silently picks up whatever Bun release is current. A Bun patch changing bundler output or runtime semantics produces a different binary without any repo change. `@types/bun: ^1.3.12` in `package.json` records intent but is not enforced at build time.
  - Location: `.github/workflows/release.yml:37`
  - Severity: Medium · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `toolchain-pin`
  - Raised by: Tooling
  - Fix: Replace `bun-version: latest` with the specific version (`1.3.12` as of writing). Commit a `.bun-version` file in the repo root so local dev and CI stay in sync.

- **Unit tests and `verify-vendor-xterm.ts` only run on 2 of 4 matrix legs** — Both steps are gated on `if: matrix.target == 'bun-linux-x64' || matrix.target == 'bun-darwin-arm64'`. The `linux-arm64` and `darwin-x64` binaries ship without unit-test or xterm-sentinel verification. Given CLAUDE.md's explicit load-bearing treatment of the xterm sentinel, this is a silent hole in the release gate.
  - Location: `.github/workflows/release.yml:59`, `.github/workflows/release.yml:63`
  - Severity: Medium · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `ci-coverage`
  - Raised by: Tooling
  - Fix: Remove the `if:` guards on both steps. At minimum, remove it from `verify-vendor-xterm.ts` — the check is fast and has no OS-specific requirement.

- **No typecheck step in `Makefile` or CI** — Neither `make test` nor the CI release workflow runs `tsc --noEmit`. `bun test` type-strips, Playwright runs against a live server. Type errors that do not cause a runtime crash (wrong argument type to a pure function, widened return types) are invisible until they surface as bugs. Both `tsconfig.json` and `tsconfig.client.json` already set `strict: true`, so the cost is only to run the check.
  - Location: `Makefile:35-38`, `.github/workflows/release.yml:58-60`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `dx-typecheck`
  - Raised by: Tooling
  - Fix: Add a `typecheck:` target: `bun x tsc --noEmit -p tsconfig.json && bun x tsc --noEmit -p tsconfig.client.json`. Call it from `make test` (or as a CI step before `bun test`).

## Suggested session approach

Mechanical. Pin Bun, drop the `if:` guards, add the typecheck target. Run `act -j build` locally once to verify the release workflow still passes end-to-end, then commit.
