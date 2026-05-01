---
Status: open
Autonomy: autofix-ready
Resolved-in:
Depends-on:
informally-unblocks:
Pre-conditions:
attribution:
Commit-guidance:
model-hint: junior
---

# Cluster 08 — doc-drift

## TL;DR

- **Goal:** Mechanical AGENTS.md / README corrections where prose drifted past code (reconnect flow, theme defaults, topbar height, CLI option metavars).
- **Impact:** A future contributor reading AGENTS.md / README cannot build an incorrect mental model from these specific load-bearing claims; the project-structure block in AGENTS no longer hides three test subdirectories.
- **Size:** Small (<2h).
- **Depends on:** none.
- **Severity:** Low.
- **Autonomy (cluster level):** autofix-ready.

## Header

> Session size: Small · Analysts: Docs Consistency · Depends on: none · Autonomy: autofix-ready

## Files touched

- `AGENTS.md` (4 sites)
- `README.md` (3 sites)

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 0 · Low: 6
- autofix-ready: 6 · needs-decision: 0 · needs-spec: 0

## Findings

- **AGENTS.md `Reconnect size sync` describes a step that does not happen** — Section 5 says "WS reconnect: call `adapter.fit()`, send `{type:"resize"}` on `ws.onopen`." Actual `onOpen` callback in `src/client/index.ts:361–364` only calls `connection.sendResize(adapter.cols, adapter.rows)`. `fit()` is driven by `ResizeObserver` and `window.resize`, not the reconnect path. On a pure reconnect with no browser resize, `fit()` does not fire; the server receives the adapter's cached dimensions.
  - Location: `AGENTS.md:394`
  - Location: `src/client/index.ts:361`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `doc-behavior-drift`
  - Fix: Change the AGENTS.md line to: `WS reconnect: send {"type":"resize"} with the adapter's cached dimensions on ws.onopen. adapter.fit() is not called on reconnect; it fires via ResizeObserver/window-resize events. src/client/connection.ts, src/client/index.ts.`
  - Raised by: Docs Consistency Analyst

- **AGENTS.md `Theme-switch semantics` omits `topbarAutohide` / `scrollbarAutohide` from the `applyThemeDefaults` field list** — Line 294 enumerates fields overwritten on theme switch, ending with `backgroundDarkest`. Actual `applyThemeDefaults` in `src/client/session-settings.ts:290–291` also handles `topbarAutohide` and `scrollbarAutohide` (added per CHANGELOG 1.10.4).
  - Location: `AGENTS.md:294`
  - Location: `src/client/session-settings.ts:290`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `doc-behavior-drift`
  - Fix: Append `, topbarAutohide, scrollbarAutohide` to the field list at AGENTS.md:294.
  - Raised by: Docs Consistency Analyst

- **AGENTS.md Topbar section claims 32 px height; CSS and all comments say 28 px** — Section 6: "32px toolbar overlay terminal." Every CSS declaration and comment uses 28 px (`base.css:599`, `base.css:79`, `base.css:467`, `themes/default/default.css:83`). 32 px appears nowhere in production CSS or comments.
  - Location: `AGENTS.md:398`
  - Location: `src/client/base.css:599`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `doc-behavior-drift`
  - Fix: Change `AGENTS.md:398` from `32px toolbar overlay terminal` to `28px toolbar overlay terminal`.
  - Raised by: Docs Consistency Analyst

- **README CLI options table missing `-V`/`--version` and `-h`/`--help` flags** — README "CLI options" block (lines 70–88) does not list `--version` or `--help`. AGENTS.md (lines 218–219) and the `--help` text emitted by `src/server/index.ts:315–317` both include them.
  - Location: `README.md:70`
  - Location: `AGENTS.md:218`
  - Location: `src/server/index.ts:315`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `cli-table-drift`
  - Fix: Add to the README CLI options block: `-V, --version                  Print version and exit` and `-h, --help                     Show this help`.
  - Raised by: Docs Consistency Analyst

- **README uses `<file>` metavar for `--tls-cert` / `--tls-key`; AGENTS.md and runtime `--help` use `<path>`** — README lines 80–81 show `--tls-cert <file>` and `--tls-key <file>`. AGENTS.md (lines 211–212) and runtime help (`src/server/index.ts:308–309`) use `<path>`. `<path>` is canonical (options accept any filesystem path).
  - Location: `README.md:80`
  - Location: `README.md:81`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `cli-table-drift`
  - Fix: `README.md:80` → `--tls-cert <path>`; `README.md:81` → `--tls-key <path>`.
  - Raised by: Docs Consistency Analyst

- **AGENTS.md Project Structure block omits `tests/fuzz/`, `tests/post-compile/`, `tests/fixtures/`** — Structure block (lines 160–164) shows only `tests/unit/` and `tests/e2e/`. Actual directory contains the three other subdirs as well, each with meaningful purpose described elsewhere in AGENTS.md (lines 57–105).
  - Location: `AGENTS.md:160`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `project-structure-map`
  - Fix: Extend the `tests/` sub-tree in the AGENTS.md structure block: `fuzz/               # fast-check property/fuzz tests`, `post-compile/       # compiled-binary smoke tests`, `fixtures/           # shared test fixtures`.
  - Raised by: Docs Consistency Analyst

## Suggested session approach

Pure mechanical edits — six text changes across two files. Suitable for a junior subagent dispatch with the `Fix:` lines as the spec. Single commit. Verify by re-reading the changed lines after the edit; no test runs required.
