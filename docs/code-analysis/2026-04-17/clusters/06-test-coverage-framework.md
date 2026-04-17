# Cluster 06 — test-coverage-framework

> **Goal:** Resolve the undeclared-`vitest` import risk and add E2E coverage for the two security-relevant flows that currently have none.
>
> Session size: Medium · Analysts: Test · Depends on: none

## Files touched

- 8 unit test files (vitest → bun:test imports)
- `tests/e2e/topbar.test.ts` (waitForTimeout)
- 4 e2e test files with hard-coded ports
- `tests/unit/server/pty.test.ts` (sanitize-slash edge)
- 2 new E2E test files (proposed)

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 4 · Low: 3
- autofix-ready: 1 · needs-decision: 3 · needs-spec: 2

## Findings

- **8 unit test files import from `'vitest'`; no vitest declared in `package.json` or `bun.lock`** — Tests pass today only because Bun 1.3.x ships an undocumented vitest-compat shim when running under `bun test`. A future Bun release could drop or change the shim and silently break all eight files with a misleading "Cannot find package 'vitest'" error.
  - Location: `tests/unit/server/protocol.test.ts:1`, `tests/unit/server/pty.test.ts:1`, `tests/unit/server/tls.test.ts:1`, `tests/unit/server/allowlist.test.ts:1`, `tests/unit/client/protocol.test.ts:1`, `tests/unit/client/ui/clipboard.test.ts:1`, `tests/unit/client/ui/mouse.test.ts:1`, `tests/unit/client/adapters/xterm.test.ts:1`
  - Severity: Medium · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `test-framework-hygiene`
  - Raised by: Test
  - Fix: Replace `import { describe, it, expect } from 'vitest'` with `import { describe, it, expect } from 'bun:test'` in all eight files. APIs are identical.

- **Missing E2E for the file-drop upload pipeline** — Unit tests cover `sanitiseFilename`, `writeDrop`, `deleteDrop`, `formatBracketedPasteForDrop` in isolation. The full browser drag-and-drop → `POST /api/drop` → server write → bracketed-paste injection → `dropsChanged` TT push → drops-panel UI path is untested end-to-end.
  - Location: `tests/e2e/` (absent), `src/client/ui/drops-panel.ts`, `src/client/ui/file-drop.ts`
  - Severity: Medium · Confidence: Verified · Effort: Medium · Autonomy: needs-spec
  - Cluster hint: `e2e-file-drop`
  - Raised by: Test

- **Missing E2E for the OSC-52 clipboard-read consent flow** — Unit tests for `resolvePolicy`, `recordGrant`, `deliverOsc52Reply`, `buildOsc52Response` are solid, but the user-visible flow (PTY triggers `clipboardPrompt` → user grants/denies → `send-keys -H` reply → PTY receives the hex) has no E2E test. Arguably the most security-relevant UI path in the app.
  - Location: `tests/e2e/` (absent), `src/client/ui/clipboard-prompt.ts`, `src/server/osc52-reply.ts`
  - Severity: Medium · Confidence: Verified · Effort: Medium · Autonomy: needs-spec
  - Cluster hint: `e2e-osc52-consent`
  - Raised by: Test

- **Two topbar tests rely on `waitForTimeout(1500)` to confirm auto-hide** — Topbar auto-hides after 1 s idle; tests hard-wait 1.5 s. Under CI load the 1.5 s margin is tight; flipping to an event-driven `waitForFunction` removes the risk entirely.
  - Location: `tests/e2e/topbar.test.ts:16`, `tests/e2e/topbar.test.ts:22`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `e2e-timing`
  - Raised by: Test
  - Notes: `page.waitForFunction(() => topbar.classList.contains('hidden'), { timeout: 5000 })`.

- **Hard-coded port registry at risk if Playwright parallelism is ever enabled** — `font-selection.test.ts` (4050), `menu-settings-open.test.ts` (4060), `terminal-selection.test.ts` (4100), `tls.test.ts` (4098/4099) each spin up independent servers on fixed ports. `playwright.config.ts` currently has no `fullyParallel: true`, so within-project serialization hides this; enabling parallel execution later would race.
  - Location: `tests/e2e/font-selection.test.ts:8`, `tests/e2e/menu-settings-open.test.ts:7`, `tests/e2e/terminal-selection.test.ts:49`, `tests/e2e/tls.test.ts:18`
  - Severity: Low · Confidence: Plausible · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `e2e-port-collision`
  - Raised by: Test
  - Notes: Either allocate ports dynamically (listen on :0 and read back), or document the registry with a comment block in one place.

- **`sanitizeSession` dot+slash interaction edge case untested** — Existing tests cover `'../../../etc'` (double-dot collapse) and "slash allowed" separately, but not a combined input like `'../etc'` (single dot-dot + slash) where the `..` collapse may only target consecutive segments.
  - Location: `tests/unit/server/pty.test.ts:9`, `src/server/pty.ts` (`sanitizeSession`)
  - Severity: Low · Confidence: Plausible · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `unit-pty-sanitize`
  - Raised by: Test
  - Fix: Add `expect(sanitizeSession('../etc')).not.toContain('..');` as a regression case.

## Suggested session approach

Do the mechanical import replacement and the `sanitizeSession` regression test first (autofix). Treat the two missing E2E flows as a separate half-session: spec out the fixtures and assertions in prose, then write the tests — the file-drop test needs mock file upload and WS message capture; the OSC-52 test needs a PTY writer that emits the 52-read sequence and verification that `send-keys -H` was called with the expected hex.
