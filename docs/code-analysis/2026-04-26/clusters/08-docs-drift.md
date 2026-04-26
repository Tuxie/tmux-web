---
Status: closed
Autonomy: autofix-ready
Resolved-in: 23800b61441f9b78d9faec7d034a5544f1c36276
Depends-on:
informally-unblocks:
Pre-conditions:
attribution:
Commit-guidance: backfill of CHANGELOG `## Unreleased` is the one Medium-effort item — content for the entry is the maintainer's editorial call
model-hint: standard
---

# Cluster 08 — docs-drift

## TL;DR

- **Goal:** Eight mechanical edits to README, AGENTS.md, CHANGELOG, and `docs/superpowers/plans/` cleaning up the residue of the CLAUDE→AGENTS rename, the v1.8→v1.9 churn, the embedded-tmux removal, and the desktop wrapper addition.
- **Impact:** Docs become accurate. Today, README links go to a 404, AGENTS.md misdescribes a wired button, CHANGELOG drops two real shipped features, and `package.json` description claims capability the code never had.
- **Size:** Medium (half-day).
- **Depends on:** none
- **Severity:** Medium (highest in cluster)
- **Autonomy (cluster level):** autofix-ready

## Header

> Session size: Medium · Analysts: Docs · Depends on: none · Autonomy: autofix-ready

## Files touched

- `README.md` (2 findings)
- `AGENTS.md` (2 findings)
- `CHANGELOG.md` (2 findings)
- `package.json` (1 finding)
- `tests/fuzz/README.md` (1 finding, in same edit pass as README CLAUDE.md sweep)
- `docs/superpowers/plans/2025-*.md` (1 finding)

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 4 · Low: 4
- autofix-ready: 6 · needs-decision: 2

## Findings

- **README still references the deleted `CLAUDE.md`** — `CLAUDE.md` was renamed to `AGENTS.md` in commit `4422981` on 2026-04-23, but two pointers in `README.md` were not updated. One is a Markdown link with relative href (`[CLAUDE.md](CLAUDE.md)`) — clicking it on GitHub returns 404. The Architecture section's "deeper tour of the codebase" link is the most discoverable on-ramp for new contributors and now leads nowhere.
  - Location: `README.md:181`, `README.md:194`
  - Severity: Medium · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `docs-rename-fallout`
  - Fix: Replace both occurrences of `CLAUDE.md` with `AGENTS.md`; the link target on line 181 becomes `[AGENTS.md](AGENTS.md)`. Cross-check `tests/fuzz/README.md:18` ("Per CLAUDE.md the release protocol is…") as part of the same sweep.
  - Notes: The CHANGELOG itself (line 81, "CLAUDE.md renamed to AGENTS.md.") flags the rename as a 1.8.0 change, so the doc updater knew about the rename but missed the README references. `tests/fuzz/README.md:18` carries the same stale reference and should be swept in the same edit.
  - Raised by: Docs

- **`#btn-session-plus` documented as "currently unwired" but is now wired to desktop window close** — `AGENTS.md` describes `#btn-session-plus` twice as an "unwired placeholder (fate tracked in cluster 11)". The placeholder language is stale: `src/client/ui/topbar.ts:331-335` registers a `click` listener on `btnPlus` that calls `requestDesktopWindowClose()` (imported from `desktop-host.ts`). The `cluster 11` reference also points at the closed `2026-04-21` cluster (resolved in v1.6.x). Anyone reading AGENTS.md to understand the topbar will misinterpret the button's role and may "wire it up" a second time.
  - Location: `AGENTS.md:316`, `AGENTS.md:362`
  - Severity: Medium · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `agents-md-symbol-drift`
  - Fix: Replace the "unwired placeholder" wording with a description that matches the implementation, e.g. on line 316: "The `+` half is `#btn-session-plus`, which closes the desktop window when running under `tmux-term` (calls `requestDesktopWindowClose()` in `src/client/desktop-host.ts`); harmless no-op in the browser." Update line 362 to "left half of the session control; in tmux-term, click closes the desktop window". Drop the `cluster 11` references (closed in 2026-04-21 run, no longer the source of truth).
  - Raised by: Docs

- **`tmux-term` desktop wrapper exists in README but is invisible from `AGENTS.md`** — `README.md:60-87` has a full "tmux-term desktop app" section describing the Electrobun wrapper, the `desktop:dev` and `make tmux-term` commands, the macOS quarantine workaround, and the CEF rendering decision. `AGENTS.md` — the file every coding agent is supposed to read first — never mentions `tmux-term`, `Electrobun`, or `src/desktop/`, and the "Project Structure" tree at lines 71-100 silently omits the entire `src/desktop/` directory (8 tracked files including `auth.ts`, `server-process.ts`, `tmux-path.ts`, `window.ts`, `electrobun-types.d.ts`). An agent dispatched to fix a desktop-only bug starts with no map and no rules.
  - Location: `AGENTS.md:71-100`, `AGENTS.md` (entire file, no `tmux-term` / `Electrobun` / `desktop` mentions)
  - Severity: Medium · Confidence: Verified · Effort: Medium · Autonomy: needs-decision
  - Cluster hint: `agents-md-symbol-drift`
  - Notes: needs-decision because the maintainer should choose how much detail belongs in AGENTS.md vs. a separate `src/desktop/AGENTS.md`. At minimum, the Project Structure tree should list `src/desktop/` and a one-paragraph "Desktop wrapper (`tmux-term`)" section in AGENTS.md should describe the Electrobun toolchain choice, the `desktop:dev` / `make tmux-term` commands, the CEF-on-macOS-and-Linux decision (CHANGELOG 1.9.0 "Changed"), and any "do-not-touch" invariants equivalent to the vendor-xterm rule.
  - Raised by: Docs

