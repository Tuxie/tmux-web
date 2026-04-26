# Test Analyst — analyst-native output

> Preserved for traceability. For fix work, use the clusters under `../clusters/` — they cross-cut these per-analyst sections.

## Summary

The test suite is well-organised, generously sized for a T2 (~14k LOC, 88 unit + 27 e2e + 9 fuzz files for ~14k LOC of production code), and applies several modern patterns thoughtfully: per-test harness isolation via `mkdtempSync`, ephemeral-port `Bun.serve({ port: 0 })`, a global `silence-console` preload, an LCG-seeded e2e session-switch fuzz, fast-check property tests for the security-sensitive parsers, and explicit `expect.poll` over wall-clock sleeps in most e2e flows. The genuine weak spots are clustered narrowly: a few `expect(true).toBe(true)` tautologies and ~17 raw `setTimeout` sleeps inside one large WS integration test (`ws-handle-connection.test.ts`), a missing artifact-test for the compiled `tmux-web` binary that AGENTS.md acknowledges has regressed five times (CI-5 territory, also flagged for Tooling), and an empty `tests/unit/build/` directory next to a load-bearing `bun-build.ts`. The fuzz suite shape is sound (9 parsers ↔ 9 files) and matches AGENTS.md's release protocol; FUZZ-1's "shape" half is healthy. T2 classification looks correct.

## Findings

(Findings have been merged into clusters; cluster files carry the verbatim bodies.)

- **Two `expect(true).toBe(true)` tautologies in WS connection test** — `tests/unit/server/ws-handle-connection.test.ts:246,259` — Severity Medium, Confidence Verified · → see cluster 19-test-assertion-quality
- **Wall-clock sleeps as completion signals (CONC-7 / TEST-11) in `ws-handle-connection`** — `tests/unit/server/ws-handle-connection.test.ts:208,240,245,493,506,1015,1190,1281` — Severity Medium, Confidence Verified · → see cluster 18-test-flaky-sleeps
- **Wall-clock sleeps in e2e tests (TEST-11)** — `tests/e2e/control-mode-window-size.spec.ts:20`, `tests/e2e/control-mode-notifications.spec.ts:30`, `tests/e2e/title.test.ts:31`, `tests/e2e/keyboard.test.ts:25` — Severity Medium, Confidence Verified · → see cluster 18-test-flaky-sleeps
- **TEST-1: `tests/unit/build/` is empty — no test exercises `bun-build.ts`** — `tests/unit/build/` — Severity Medium, Confidence Verified · → see cluster 20-test-and-coverage-gaps
- **TEST-2 / CI-5: e2e `tls.test.ts` exercises a `bun src/server/index.ts` source-mode server, never the compiled `tmux-web` binary** — `tests/e2e/tls.test.ts:19,49` — Severity Medium, Confidence Verified · → see cluster 05-ci-artifact-verification
- **Tautological `expect(true).toBe(true)` after `swallows writeText rejection`** — `tests/unit/client/ui/clipboard.test.ts:51` — Severity Low, Confidence Verified · → see cluster 19-test-assertion-quality
- **Misleading e2e sanity check: `await page.waitForTimeout(SETTLE_AFTER_COMPLETED_SWITCH_MS)`** — `tests/e2e/menu-session-switch-content.spec.ts:96` — Severity Low, Confidence Verified · → see cluster 18-test-flaky-sleeps
- **TEST-12 / CONC-6: floating promise `tmuxControl.run(args)` leaks under `runInSession`** — `tests/unit/server/ws-handle-connection.test.ts:769` — Severity Low, Confidence Plausible · → see cluster 19-test-assertion-quality
- **`menu-settings-open.test.ts` referenced in PORTS.md is missing** — `tests/e2e/PORTS.md:9` — Severity Low, Confidence Verified · → see cluster 21-test-organisation
- **`fixture-themes.ts` is a `.ts` source file in the e2e directory and silently part of the test suite glob** — `tests/e2e/fixture-themes.ts` — Severity Low, Confidence Plausible · → see cluster 21-test-organisation
- **Mixed `.test.ts` / `.spec.ts` extensions in `tests/e2e/`** — multiple files — Severity Low, Confidence Verified · → see cluster 21-test-organisation
- **`expect(...).toBeDefined()` over `toEqual`/`toMatchObject` weakens several positive assertions** — `tests/unit/server/api-session-settings.test.ts:80`, others — Severity Low, Confidence Verified · → see cluster 19-test-assertion-quality
- **DET-3: e2e port allocator caps at `PORT_RANGE_SIZE = 1000` but cleanup is best-effort** — `tests/e2e/helpers.ts:55` — Severity Low, Confidence Verified · → see cluster 21-test-organisation
- **DET-4: `silence-console.ts` global preload mutates `process.stderr.write`** — `tests/unit/_setup/silence-console.ts:60`, `tests/unit/server/ws-handle-connection.test.ts:1124` — Severity Low, Confidence Plausible · → see cluster 21-test-organisation
- **TEST-7: e2e `webServer` `reuseExistingServer: false`** — `playwright.config.ts:42` — Severity Low, Confidence Verified · → see cluster 21-test-organisation
- **FUZZ-1: extract-tt-messages property excludes adjacent prefixes** — `tests/fuzz/extract-tt-messages.test.ts:36,53` — Severity Low, Confidence Verified · → see cluster 21-test-organisation
- **FUZZ-1: no fuzz harness for the tmux control protocol parser (`ControlParser`)** — `src/server/tmux-control.ts` — Severity Low, Confidence Verified · → see cluster 21-test-organisation

