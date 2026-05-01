# Themes

Cross-cutting patterns surfaced per `synthesis.md` §5.

## Async fire-and-forget (silent error swallowing)

- **Pattern:** Async functions invoked in event handlers without `void` cast or explicit `.catch(...)` that surfaces the error. The result: a thrown rejection is silently dropped; downstream state can diverge without the user or the logs noticing.
- **Occurrences:** 5 across 3 files.
- **Sample locations:** `src/server/ws.ts:339`, `src/server/ws.ts:348`, `src/client/ui/topbar.ts:622`, `src/client/ui/topbar.ts:758`, `src/client/ui/topbar.ts:892`, `src/client/index.ts:284`.
- **Severity:** Medium (server-side WS state can diverge); rest Low (client-side toasts at most).
- **Raised by:** Backend Analyst, Frontend Analyst.
- **Fix sketch:** establish a project rule that every fire-and-forget async call uses `void f(...)` (cast) AND has a catch handler that at minimum logs or `clientLog`s. Where the existing handler is sync but the callee is async, capture rejection at the boundary.
- **Addressed in clusters:** 01-async-fire-and-forget.

## Production-timer constants used as test sleep targets

- **Pattern:** Tests sleep for `production_constant + margin` to span retry/backoff/setTimeout windows in production code. The production constants are hard-coded literals rather than exported names; if the production code ever bumps the value, the tests pass with shorter coverage and nobody notices.
- **Occurrences:** 4 across 2 files (`tests/unit/server/ws-handle-connection.test.ts:556` for `[0,25,75,150,300]ms` retry budget; `tests/unit/server/ws-handle-connection.test.ts:1174` for the 500 ms colour-variant retry; `tests/unit/server/http-branches.test.ts:912,938` for the 100 ms exit timer).
- **Severity:** Low.
- **Raised by:** Test Analyst.
- **Fix sketch:** export the timing constants from `src/server/ws.ts` (and equivalent server modules) under stable names, and have tests reference those plus a documented margin (e.g., `await Bun.sleep(STARTUP_RETRY_BUDGET_MS + 50)`). Couples tests to production at a named symbol, not a magic literal.
- **Addressed in clusters:** 02-test-sleep-poll-cleanup.

## Documentation drift after silent feature additions

- **Pattern:** A code change adds a field, renames a constant, or adjusts a default value, but the AGENTS.md / README prose that names that field/constant/default is not updated. The result: a future contributor reads the doc, builds an incorrect mental model, and either patches symptoms or asks why the docs are wrong.
- **Occurrences:** 6 across 2 files (3 in AGENTS.md: reconnect fit() claim, applyThemeDefaults missing fields, 32px topbar height; 2 in README.md: missing `--version`/`--help`, `<file>` vs `<path>` metavar; 1 in AGENTS.md project-structure block: missing `tests/fuzz`, `tests/post-compile`, `tests/fixtures` subdirs).
- **Severity:** Low.
- **Raised by:** Docs Consistency Analyst.
- **Fix sketch:** the fixes themselves are mechanical and live in cluster 08. The meta-issue is enforcement (see [meta.md](./meta.md) for a draft pre-release checklist item that catches this shape).
- **Addressed in clusters:** 08-doc-drift.

## CSS magic numbers as cross-file structural values

- **Pattern:** `28px` (the topbar height) appears 18+ times across `src/client/base.css`, `themes/amiga/amiga-common.css`, and `themes/default/default.css` with no shared CSS custom property. Derived offsets (`top: 31px`, `top: 29px`) are manually computed from the magic number.
- **Occurrences:** 1 conceptual finding (the system-inventory entry) across multiple files; appears as STYLE-4.
- **Severity:** Low.
- **Raised by:** Styling Analyst.
- **Fix sketch:** introduce `--tw-topbar-height: 28px` in `:root` of `base.css`, replace `28px` literals, and replace derived offsets with `calc(var(--tw-topbar-height) + 3px)` (default theme 3 px frame) / `calc(var(--tw-topbar-height) + 1px)` (Amiga 1 px). Decision needed for theme-pack-specific frame offsets.
- **Addressed in clusters:** 04-css-housekeeping.

_No further cross-cutting themes (≥3 files across ≥2 agents) surfaced this run._
