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

# Cluster 06 — ci-and-build-artifact-verification

## TL;DR

- **Goal:** Make CI exercise the actual artifact users receive on every release leg, and stop `bun-build.ts` from silently shipping a stale client bundle when the build fails.
- **Impact:** A regression in the macOS packaged tarball (extraction permissions, layout, dyld dependencies) no longer ships unnoticed; a TypeScript error in the client never silently embeds the previous bundle into the release binary; the `tmux-term` Linux structural-only verify gains a runtime-smoke option.
- **Size:** Medium (half-day).
- **Depends on:** none.
- **Severity:** Medium (`bun-build.ts` warm-cache silent success; macOS post-package smoke gap); Low (`tmux-term` structural-only smoke).
- **Autonomy (cluster level):** needs-decision — the macOS smoke is straightforward (`--version`/`--help` on the packaged tarball); the `tmux-term` runtime smoke involves headless GUI launch decisions; the `bun-build.ts` fix is autofix.

## Header

> Session size: Medium · Analysts: Security, Tooling · Depends on: none · Autonomy: needs-decision

## Files touched

- `bun-build.ts` (1)
- `.github/workflows/release.yml` (multiple — macOS legs)
- `scripts/verify-electrobun-bundle.ts` (potentially extended)

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 2 · Low: 1
- autofix-ready: 1 · needs-decision: 2 · needs-spec: 0

## Findings

- **`bun-build.ts:216` silently exits 0 when client build fails on a warm `dist/` directory** — When `Bun.build()` returns `result.success = false`, the code logs the error but neither throws nor calls `process.exit(1)`. Execution proceeds to `fs.appendFileSync("dist/client/xterm.js", marker)` on line 232. Fresh-checkout CI is saved by `ENOENT` (output file does not yet exist); on a developer machine or a CI leg restarted with a warm `dist/` directory, `appendFileSync` appends the new sentinel to the previous successful build's xterm.js, `bun-build.ts` exits 0, `generate-assets.ts` embeds the stale bundle, and `verify-vendor-xterm.ts` passes (the sentinel is present). The stale client code compiles into the release binary with no warning.
  - Location: `bun-build.ts:216`
  - Severity: Medium · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `build-pipeline`
  - Fix: Replace `if (!result.success) { console.error(...) }` with `if (!result.success) { console.error(...); process.exit(1); }`.
  - Raised by: Tooling Analyst
  - Notes: Enshrined-test check: no test files reference `result.success` in `bun-build.ts`; autofix-ready stands.

- **CI artifact verification covers Linux only; macOS legs ship without packaged-binary smoke** — Release workflow runs `verify-vendor-xterm.ts` on every leg and post-package smoke (`tmux-web --version`, `--help | grep --listen`, `tests/post-compile/`) on Linux only (`if: runner.os == 'Linux'`). macOS legs verify the pre-package binary embeds vendor-xterm but never run the packaged tarball. Any macOS-specific tarball-extraction permission or layout regression ships.
  - Location: `.github/workflows/release.yml:199`
  - Severity: Medium · Confidence: Verified · Effort: Medium · Autonomy: needs-decision
  - Cluster hint: `ci-artifact-verification`
  - Raised by: Security Analyst (joint with Tooling for CI-5 / BUILD-4)
  - Notes: T1 calibration anchor: "CI tests source code but releases an untested packaged artifact" → Medium. The Linux gate is good and extends easily — `--version`/`--help` smoke on the packaged macOS tarball is one `if: runner.os == 'macOS'` block. Doesn't need full `tests/post-compile/` (those have Linux-specific paths). Decision: minimum smoke (`--version`+`--help` on extracted tarball) vs. full contract suite ported to macOS.

- **`tmux-term` Linux CI verifies bundle structure only; no runtime smoke of the packaged desktop app** — `scripts/verify-electrobun-bundle.ts` checks that the compiled `tmux-web` binary and the Electrobun app entrypoint exist with correct permissions, and (when a `tar.zst` payload is present) that the paths are in the member list. Does not launch the app or exercise the server-start path. A regression in Electrobun IPC, `server-process.ts` child-spawn logic, or the `tmux-web` binary's embedded assets passes this check and ships.
  - Location: `.github/workflows/release.yml:242`
  - Location: `scripts/verify-electrobun-bundle.ts:1`
  - Severity: Low · Confidence: Verified · Effort: Medium · Autonomy: needs-decision
  - Cluster hint: `artifact-smoke`
  - Raised by: Tooling Analyst
  - Notes: `tmux-web` binary itself has comprehensive Linux post-package smoke (tarball extract + `--version`/`--help` + API contract). Gap is the Electrobun wrapper layer. macOS `tmux-term` is intentionally skipped pending Apple Developer cert signing (documented in `release.yml:237`). Decision: headless Xvfb smoke (Linux) vs accepting structural-only verification at T1.

## Suggested session approach

Ship the `bun-build.ts` `process.exit(1)` fix immediately as a standalone PR — autofix, mechanical, prevents future stale-bundle ships. Then a separate PR for the macOS post-package smoke (`--version` + `--help` on the extracted tarball, Linux-equivalent minimum); recommend the minimum form rather than porting the full `tests/post-compile/` suite. The `tmux-term` runtime smoke is a polish item — defer or do it in a third PR with explicit Xvfb setup; either is acceptable at T1.