## Checklist (owned items)

- TEST-1 [x] `tests/unit/build/` — see cluster 20-test-and-coverage-gaps.
- TEST-2 [x] `tests/e2e/tls.test.ts:19,49` — see cluster 05-ci-artifact-verification.
- TEST-3 [x] clean — sampled 30+ tests; assertions specific and not tautological vs mock returns.
- TEST-4 [x] `evidence: tests/unit/server/_harness/spawn-server.ts:117 — port: 0; tests/e2e/PORTS.md fixed-port allocation`.
- TEST-5 [x] `tests/unit/server/_harness/spawn-server.ts:53,75 — mkdtempSync per test; afterEach close. file-drop.test.ts:24-32 mkdtempSync + afterEach rmSync`.
- TEST-6 [x] `desktop/server-process.test.ts:30-79 + ws-handle-connection.test.ts:64-85 helpers`. Some legacy raw setTimeout sites remain — see TEST-11.
- TEST-7 [x] `playwright.config.ts:34-45 — webServer.command starts bun source server fresh per run`.
- TEST-8 [x] `tests/fuzz/sanitise-filename.test.ts:14,54; file-drop.test.ts:88; api-session-settings.test.ts:99; http-branches.test.ts:106; ws-handle-connection.test.ts:937; auth tests in http-auth.test.ts L72`.
- TEST-9 [x] clean — race coverage in clipboard-policy / origin / ws-router / session rename / ws-handle-connection thorough.
- TEST-10 [x] clean — `ws-handle-connection.test.ts:1294,1325` "Bug 3"/"Bug 4" use real promise gates, not arbitrary sleeps.
- TEST-11 [x] `ws-handle-connection.test.ts:208,240,245,493,506,1015,1190,1281; control-mode-window-size.spec.ts:20; control-mode-notifications.spec.ts:30; title.test.ts:31; menu-session-switch-content.spec.ts:96` — see cluster 18-test-flaky-sleeps.
- TEST-12 [x] `ws-handle-connection.test.ts:769; pty-integration.test.ts:14-19` — see cluster 19-test-assertion-quality.
- DET-1 [x] clean — fuzz numRuns deterministic by fast-check default seed.
- DET-2 [x] `evidence: menu-session-switch-content.spec.ts:11-14 nextRandom() seeded LCG (seed 0x4022); silence-console.ts:69 buffer reset prevents cross-test bleed`.
- DET-3 [x] `tests/e2e/PORTS.md:1 + scrollbar.spec.ts:10-15 worker-indexed port; spawn-server.ts:103 port: 0 ephemeral` — see cluster 21-test-organisation.
- DET-4 [x] `silence-console.ts:60 process.stderr.write wrap` — see cluster 21-test-organisation.
- FUZZ-1 [x] `tests/fuzz/{shell-quote,sanitise-filename,sanitize-session,origin,ws-router,colours,foreground-process,extract-tt-messages,process-data}.test.ts (9 files matching AGENTS.md's nine parsers)`. Two strengthening findings filed — see cluster 21-test-organisation. Joint with Security on trust boundary.
