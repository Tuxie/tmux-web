---
Status: open
Autonomy: needs-decision
Resolved-in:
Depends-on:
informally-unblocks:
Pre-conditions:
attribution:
Commit-guidance:
model-hint: junior
---

# Cluster 21 — test-organisation

## TL;DR

- **Goal:** Seven small organizational test improvements: stale `PORTS.md` row, mixed `.test.ts`/`.spec.ts` extensions undocumented, e2e helpers cleanup swallow, console-silencer fragility, fuzz-coverage strengthening, missing fuzz file for `ControlParser`, e2e webServer ergonomics.
- **Impact:** Removes minor papercuts that accumulate in a test-heavy T2 (147 test files for 14k LOC). Documents extension conventions; closes a fuzz gap that today is gated only by manual pre-tag discipline.
- **Size:** Medium (half-day).
- **Depends on:** none
- **Severity:** Low
- **Autonomy (cluster level):** needs-decision

## Header

> Session size: Medium · Analysts: Test · Depends on: none · Autonomy: needs-decision

## Files touched

- `tests/e2e/PORTS.md` (1 finding)
- `tests/e2e/helpers.ts` (1 finding)
- `tests/e2e/fixture-themes.ts` (1 finding — naming)
- `tests/e2e/*.{test,spec}.ts` (1 finding — naming convention doc)
- `tests/unit/_setup/silence-console.ts` (1 finding)
- `playwright.config.ts` (1 finding)
- `tests/fuzz/extract-tt-messages.test.ts` (1 finding — strengthening)
- `tests/fuzz/tmux-control-parser.test.ts` (proposed — new file)

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 0 · Low: 7
- autofix-ready: 1 · needs-decision: 6

## Findings

- **`menu-settings-open.test.ts` referenced in PORTS.md is missing** — `tests/e2e/PORTS.md:9` reserves port 4060 for `tests/e2e/menu-settings-open.test.ts`, but the file does not exist in the directory listing. Either the file was removed and PORTS.md is stale, or the test was renamed/abandoned and the row is dead documentation.
  - Location: `tests/e2e/PORTS.md:9`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `docs-drift`
  - Fix: Delete the line `| 4060  | tests/e2e/menu-settings-open.test.ts       |       |` from `tests/e2e/PORTS.md`. If the test is intended to be reintroduced, replace with `| 4060  | reserved                                   | menu-settings-open (deferred) |` matching the existing `4116` row's style.
  - Raised by: Test

- **`fixture-themes.ts` is a `.ts` source file in the e2e directory and silently part of the test suite glob** — `tests/e2e/fixture-themes.ts` is sibling to `*.test.ts` files but not itself a test. The Playwright `testDir: './tests/e2e'` pattern excludes non-test files via Playwright's default match, but the file's existence side-by-side with tests is mildly confusing. Same shape applies to `helpers.ts`.
  - Location: `tests/e2e/fixture-themes.ts`
  - Severity: Low · Confidence: Plausible · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `test-organisation`
  - Notes: Not high-priority. Playwright `testMatch: '*.{test,spec}.ts'` would explicitly exclude these — current default works because they don't end in `.test.ts`/`.spec.ts`. Borderline drop.
  - Raised by: Test

- **Mixed `.test.ts` / `.spec.ts` extensions in `tests/e2e/`** — Playwright tests use both `*.test.ts` (mockApi-driven) and `*.spec.ts` (real-tmux). The split appears intentional — `*.spec.ts` files all `test.skip(!hasTmux(), …)` — but no convention is documented in PORTS.md, AGENTS.md, or a README under `tests/e2e/`. New contributors choose between the two by chance.
  - Location: `tests/e2e/control-mode-notifications.spec.ts`
  - Location: `tests/e2e/scrollbar.spec.ts`
  - Location: `tests/e2e/theming.spec.ts`
  - Location: `tests/e2e/menu-session-switch-content.spec.ts`
  - Location: `tests/e2e/control-mode-window-size.spec.ts`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `test-organisation`
  - Notes: Either document the rule (`*.spec.ts` = needs real tmux, `*.test.ts` = mocked) at the top of `tests/e2e/PORTS.md` or in `AGENTS.md`, or normalise to one extension. T2-acceptable status quo if documented.
  - Raised by: Test

- **DET-3: e2e port allocator caps at `PORT_RANGE_SIZE = 1000` but the harness's `IsolatedTmux` cleanup is best-effort, leaving stale UNIX sockets** — `scrollbar.spec.ts:7-15` reserves port `4120 + parallelIndex` per worker, capped at 1000. `helpers.ts:55-58` cleans up via `tmux kill-server` inside a `try {} catch {}` — if the kill fails (server already dead, parent worker crashed), the socket file at `<root>/sock` survives. Subsequent runs in the same `mkdtemp` prefix do not collide because `mkdtemp` randomises, but the leaked socket persists until the OS reaps `/tmp`. Not a bug per se, but a source of test-run residue on a heavily-fuzzed CI host.
  - Location: `tests/e2e/helpers.ts:55`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `test-isolation`
  - Notes: For T2 the swallow is acceptable. A stronger pattern would log the failure (debug-only) rather than silently `catch { /* already gone */ }` so a debugging session can spot persistent leaks.
  - Raised by: Test

