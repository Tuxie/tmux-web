---
Status: open
Resolved-in:
---

# Cluster 08 — claude-md-refresh

## TL;DR

- **Goal:** Bring CLAUDE.md (and a couple of ambient neighbours — README.md, `release.yml` comment) back in sync with the code shipped in v1.6.0 and v1.6.1: keyboard handler scope, theme-switch semantics, DOM contract ID list, session-menu button description, two grammar fragments, and the README CLI flag table.
- **Impact:** CLAUDE.md is the load-bearing contributor / agent instruction file. Drift here sends Claude-driven sessions (and humans) down the wrong path when they reason about keyboard behavior, theme persistence, or the DOM contract backing the E2E tests.
- **Size:** Medium (mechanical edits, but six separate sections to touch cleanly)
- **Depends on:** none
- **Severity:** Medium

## Header

> Session size: Medium · Analysts: Docs · Depends on: none

## Files touched

- `CLAUDE.md` (5 findings: keyboard scope, theme-switch semantics, DOM contract, session-menu description, 2 grammar fragments)
- `README.md` (1 finding: CLI options table)
- `.github/workflows/release.yml` (1 finding: misplaced comment)

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 3 · Low: 4
- autofix-ready: 7 · needs-decision: 0 · needs-spec: 0

## Findings

- **Keyboard-handler scope understated in CLAUDE.md "Workaround #3"** — CLAUDE.md:231-232 says `keyboard.ts` is "now browser-shortcut-only (Cmd+R, Cmd+F) — xterm handles the modified-key encoding itself." `src/client/ui/keyboard.ts:33-43` also intercepts `Shift+Enter` (sends `\x1b[13;2u`) and `Ctrl+Enter` (sends `\x1b[13;5u`) with a comment explaining why: Claude Code's TUI never negotiates Kitty mode, so xterm's built-in encoding would degrade to a bare `\r`. These are load-bearing user-facing behaviors, not merely "browser shortcuts."
  - Location: `CLAUDE.md:231-232` · `src/client/ui/keyboard.ts:33-43`
  - Severity: Medium · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `claude-md-refresh`
  - Fix: Replace "is now browser-shortcut-only (Cmd+R, Cmd+F) — xterm handles the modified-key encoding itself" with "handles Cmd+R passthrough, Cmd+F fullscreen toggle, and explicit Shift+Enter / Ctrl+Enter CSI-u sends (xterm only emits these when the app negotiates Kitty mode; Claude Code doesn't, so we unconditionally send `\x1b[13;2u` / `\x1b[13;5u`)."
  - Raised by: Docs Consistency Analyst

- **Theme-switch semantics paragraph is incomplete and misuses "unconditionally"** — CLAUDE.md:192-196 says `colours`, `fontFamily`, `fontSize`, and `spacing` are "unconditionally overwritten" on theme switch. Two problems: (a) `applyThemeDefaults` in `src/client/session-settings.ts:181-203` applies 15 fields in addition to the listed four — opacity, tuiBgOpacity, tuiFgOpacity, fgContrastStrength, fgContrastBias, tuiSaturation, themeHue, themeSat, themeLtn, themeContrast, depth, backgroundHue, backgroundSaturation, backgroundBrightest, backgroundDarkest. (b) Each field uses null-coalescing (`td.xxx ?? s.xxx`), so the overwrite only happens when the theme declares the default; "unconditionally" misleads a contributor adding a new theme.
  - Location: `CLAUDE.md:192-196` · `src/client/session-settings.ts:181-203` · `src/client/ui/topbar.ts:554-557`
  - Severity: Medium · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `claude-md-refresh`
  - Fix: Replace the paragraph with: "When the user switches theme, every theme default declared in `theme.json` overwrites the corresponding session field — colours, fontFamily, fontSize, spacing, opacity, themeHue, backgroundHue, and all slider defaults introduced in v1.6.0 (see `applyThemeDefaults` in `src/client/session-settings.ts` for the full list). Fields the target theme does not declare keep their previous values."
  - Raised by: Docs Consistency Analyst