- **CHANGELOG `## Unreleased` is empty though there is real shipped post-1.9.0 work** — Two non-trivial changes have landed since v1.9.0 (tagged 2026-04-25 11:50): the tmux scrollbar feature (added 2026-04-25 17:18/19:57; nine commits) and the "remove bundled tmux support" build refactor (commit `67cf30e` on 2026-04-26 10:02). Neither appears under `## Unreleased` (line 3) or any other section. AGENTS.md §Releases (lines 466-485) explicitly mandates writing the section *before* tagging — these will need backfill when v1.10.0 is cut.
  - Location: `CHANGELOG.md:3` (`## Unreleased` heading with empty body)
  - Severity: Medium · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `changelog-backfill`
  - Notes: needs-decision because what to write in the "tmux scrollbar" entry and the "remove bundled tmux support" entry is the maintainer's editorial call, but the slot itself is missing. Cross-check: `docs/superpowers/plans/2026-04-25-themeable-tmux-scrollbar.md` documents the scrollbar plan; `git show 67cf30e` documents the bundled-tmux rollback rationale.
  - Raised by: Docs

- **Duplicate `## 1.5.1 — 2026-04-18` heading in CHANGELOG** — Line 259 and line 261 both carry the heading `## 1.5.1 — 2026-04-18`. The line-259 heading has no body; the line-261 heading has the actual `### Fixed` / `### Internal` content. This is a copy-paste artifact rather than two real release sections. The release workflow (`AGENTS.md:482`) extracts the matching section from `CHANGELOG.md` and uses it verbatim as the GitHub release body — a duplicate heading risks the wrong (empty) section being extracted on a re-tag.
  - Location: `CHANGELOG.md:259`, `CHANGELOG.md:261`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `changelog-backfill`
  - Fix: Delete the empty duplicate heading line at `CHANGELOG.md:259` (and the trailing blank line `CHANGELOG.md:260`); keep the substantive section at line 261.
  - Raised by: Docs

- **README understates the number of built-in themes** — `README.md:25` says: "two built-in themes ('Default' and an AmigaOS 3.1 workbench look)". `themes/amiga/theme.json` declares two themes — `AmigaOS 3.1` (using `amiga.css`) and `Amiga Scene 2000` (using `scene.css`) — alongside the `Default` theme in `themes/default/theme.json`. So the actual count is three. CHANGELOG 1.9.0 explicitly mentions Scene 2000's behaviour ("AmigaOS 3.1 and Amiga Scene 2000 now default to 18.5 pt terminal text").
  - Location: `README.md:25`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `agents-md-symbol-drift`
  - Fix: Update the bullet to "three built-in themes ('Default', 'AmigaOS 3.1', and 'Amiga Scene 2000')." or similar.
  - Raised by: Docs

- **`package.json` description claims "multiple terminal backends" — only one exists** — `package.json:7` describes the project as "Browser-based tmux frontend with multiple terminal backends". The codebase has exactly one terminal adapter: `src/client/adapters/xterm.ts`. AGENTS.md:64 documents the WebGL renderer is the only supported renderer. The "multiple backends" phrasing is leftover from an earlier era when the project intended to support multiple xterm builds; the multi-backend abstraction collapsed into a single concrete adapter.
  - Location: `package.json:7`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `agents-md-symbol-drift`
  - Fix: Change description to e.g. `"Browser-based tmux frontend with embedded xterm.js terminal"` or drop "with multiple terminal backends" entirely. The `TerminalAdapter` interface (`src/client/adapters/types.ts`) is preserved as an abstraction seam, but there are no other concrete adapters in tree.
  - Raised by: Docs

- **`docs/superpowers/plans/` retains two subtly-mis-dated 2025-* plan files** — Plans `2025-02-14-tls-default.md`, `2025-02-14-update-e2e-tests.md`, and `2025-02-17-update-e2e-no-tls.md` are dated 2025 but the project's first commit dates after 2026 (per CHANGELOG and tag history). The `2025-05-15-update-e2e-tls.md` plan is also unusual — its content matches `2026-04-14-tls-default.md` (the actual TLS-default rollout). These misdated plan files are noise for any LLM scanning `docs/superpowers/plans/` chronologically and may be implementation-plan artefacts whose filenames were typo'd — at minimum their relationship to the 2026-04-14 plan is undocumented.
  - Location: `docs/superpowers/plans/2025-02-14-tls-default.md`, `docs/superpowers/plans/2025-02-14-update-e2e-tests.md`, `docs/superpowers/plans/2025-02-17-update-e2e-no-tls.md`, `docs/superpowers/plans/2025-05-15-update-e2e-tls.md`
  - Severity: Low · Confidence: Plausible · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `docs-superpowers-housekeeping`
  - Notes: needs-decision because the maintainer may have intentionally retained these as historical context, or the dates may be intentional. At the LLM-readability layer, either rename to `archived/` / add a "superseded by 2026-04-14-…" note inside, or delete.
  - Raised by: Docs

## Suggested session approach

Subagent-driven mechanical sweep on the six autofix-ready findings; the maintainer call (AGENTS.md tmux-term coverage scope, CHANGELOG Unreleased entries, plans/ housekeeping) is a separate ~30-min interview before the subagent runs the second pass.

Single commit subject `fix(cluster 08-docs-drift, 2026-04-26): sweep stale references after rename / removal cycles` covers all autofix items. The `tmux-term` AGENTS.md section is non-trivial enough to ship as a separate commit once the maintainer drafts the desired scope.
