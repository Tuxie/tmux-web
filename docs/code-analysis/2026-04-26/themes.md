# Themes

Cross-cutting patterns surfaced per `synthesis.md` §5 (≥3 distinct files across ≥2 agents after right-sizing).

## Sleep/poll synchronisation in tests where completion signals exist

- **Pattern:** Tests use raw `setTimeout`, `page.waitForTimeout`, or fixed-duration sleeps as completion signals when an event emitter, poll-with-condition, or framework lifecycle hook would observe the actual transition. The Test Analyst flagged ~17 unit-test sleeps and 4 e2e sleeps; Backend's `lifecycle-shutdown` finding (`http.ts:620 setTimeout(() => process.exit, 100)`) is the same pattern in production code.
- **Occurrences:** ~22 across `tests/unit/server/ws-handle-connection.test.ts`, `tests/e2e/control-mode-window-size.spec.ts`, `tests/e2e/control-mode-notifications.spec.ts`, `tests/e2e/title.test.ts`, `tests/e2e/keyboard.test.ts`, `tests/e2e/menu-session-switch-content.spec.ts`, `src/server/http.ts`.
- **Sample locations:** `tests/unit/server/ws-handle-connection.test.ts:208,240,245,493,1015,1281`, `tests/e2e/control-mode-window-size.spec.ts:20`, `src/server/http.ts:620`.
- **Severity:** Medium (highest occurrence — the production `process.exit` setTimeout has the same shape as test sleeps; both can flake under load).
- **Raised by:** Test, Backend.
- **Addressed in clusters:** 18-test-flaky-sleeps (test side), 15-backend-low-cleanup (the `http.ts:620` shutdown sleep).

## CI tests source code; release artifact is uncovered

- **Pattern:** CI runs `bun test` and `bun run coverage:check` against TypeScript source files, then builds release artifacts (`bun build --compile` linux/macOS binaries, Electrobun bundles, tarballs), but every test step targets source — no test extracts the packaged tarball and runs `./tmux-web --version`, no test opens a WS connection against the compiled binary. `scripts/verify-vendor-xterm.ts` is a real artifact smoke test for the embedded-vendor sentinel but it tests one fetch, not the WS surface. The `tls.test.ts` e2e spec spawns `bun src/server/index.ts`, never the compiled binary. The v1.8.0 bunfs/embedded-tmux regression (CHANGELOG.md:63) is the precedent: four binaries shipped with broken tmux extraction; nobody noticed until users reported it.
- **Occurrences:** 3 distinct surfaces across `tests/e2e/tls.test.ts`, `.github/workflows/release.yml`, `tests/unit/build/` (empty dir alongside load-bearing `bun-build.ts`).
- **Sample locations:** `tests/e2e/tls.test.ts:19,49`, `.github/workflows/release.yml:144-165`, `tests/unit/build/`.
- **Severity:** Medium.
- **Raised by:** Security, Tooling, Test.
- **Addressed in clusters:** 05-ci-artifact-verification, 20-test-and-coverage-gaps (the tests/unit/build empty-directory side).

## Documentation references stale symbols after rename / removal

- **Pattern:** AGENTS.md was renamed from CLAUDE.md on 2026-04-23 (commit `4422981`), embedded-tmux support was removed on 2026-04-26 (commit `67cf30e`), the `tmux-term` desktop wrapper was added in v1.9.0, and the renderer was consolidated to xterm.js + WebGL only. Each transition left stale references in documentation and dev/packaging files: README.md still links to `CLAUDE.md`, AGENTS.md describes `#btn-session-plus` as "unwired" when it's wired to desktop window close, the dev wrapper script `tmux-web-dev` still references `dist/client/ghostty.js`, the `tmux-web-dev.service` unit passes a non-existent `--terminal xterm` flag, `package.json` description says "multiple terminal backends" though only one exists, README claims two themes when there are three.
- **Occurrences:** 7+ across `README.md:181,194`, `AGENTS.md:316,362,71-100`, `tmux-web-dev:6`, `tmux-web-dev.service:8`, `package.json:7`, `tests/fuzz/README.md:18`, `packaging/homebrew/tmux-web.rb:1`.
- **Sample locations:** `README.md:181`, `AGENTS.md:316`, `tmux-web-dev:6`, `package.json:7`.
- **Severity:** Medium.
- **Raised by:** Docs, Tooling.
- **Addressed in clusters:** 08-docs-drift, 07-release-pipeline-hygiene.

## Type and lint coverage excludes load-bearing tooling and tests

- **Pattern:** The three TypeScript projects (`tsconfig.json`, `tsconfig.client.json`, `tsconfig.electrobun.json`) cover only `src/`. `scripts/`, `bun-build.ts`, `tests/**`, `playwright.config.ts` are uncovered — a type error in any of them passes `make typecheck` and only fails at runtime. CI typecheck additionally skips `tsconfig.electrobun.json` even though local `make typecheck` runs it. The coverage gate (`scripts/check-coverage.ts`) iterates lcov records but never reconciles against `git ls-files src/`, so files no test imports are silently excluded — `src/desktop/index.ts` (113 lines, real signal-routing) is invisible to the gate.
- **Occurrences:** 4 distinct surfaces across `tsconfig.json:28`, `tsconfig.client.json:26`, `tsconfig.electrobun.json:8`, `.github/workflows/release.yml:113`, `scripts/check-coverage.ts:88-110`, `tests/unit/build/` (empty), and the `src/desktop/index.ts` blind spot.
- **Severity:** Medium.
- **Raised by:** Tooling, Coverage, Test.
- **Addressed in clusters:** 06-ci-and-release-improvements (typecheck), 20-test-and-coverage-gaps (gate blind spots, empty test dirs).

## Naming inconsistency creeps into a high-velocity repo

- **Pattern:** Spelling and convention drift across files: American `sanitizeSession` (`pty.ts:15`) sits next to British `sanitiseFilename` (`file-drop.ts:202`) and `sanitiseSessions` (`sessions-store.ts:75`); `src/client/index.ts:41` is the lone `.ts` extension import among 30+ `.js` extension imports; `src/client/ui/dropdown.ts:551` carries the only `as any` cast in the whole client surface. None are bugs; each is the kind of inconsistency that accumulates in a 737-commits-in-90-days solo repo because no team-wide refactor surfaces them.
- **Occurrences:** 4 across `src/server/pty.ts:15`, `src/server/file-drop.ts:202`, `src/server/sessions-store.ts:75`, `src/client/index.ts:41`, `src/client/ui/dropdown.ts:551`.
- **Severity:** Low.
- **Raised by:** Backend, Frontend.
- **Addressed in clusters:** 17-naming-consistency.
