---
Status: open
Autonomy: needs-decision
Resolved-in:
Depends-on:
informally-unblocks:
Pre-conditions:
attribution:
Commit-guidance:
model-hint: standard
---

# Cluster 05 — ci-artifact-verification

## TL;DR

- **Goal:** Add a post-package smoke test that exercises the actual `tmux-web` binary users download, plus close the macOS coverage-gating gap.
- **Impact:** Catches release-time regressions that source-mode tests can't see — the v1.8.0 bunfs/embedded-tmux precedent (CHANGELOG.md:63) is a textbook example: four binaries shipped with broken tmux extraction; nobody noticed until users reported it.
- **Size:** Medium (half-day).
- **Depends on:** none
- **Severity:** Medium
- **Autonomy (cluster level):** needs-decision (≥2 reasonable shapes for the smoke test)

## Header

> Session size: Medium · Analysts: Security, Tooling, Test · Depends on: none · Autonomy: needs-decision

## Files touched

- `.github/workflows/release.yml` (3 findings)
- `tests/e2e/tls.test.ts` (1 finding)
- `scripts/verify-vendor-xterm.ts` (existing pattern to extend)
- new test/script for compiled-binary smoke

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 3 · Low: 1
- autofix-ready: 1 · needs-decision: 3 · needs-spec: 0

## Findings

- **CI builds and tests the binary, but no smoke test runs the *packaged tarball*** — The `release.yml` build job typechecks, compiles `tmux-web` with `bun build --compile`, runs `verify-vendor-xterm.ts` against the compiled binary (which catches the documented "vendor xterm regression" sentinel), and runs `bun test` / `coverage:check`. After packaging into `tmux-web-${tag}-${arch}.tar.xz`, no step extracts the tarball and runs the binary. A regression in the `tar -cJf … README.md LICENSE tmux-web` step (e.g. archive omits the binary, packs a stale build tree, mis-permissions the file) would not surface in CI; the user finds it. Coverage gate is also linux-only, so a macOS-only regression in OSC 52 / foreground-process / inotify paths is silently uncovered (documented at `release.yml:127-138`).
  - Location: `.github/workflows/release.yml:144-165`
  - Severity: Medium · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `ci-artifact-verification`
  - Fix: Add a step after `Package release` that extracts the tarball into a temp dir and runs `./tmux-web --version` (mode 0755 + binary-runs check) plus `./tmux-web --help | grep -q '\-\-listen'`. On linux runners only — macOS `verify-vendor-xterm` already runs against the same binary pre-package so the smoke is incremental, not duplicate. Mirrors the existing `verify-vendor-xterm.ts` pattern.
  - Notes: The "CI must test the artifact users receive" pass identifies this gap explicitly. tmux-term Electrobun bundles already have `verify-electrobun-bundle.ts` post-build; tmux-web tarballs deserve the same treatment.
  - Raised by: Security

- **No HTTP/WS smoke test against the compiled binary in CI** — `verify-vendor-xterm.ts` (`release.yml:141-142`) does start the compiled binary and fetches `/dist/client/xterm.js`, which is meaningful artifact-level verification that the vendor xterm bundle is embedded correctly. But it only proves the `xterm.js` static asset path; it does not exercise WS upgrade, Basic Auth, OSC 52, or any of the security-surface code paths that unit tests exercise against source. For T2 with both Bun `--compile` and Electrobun packaging — two distinct compile paths, both prone to embedding/extraction bugs — a tighter post-compile contract test (e.g. `--test --no-auth --no-tls`, fetch `/`, assert HTML body has `#terminal`, open WS, assert `tmux-web` PTY ack frame) would catch a wider class of artifact regressions. CHANGELOG.md:63 documents an exact example: v1.8.0 shipped four binaries that fell back to system tmux at runtime because `fs.copyFileSync` didn't understand bunfs — caught only by adding `verify-vendor-tmux.ts` after the fact. The Electrobun side has `verify-electrobun-bundle.ts` (file-existence and tar-payload checks) but again does not exercise the bundle at runtime.
  - Location: `.github/workflows/release.yml:141`
  - Severity: Medium · Confidence: Verified · Effort: Medium · Autonomy: needs-decision
  - Cluster hint: `ci-artifact-verification`
  - Notes: CI-5 / BUILD-4 surface. The existing `verify-vendor-xterm.ts` is an excellent pattern (start binary, hit endpoint, assert content) — extending it to a 3–5 endpoint smoke test is straightforward but the exact set of assertions is a design choice (≥2 reasonable variants: (a) extend `verify-vendor-xterm.ts` with more fetches, (b) add a small `tests/post-compile/` Playwright run against `127.0.0.1:<port>` started from the compiled binary).
  - Raised by: Tooling

- **TEST-2 / CI-5: e2e `tls.test.ts` exercises a `bun src/server/index.ts` source-mode server, never the compiled `tmux-web` binary** — `tls.test.ts:19` and `tls.test.ts:49` both spawn `bun` against the source. There is no test in `tests/unit/` or `tests/e2e/` that exec's the produced `./tmux-web` binary against any of the same scenarios. The `verify-vendor-xterm.ts` script reads bytes inside the compiled file but does not run it.
  - Location: `tests/e2e/tls.test.ts:19`
  - Location: `tests/e2e/tls.test.ts:49`
  - Severity: Medium · Confidence: Verified · Effort: Medium · Autonomy: needs-decision
  - Cluster hint: `release-pipeline-coverage`
  - Notes: For T2 the right shape is a single Playwright/bun-test that does `make tmux-web` (or relies on a CI prerequisite) and runs `./tmux-web --test --listen 127.0.0.1:NNNN --no-auth --no-tls`, then asserts the same `/api/sessions` round-trip the source-mode tests already cover. AGENTS.md already calls out that the binary's vendor-xterm embed has regressed five times — that's a CI-5 smell on its own.
  - Raised by: Test

- **`scripts/verify-vendor-xterm.ts` runs only on Linux and macOS natively-runnable matrix legs; the `Run unit tests (macOS)` step has no coverage gate** — Tier-aware finding: T2 release artifact verification is documented as load-bearing in `AGENTS.md:7-22` ("regressed at least five times"). The pipeline catches the xterm regression via `verify-vendor-xterm.ts`, but the macOS coverage of file-drop / OSC 52 / foreground-process is reported as "tests still run on macOS; they just don't gate coverage" — i.e. a regression in any of those three modules that only manifests on macOS would ship. The README notes the macOS user runs the binary unsigned; users get the regression first.
  - Location: `.github/workflows/release.yml:127-138`
  - Severity: Low · Confidence: Verified · Effort: Medium · Autonomy: needs-decision
  - Cluster hint: `ci-artifact-verification`
  - Notes: Right-sized: T2 solo-maintainer with explicit pre-tag local `act` workflow already exists. Either add a macOS coverage gate (raises CI minutes) or document the per-OS coverage gap explicitly in `release.yml` so a reader doesn't assume parity. Also see CI-5 for the artifact-extraction smoke gap.
  - Raised by: Security

## Suggested session approach

Two-pass session. (1) The 30-line tarball extract + `--version` + `--help` smoke is autofix-ready and ships independently — start there. (2) The full WS/Basic-Auth/OSC-52 contract test is the design choice — pick one of the variants (extend `verify-vendor-xterm.ts` vs. new `tests/post-compile/`) and dispatch a subagent to implement. The macOS coverage gating choice (gate vs. document) is a separate one-paragraph decision.

The v1.8.0 bunfs precedent (CHANGELOG.md:63) is the single best argument for landing this — the failure mode is real, has happened before, and currently has no automated catch.
