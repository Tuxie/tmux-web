# Codebase Analysis — 2026-04-28

> **Heavy token usage.** Before kicking off a brainstorming session from any cluster here, confirm that weekly quota has spare headroom — follow-up sessions can easily spend as much as this analysis did.

## Project tier: **T1**

Single-author project (1 unique git contributor). Zero coordination infrastructure — no SECURITY.md, CONTRIBUTING, CODEOWNERS, CODE_OF_CONDUCT, issue templates, or PR templates. Rich docs (CHANGELOG, multi-job CI, AGENTS.md) are the hallmarks of a well-maintained solo project, not team coordination signals; primary signals (LICENSE present, multi-job CI, CHANGELOG.md, 41 release tags) coexist with a complete absence of team-level coordination infra. Per the Scout's signal-weighting rule, secondary signals (rich docs, strong tests) describe author discipline, not project tier — every finding below was filtered through T1.

## Run metadata

- Repo: `/src/tmux-web`
- Git head: `67b1fac` on branch `main`
- Working tree at analysis time: **clean**
- Analysts dispatched: Backend, Frontend, Styling, Accessibility, Test, Security, Tooling, Docs Consistency
- Analysts skipped: Database (database: absent — no SQL/NoSQL dep, in-memory `sessions-store.ts` only), Coverage & Profiling (skipped per user directive: `skip coverage`)
- Scope overrides: none
- Analyst overrides: Coverage & Profiling skipped per user request
- Re-dispatch passes: none
- Analyst tiers: Scout=Standard (sonnet); Backend, Frontend, Styling, Accessibility, Test, Tooling, Docs=Standard (sonnet); Security=Senior (opus, default per roster). All `Tier path: default`. All `Effort: default`.
- Right-sizing filter: 4 borderline-dropped, 0 fix-rewritten, 0 below-threshold (analysts already filtered at source per T1 rule), 0 stylistic, 0 rule-restatement, 1 deferred-with-tracking — see [Out of scope](./not-in-scope.md) for detail.
- Analyst health: all outputs within expected ranges.
- Skill revision: `version:3.10.1`
- Rendering mode: compact multi-file (51 findings post-filter, tier T1).
- Report directory: `docs/code-analysis/2026-04-28/`
- Scout map: `.scratch/codebase-map.md`

## Tech stack (excerpt)

TypeScript everywhere on Bun 1.3.13 (pinned in `.bun-version`). Browser-targeted xterm.js client built from a vendored submodule (`vendor/xterm.js`, npm `@xterm/xterm` is explicitly forbidden by `bun-build.ts`). Server is a Bun HTTP+WebSocket process driving tmux via control mode. Desktop wrapper via Electrobun 1.16.0. Tests: 162 files across `tests/unit/`, `tests/e2e/` (Playwright 1.59.1), `tests/fuzz/` (fast-check 4.7.0), `tests/post-compile/`. Single runtime dep: `@noble/hashes ^2.2.0`. Sole CSS pipeline: hand-written `src/client/base.css` + per-pack themes injected at runtime via `theme.ts` `applyTheme()`. CI: `.github/workflows/release.yml` (multi-job), `fuzz-nightly.yml`, `bump-homebrew-tap.yml`. Local CI-equivalent runner: `act` referenced in `Makefile:84` and `AGENTS.md`.

Entry points: `src/server/index.ts:50` (server bootstrap), `src/client/index.ts:1` (browser bundle), `src/desktop/index.ts:34` (desktop main), `bun-build.ts:1` (build pipeline). Full Scout map: `.scratch/codebase-map.md`.

## Index

