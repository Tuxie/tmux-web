# Tests — analyst-native output

> Preserved for traceability. For fix work use the clusters under `../clusters/`.

## Summary

The test suite is in good shape for a T2 project: unit coverage of the pure-function server modules (protocol, allowlist, hash, clipboard-policy, file-drop, sessions-store, shell-quote) is thorough, and the E2E layer gives meaningful smoke coverage of all major UI flows. The most impactful gap is the shared import of `vitest` across eight unit files: although Bun 1.3.x currently provides a compatibility shim, this is an undeclared dependency that could silently break on a Bun upgrade, and a one-line fix per file eliminates the risk entirely. Two user-visible feature flows — file-drop/paste injection and the OSC 52 clipboard-read consent dialog — have no E2E test at all despite being security-relevant, making them the primary candidates for new test investment.

## Findings

- **8 unit test files import from `'vitest'` with no vitest in `package.json`** — `tests/unit/server/protocol.test.ts:1`, `tests/unit/server/pty.test.ts:1`, `tests/unit/server/tls.test.ts:1`, `tests/unit/server/allowlist.test.ts:1`, `tests/unit/client/protocol.test.ts:1`, `tests/unit/client/ui/clipboard.test.ts:1`, `tests/unit/client/ui/mouse.test.ts:1`, `tests/unit/client/adapters/xterm.test.ts:1` · Medium/Verified · Cluster hint: `test-framework-hygiene` · → see cluster 06-test-coverage-framework
- **File-drop / clipboard-paste upload pipeline has no E2E test** — `tests/e2e/` (absent) · Medium/Verified · Cluster hint: `e2e-file-drop` · → see cluster 06-test-coverage-framework
- **OSC 52 clipboard-read consent flow has no E2E test** — `tests/e2e/` (absent), `src/client/ui/clipboard-prompt.ts` · Medium/Verified · Cluster hint: `e2e-osc52-consent` · → see cluster 06-test-coverage-framework
- **OSC 52 base64 write path has no size bound and no property test** — `src/server/protocol.ts:24`, `src/client/ui/clipboard.ts` · Medium/Plausible · Cluster hint: `fuzz-osc52` · → see cluster 09-fuzz-parsers
- **TOML colour parser unfuzzed for adversarial input** — `tests/unit/server/colours.test.ts`, `src/server/colours.ts:8` · Low/Plausible · Cluster hint: `fuzz-colour-toml` · → see cluster 09-fuzz-parsers
- **Two topbar tests use `waitForTimeout(1500)` for auto-hide** — `tests/e2e/topbar.test.ts:16,22` · Low/Verified · Cluster hint: `e2e-timing` · → see cluster 06-test-coverage-framework
- **Hard-coded port registry risks collision under Playwright parallel** — `tests/e2e/font-selection.test.ts:8`, `tests/e2e/menu-settings-open.test.ts:7`, `tests/e2e/terminal-selection.test.ts:49`, `tests/e2e/tls.test.ts:18` · Low/Plausible · Cluster hint: `e2e-port-collision` · → see cluster 06-test-coverage-framework
- **`sanitizeSession` dot+slash interaction edge case untested** — `tests/unit/server/pty.test.ts:9` · Low/Plausible · Cluster hint: `unit-pty-sanitize` · → see cluster 06-test-coverage-framework

## Checklist (owned items)

- `TEST-1 [x] clean — all test names accurately reflect what is tested`
- `TEST-2 [x] clean — no vague test names observed across tests/unit and tests/e2e`
- `TEST-3 [x] tests/unit/server/pty.test.ts:9 — sanitizeSession dot+slash edge untested`
- `TEST-4 [x] missing file-drop E2E; missing OSC 52 consent E2E`
- `TEST-5 [x] clean — no redundant test clusters observed`
- `TEST-6 [x] clean — no tautological mock-return assertions`
- `TEST-7 [x] clean — setup helpers are well-factored (helpers.ts, beforeEach)`
- `TEST-8 [x] tests/e2e/{font-selection,menu-settings-open,terminal-selection,tls}.test.ts — fixed-port registry collision risk under parallel`
- `TEST-9 [x] tests/e2e/topbar.test.ts:16,22 — waitForTimeout(1500) hard-waits`
- `TEST-10 [x] clean — each test file has a single clear concern`
- `DET-1 [x] clean — no wall-clock or timezone dependencies`
- `DET-2 [x] clean — no unseeded RNG usage`
- `DET-3 [x] clean — all fs-using tests use mkdtempSync + afterEach cleanup`
- `DET-4 [x] clean — no cross-test state sharing`
- `FUZZ-1 [x] src/server/protocol.ts:24 (OSC 52 base64), src/server/colours.ts:8 (TOML normalize) — no property/fuzz coverage`