- **DET-4: `silence-console.ts` global preload mutates `process.stderr.write` on bun's global; tests that explicitly assert on `console.warn` pre-fix fragile** — `tests/unit/_setup/silence-console.ts:60-67` wraps `process.stderr.write` to capture any chunk starting with `[debug] `. The wrap is permanent for the life of the test process. A test that toggles `config.debug = true` and checks debug stderr output (e.g. `ws-handle-connection.test.ts:1107` "debug log records window action control fallback timing") wraps `process.stderr.write` itself at line 1124 and restores at line 1151. The two wrappers compose correctly because the silencer's `originalStderrWrite` is captured before the test's override; but the chain is fragile — adding a third independent test that wraps `process.stderr.write` (without going through `consoleCaptured`) would break the cumulative restore order.
  - Location: `tests/unit/_setup/silence-console.ts:60`
  - Location: `tests/unit/server/ws-handle-connection.test.ts:1124`
  - Severity: Low · Confidence: Plausible · Effort: Medium · Autonomy: needs-decision
  - Cluster hint: `test-harness-fragility`
  - Notes: One alternative is for the silencer to expose a `withDebugCapture(fn)` helper instead of leaving `process.stderr.write` mutated at module scope, so tests opt in cleanly. T2 borderline; file at low severity.
  - Raised by: Test

- **TEST-7: e2e `webServer` configuration has `reuseExistingServer: false`, so a stale local server on port 4023 is *not* an opt-out** — `playwright.config.ts:42`. Combined with the developer running `make dev` (which uses port 4022, not 4023, so this is safe), but a developer accidentally bound to 4023 will hit `EADDRINUSE` and the test run dies before the first page navigation. The error message will be the bun server's bind error, not a Playwright-friendly hint. Minor T2 ergonomic bug.
  - Location: `playwright.config.ts:42`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `e2e-ergonomics`
  - Notes: Switching to `reuseExistingServer: !process.env.CI` is the conventional shape but conflicts with the test fixture-isolation goal (see top-of-file comment about isolating `~/.config/tmux-web/sessions.json`). Probably correct as-is for T2; file at Low so it surfaces if a contributor runs into it.
  - Raised by: Test

- **FUZZ-1 (joint with Security — shape side): `extract-tt-messages.test.ts` filter excludes the very prefix it should test** — At line 36 and 53, `fc.string().filter(s => !s.includes(TT_PREFIX))` for the prefix/suffix arbitrary. This is correct for the "round-trip" property — adversarial prefixes can't accidentally introduce a second TT marker — but it means the fuzzer never exercises *adjacent* TT prefixes inside the prefix string. The test at line 74-81 ("adjacent TT frames both parse") is a fixture, not a property. A property test of the form `fc.array(payload, {minLength: 0, maxLength: 5}).map(arr => arr.map(p => TT_PREFIX + JSON.stringify(p)).join(''))` would exercise N concatenated frames per random input.
  - Location: `tests/fuzz/extract-tt-messages.test.ts:36`
  - Location: `tests/fuzz/extract-tt-messages.test.ts:53`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `fuzz-coverage-gap`
  - Notes: This is a property-strengthening suggestion, not a bug. The 9 fuzz files cover the 9 parsers AGENTS.md identifies; this finding is about the *property* in one of them, not a missing parser. T2 borderline.
  - Raised by: Test

- **FUZZ-1: no fuzz harness for the tmux control protocol parser (`ControlParser`)** — AGENTS.md lists nine "security-sensitive parsers" and the fuzz directory has 9 files matching them. `src/server/tmux-control.ts` exports `ControlParser` (line 5 of `tests/unit/server/tmux-control-parser.test.ts`) which consumes raw bytes from a control-mode tmux connection — the bytes can include unbalanced `%begin`/`%end`/`%error`/`%session-renamed`/`%output` frames that can confuse a hand-rolled state machine. The parser receives output from the local tmux process, not network input, so the trust boundary is "tmux behaves" — but the parser sits on a high-volume bytestream and a regression that crashes it crashes the whole control client.
  - Location: `tests/unit/server/tmux-control-parser.test.ts:1`
  - Location: `src/server/tmux-control.ts` (cited cross-scope; trust-boundary review is Security's joint half)
  - Severity: Low · Confidence: Verified · Effort: Medium · Autonomy: needs-decision
  - Cluster hint: `fuzz-coverage-gap`
  - Notes: T2-borderline. Adding a 10th fuzz file `tests/fuzz/tmux-control-parser.test.ts` with `fc.assert(fc.property(fc.string(), (s) => { const p = new ControlParser({ … no-throw callbacks }); p.push(s); }))` proves the never-throws invariant cheaply (~50 LOC). Joint with Security: trust boundary is local tmux (not network), so severity is Low. Defer if Security agrees the trust gap doesn't warrant fuzz.
  - Raised by: Test

## Suggested session approach

Subagent-driven mechanical sweep on the autofix-ready PORTS.md cleanup; the rest are independent small-decisions that can be batched in a single ~30-min interview pass. The fuzz strengthening (extract-tt adjacent property + tmux-control-parser fuzz) is the most concrete addition; everything else is "document the convention" or "defer with rationale" shape.