- [Executive summary](./executive-summary.md) — top clusters per synthesis §7 (none qualified this run; see file)
- [Themes](./themes.md) — cross-cutting patterns
- **Clusters** (ordered by recommended fix sequence; regenerate with `./scripts/render-status.sh .` from this directory after flipping any cluster's `Status:`):

<!-- cluster-index:start -->
- [Cluster 01 — async-fire-and-forget](./clusters/01-async-fire-and-forget.md) — Wrap fire-and-forget async calls in `void` and surface their errors so silent rejection on PTY/topbar/font-load paths can no longer hide bugs. · **open** · needs-decision
- [Cluster 02 — test-sleep-poll-cleanup](./clusters/02-test-sleep-poll-cleanup.md) — Replace fixed sleeps in unit/integration tests with explicit completion signals (event resolves, fake timers, exported retry constants) where they exist; for genuinely event-less paths, document the necessity and replace magic literals with imported production constants. · **open** · needs-decision
- [Cluster 03 — a11y-and-aria-coherence](./clusters/03-a11y-and-aria-coherence.md) — Close keyboard-and-AT gaps in the topbar/menu/modal surface (button names, Escape on settings, label association, native-select duplicate, toast live region). · **open** · needs-decision
- [Cluster 04 — css-housekeeping](./clusters/04-css-housekeeping.md) — Drop dead/duplicate CSS markers and centralise the topbar height token so structural changes touch one declaration, not eighteen. · **open** · needs-decision
- [Cluster 05 — html-injection-and-csrf-chain](./clusters/05-html-injection-and-csrf-chain.md) — Close the JSON-into-`<script>` injection that turns "auth'd page" into "kill-the-server-via-XSS" in combination with `/api/exit` + WS resource saturation. · **open** · needs-decision
- [Cluster 06 — ci-and-build-artifact-verification](./clusters/06-ci-and-build-artifact-verification.md) — Make CI exercise the actual artifact users receive on every release leg, and stop `bun-build.ts` from silently shipping a stale client bundle when the build fails. · **open** · needs-decision
- [Cluster 07 — security-low-defenses](./clusters/07-security-low-defenses.md) — Tighten file modes, add minimum-effort security headers, drop password-in-userinfo on the desktop URL, and fuzz the two remaining security-sensitive parsers. · **open** · needs-decision
- [Cluster 08 — doc-drift](./clusters/08-doc-drift.md) — Mechanical AGENTS.md / README corrections where prose drifted past code (reconnect flow, theme defaults, topbar height, CLI option metavars). · **open** · autofix-ready
- [Cluster 09 — backend-correctness-micro](./clusters/09-backend-correctness-micro.md) — Bundle of small backend cleanups: per-pool naming fix, timing-safe consistency on the desktop bearer, sync stat-walk on every drop, tmux.conf path quoting, jsdom dev-dep bump, and `as any` Bun-API gaps acknowledged. · **open** · needs-decision
- [Cluster 10 — frontend-correctness-micro](./clusters/10-frontend-correctness-micro.md) — Frontend cleanups: dedupe the `currentSession` derivation, decide on the server-side root cause for `stripTitleDecoration`, fix `clientLog` Basic-Auth bypass, and tighten xterm-adapter `any` types where vendor types are available. · **open** · needs-decision
- [Cluster 11 — typecheck-tests-gap](./clusters/11-typecheck-tests-gap.md) — Extend `tsc --noEmit` typecheck to `tests/**` so type drift in test fakes is caught in CI. · **deferred** · needs-decision
<!-- cluster-index:end -->

- **By analyst** (for traceability, not for reading end-to-end): [by-analyst](./by-analyst.md) (single file; one H2 per analyst).
- [Checklist](./checklist.md)
- [META-1 draft rules](./meta.md)
- [Out of scope](./not-in-scope.md)

## How to use this report

1. Read the executive summary (this run: zero clusters qualified — read it anyway, the explanation matters).
2. Pick one cluster. Open its file. Start a brainstorming session against that cluster alone — do not bundle clusters.
3. When a cluster's status changes, flip `Status:` inside the cluster file and set `Resolved-in:` to the merging commit SHA (or form `SHA (partial — <blocker>)` for `partial`). Then from this report's directory run `./scripts/render-status.sh .` to validate the frontmatter and regenerate the index block above. **Do not edit the index by hand** — it will drift. The scripts were copied into this report at render time, so you can run them without the skill repo on disk.

## Commit conventions

Every commit resolving a cluster (fully or partially) follows these rules:

1. **Subject line names cluster slug and date:** e.g., `fix(cluster 05-html-injection-and-csrf-chain, 2026-04-28): …`. This lets `git log --grep='cluster 05'` navigate the report later, and lets `Resolved-in:` stay machine-findable.
2. **Incidental fixes section.** If the fix had to touch code outside the cluster's named scope to pass a verification gate (typecheck, lint, existing tests), add an `Incidental fixes` section listing each extra file with a one-line reason. See `synthesis.md` §12 for when this is legitimate.
3. **Do not name `Depends-on:` in the commit message** — that relationship is carried by the cluster file's frontmatter, not the git log. If the fix also resolved a finding from another cluster (via `Depends-on:` chain), flip that downstream cluster to `Status: resolved-by-dep` separately.
4. **`informally-unblocks:` edges are not named in commits either.** They are soft ordering hints, not promises.

## Pre-release verification checklist

This repo has both CI config (`.github/workflows/release.yml`, `.github/workflows/fuzz-nightly.yml`, `.github/workflows/bump-homebrew-tap.yml`) and a local CI-equivalent runner (`act`, referenced in `Makefile:84` and `AGENTS.md`). Before tagging a release:

- [ ] Run the local runner against the release workflow on a throwaway branch. Catches workflow-level typos before they fail the real push.
- [ ] Verify the commit(s) resolving closed clusters (see index above) are all on the release branch.
- [ ] Confirm no cluster still `in-progress` is a release blocker.
- [ ] Confirm `not-in-scope.md` "Deferred this run" entries are either still deferred-on-purpose or have tracking tickets.
