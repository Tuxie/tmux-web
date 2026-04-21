---
Status: resolved
Resolved-in: df738f6
---

# Cluster 01 — ci-coverage-gate

## TL;DR

- **Goal:** Release CI runs the project's own coverage threshold gate, so a regression below 95% line / 90% function actually blocks a tag push.
- **Impact:** Closes a silent-regression channel. The gate exists and works locally; CI has been bypassing it on every release since the script was added.
- **Size:** Small (<2h)
- **Depends on:** none
- **Severity:** High

## Header

> Session size: Small · Analysts: Coverage & Profiling, Tooling · Depends on: none

## Files touched

- `.github/workflows/release.yml` (1 finding)
- `scripts/check-coverage.ts` (1 finding)

## Severity & autonomy

- Critical: 0 · High: 1 · Medium: 1 · Low: 0
- autofix-ready: 1 · needs-decision: 1 · needs-spec: 0

## Findings

- **Coverage gate absent from release CI — `bun test` runs bare, not `bun run coverage:check`** — The "Run unit tests" step at `release.yml:66` runs `bun test`, which executes tests but does not evaluate the thresholds in `scripts/check-coverage.ts`. The `coverage:check` script (defined in `package.json:16` and wired into `make test-unit` at `Makefile:37-38`) runs `bun test --coverage --coverage-reporter=lcov && bun run scripts/check-coverage.ts`, which enforces 95% line / 90% function thresholds per file. Local `make test-unit` would fail a regression; CI would not.
  - Location: `.github/workflows/release.yml:66`
  - Severity: High · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `coverage-gate-in-ci` (also raised as `ci-hygiene` by Tooling)
  - Fix: Replace `bun test` on line 66 with `bun run coverage:check`. `coverage:check` internally runs `bun test --coverage --coverage-reporter=lcov` and then the script, so no separate test step is needed.
  - Raised by: Coverage & Profiling Analyst (COV-3), Tooling Analyst (F1 — merged; severity took the higher of the two)

- **`check-coverage.ts` permanently excludes `src/client/adapters/xterm.ts` without a tracking issue or review date** — The `EXCLUDES` set at `scripts/check-coverage.ts:13` contains `src/client/adapters/xterm.ts`. The file is currently at 61% funcs / 72% lines per the dynamic coverage pass — well below the 90%/95% thresholds. The inline comment describes the `EXCLUDES` set as "bootstrap / generated / IO-shell wrappers," which does not describe `xterm.ts` (it's the largest application module under `src/client/`). Blanket exclusions without expiry tend to persist indefinitely on solo T2 projects.
  - Location: `scripts/check-coverage.ts:13`
  - Severity: Medium · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `coverage-gate-in-ci`
  - Depends-on: this same cluster (the xterm.ts gap is covered more deeply in cluster 02; fix direction for the exclusion depends on the xterm.ts testing plan there)
  - Raised by: Coverage & Profiling Analyst (COV-3b)
  - Notes: Two alternatives: (a) replace the whole-file exclusion with per-file line overrides once the testable non-WebGL paths are covered, matching the pattern already used for other hard-to-test modules; (b) convert the exclusion into a dated TODO (e.g., `// EXCLUDED until 2026-Q3 — tracked in cluster 02-client-unit-test-coverage`) so future maintainers know when to revisit. Either is defensible.

## Suggested session approach

Mechanical session — not a brainstorm. One commit flips `release.yml:66` from `bun test` to `bun run coverage:check`. Verify locally with `act -j build --matrix name:linux-x64 -P ubuntu-latest=catthehacker/ubuntu:act-latest` before pushing (per CLAUDE.md's release protocol). The `xterm.ts` exclusion is a decision for the cluster 02 session — leave it in place until then, but add a dated comment explaining why.

## Commit-message guidance

When the fix for this cluster lands, the commit message (or PR body) should:

1. Name the cluster slug and date on the first line — e.g., `fix(cluster 01-ci-coverage-gate, 2026-04-21): enforce coverage thresholds on release tags`.
2. If the fix touched code outside the cluster to unblock a verification gate, add an **`Incidental fixes`** section listing each extra file with a one-line reason.
3. No `Depends-on:` chain in play for this cluster.
