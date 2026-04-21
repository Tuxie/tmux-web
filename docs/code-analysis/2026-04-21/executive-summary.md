# Executive summary

Top 2 clusters selected per `synthesis.md` §7. Only two clusters meet the threshold of "≥1 Critical or High finding + ≥1 Verified or Plausible + spans >1 file or security-sensitive" — this is a real measurement, not an analyst weakness. The rest of the repo's findings are Medium/Low severity, consistent with an actively maintained T2 solo OSS project.

## 01 — ci-coverage-gate

- **Goal:** CI actually enforces the per-file coverage thresholds (95% line / 90% func) that `scripts/check-coverage.ts` defines locally.
- **Files touched:** 2 · **Severity spread:** High: 1, Medium: 1, Low: 0
- **Autonomy mix:** autofix-ready: 1, needs-decision: 1, needs-spec: 0
- **Est. session size:** Small (<2h)
- **Why it's in the summary:** The release workflow runs `bun test` bare on every tag push. The coverage-check script that blocks regressions exists in `package.json` and `Makefile` but is never invoked from CI. A regression that drops coverage below thresholds ships silently. One-line fix plus a follow-on decision about removing the permanent xterm.ts exclusion.
- **Read:** [cluster file](./clusters/01-ci-coverage-gate.md)

## 02 — client-unit-test-coverage

- **Goal:** Close the unit-coverage gap on the five client modules that currently have zero test imports, plus the under-covered xterm adapter.
- **Files touched:** 7+ · **Severity spread:** High: 2, Medium: 0, Low: 2
- **Autonomy mix:** autofix-ready: 2, needs-decision: 2, needs-spec: 0
- **Est. session size:** Large (full day+)
- **Why it's in the summary:** `bun test --coverage` shows `topbar.ts` (1,223 lines), `dropdown.ts` (552 lines), `connection.ts` (69 lines), `drops-panel.ts` (172 lines), `toast.ts` (46 lines) — a combined ~2,062 lines of the core UI — are entirely absent from `coverage/lcov.info`. `src/client/adapters/xterm.ts` sits at 61%/72% and is permanently excluded from the threshold gate without a tracking issue. E2E partially exercises the surface but unit gaps remain. Combined, this is the single largest observable test-coverage deficit in the repo and touches the modules users interact with most.
- **Read:** [cluster file](./clusters/02-client-unit-test-coverage.md)