- **DOM contract in CLAUDE.md missing ~14 load-bearing IDs added in v1.6.0, and the session-menu button description conflates two separate elements** — CLAUDE.md:296-311 lists 12 IDs but omits the 14 new slider pairs wired in v1.6.0 (pattern `#sld-{name}` / `#inp-{name}` for theme-hue/sat/ltn/contrast, depth, background-hue/saturation/brightest/darkest, tui-bg-opacity, tui-fg-opacity, fg-contrast-strength, fg-contrast-bias, tui-saturation) plus `#chk-autohide`. Separately at CLAUDE.md:279-282, the session-menu description treats `#btn-session-menu` as the whole `[ + | <session name> ]` button; the `+` side is a separate `#btn-session-plus` element (currently intentionally unwired — see cluster 11). The description also says the dropdown has a "Create new session" entry at the bottom, but the dropdown actually ends with a "New session:" text input row followed by a "Kill session X…" entry.
  - Location: `CLAUDE.md:296-311` · `CLAUDE.md:279-282` · `src/client/index.html:39-44,72-166` · `src/client/ui/topbar.ts:162-296`
  - Severity: Medium · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `dom-contract-audit`
  - Fix: Extend the ID list with the v1.6.0 slider pairs as a group ("slider pairs following the pattern `#sld-{name}` / `#inp-{name}` for: theme-hue, theme-sat, theme-ltn, theme-contrast, depth, background-hue, background-saturation, background-brightest, background-darkest, tui-bg-opacity, tui-fg-opacity, fg-contrast-strength, fg-contrast-bias, tui-saturation"). Update the session-menu description to distinguish `#btn-session-plus` (unwired placeholder; fate decided in cluster 11) from `#btn-session-menu` (opens session dropdown). Correct "Create new session" to "New session: text input + Kill-session entry".
  - Raised by: Docs Consistency Analyst

- **Misplaced "Post-compile verification" comment in `release.yml` — describes vendor-xterm step but sits above unit-test step** — `.github/workflows/release.yml:62-64` is a comment block describing the vendor-xterm bundle check. It is placed above the "Run unit tests" step (line 65-66) but actually describes the "Verify compiled binary embeds vendor/xterm.js" step at line 73-75. A contributor reading the workflow associates the vendor-xterm rationale with the wrong step.
  - Location: `.github/workflows/release.yml:62-64`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `claude-md-refresh`
  - Fix: Move lines 62-64 to immediately precede line 73 (`- name: Verify compiled binary embeds vendor/xterm.js`).
  - Raised by: Docs Consistency Analyst

- **Grammar fragments in CLAUDE.md — "prevent terminal from see event" and "abstract terminal emulator"** — CLAUDE.md:223 contains "`stopPropagation()` prevent terminal from see event." CLAUDE.md:157 contains "`TerminalAdapter` interface (`src/client/adapters/types.ts`) abstract terminal emulator."
  - Location: `CLAUDE.md:223` · `CLAUDE.md:157`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `claude-md-refresh`
  - Fix: (line 223) "`stopPropagation()` prevents the terminal from seeing the event." (line 157) "`TerminalAdapter` interface (`src/client/adapters/types.ts`) abstracts the terminal emulator."
  - Raised by: Docs Consistency Analyst

- **README CLI options table missing `--reset`, `--themes-dir`, and `-d`/`--debug` flags** — `README.md:65-81` lists 13 CLI flags but omits three flags defined in `parseConfig()` and documented in `--help`: `--themes-dir <path>` (user theme-pack override), `--reset` (added v1.6.1, deletes sessions.json and restarts), and `-d`/`--debug`. A user deploying from the README alone cannot find `--reset` — a flag specifically introduced to recover from bad saved settings.
  - Location: `README.md:65-81` · `src/server/index.ts:67,73-74,174-175`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `readme-drift`
  - Fix: Add the three flags to the README CLI table in their natural positions (matching the order in `src/server/index.ts` help output).
  - Raised by: Docs Consistency Analyst

## Suggested session approach

Mechanical — dispatch to a subagent. No design decisions required; every fix has an exact replacement named. Order edits by section so the diff reads cleanly (CLAUDE.md top-to-bottom, then README, then release.yml). Verify by re-reading CLAUDE.md top-to-bottom and spot-checking the DOM IDs against `src/client/index.html`.

## Commit-message guidance

1. Name the cluster slug and date — e.g., `docs(cluster 08-claude-md-refresh, 2026-04-21): sync CLAUDE.md keyboard/theme/DOM sections with v1.6.0 and README CLI flags`.
2. No `Depends-on:` chain.
