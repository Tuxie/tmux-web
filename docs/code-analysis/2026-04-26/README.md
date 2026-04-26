# Codebase Analysis — 2026-04-26

> **Heavy token usage.** Before kicking off a brainstorming session from any cluster here, confirm that weekly quota has spare headroom — follow-up sessions can easily spend as much as this analysis did.

## Project tier: **T2**

Solo maintainer (one author) and no team-coordination infrastructure (no SECURITY.md, no CODEOWNERS, no issue templates) — but strong release/deploy primary signals: MIT LICENSE, multi-job GitHub Actions release workflow, 36 release tags, maintained CHANGELOG.md, Homebrew packaging artifact, systemd unit files, Electrobun desktop deploy target. 737 commits in the last 90 days, latest 2026-04-26. Coordination shape is deploy/release-shaped, not team-shaped — textbook T2 "serious OSS" pattern. Every finding below was filtered through this tier; "below profile threshold" exclusions reflect items requiring T3-only infrastructure (SLOs, distributed tracing, multi-environment deploy promotion).

## Run metadata

- Repo: `/src/tmux-web`
- Git head: `67cf30e` on branch `main`
- Working tree at analysis time: **clean**
- Analysts dispatched: Backend, Frontend, Test, Security, Tooling, Docs, Coverage & Profiling
- Analysts skipped: Database (Scout flag `database: absent` — no SQL/ORM; persistence is JSON file)
- Scope overrides: none
- Re-dispatch passes: none (synthesis §1b health check passed for all analysts; no triggers fired)
- Analyst override: per user request, all analysts ran on Opus 4.7 (1M context). Default roster tiers (Backend/Frontend/Test/Tooling/Docs/Coverage = standard, Security = senior) replaced for this run. The override does not disable the senior re-dispatch escalation rules; no analyst tripped them this run.
- Right-sizing filter: 0 dropped, 0 fix-rewritten, 0 below-threshold, 0 stylistic, 0 rule-restatement (analysts already calibrated to T2 in their owned-checklist filter; the synthesis filter was a no-op this run, which is the desired outcome on a well-maintained repo). See `not-in-scope.md`.
- Analyst health: all outputs within expected ranges (no thin-output / clean-sweep / over-Plausible / Autonomy-inflation flags).
- Coverage & Profiling: ran in `coverage-only` mode. Coverage command `bun run coverage:check` (auto-detected, confirmed in `package.json:16`) executed once with 15-min timeout. Bench `none-detected` — skipped per spec.
- Rendering mode: full multi-file (107 total findings post-synthesis, T2).
- Report directory: `/src/tmux-web/docs/code-analysis/2026-04-26`
- Scout map: `.scratch/codebase-map.md`

## Tech stack (excerpt)

TypeScript on Bun (`.bun-version` pin) — server uses native `Bun.serve<WsData>` HTTP+WS, client is vanilla TS + vendored xterm.js (git submodule, sentinel-pinned), desktop wrapper is Electrobun 1.16.0. Single runtime dependency: `@noble/hashes` for BLAKE3-keyed clipboard policy. Tests: `bun test` (unit), Playwright (e2e), `fast-check` (fuzz) — fuzz dir excluded from default `bun test` via `bunfig.toml [test] root = "tests/unit"`. Build orchestrator: GNU Make (`Makefile`), final binary via `bun build --compile --minify --bytecode`.

Entry points: `src/server/index.ts:484` (CLI main), `src/client/index.ts:62` (browser), `src/desktop/index.ts:34` (Electrobun). Full map in `.scratch/codebase-map.md`.

## Index

- [Executive summary](./executive-summary.md) — top clusters per synthesis §7 (none qualified; see file for explanation)
- [Themes](./themes.md) — cross-cutting patterns
- **Clusters** (ordered by recommended fix sequence; regenerate with `./scripts/render-status.sh .` from this report's directory after flipping any cluster's `Status:`; this validates frontmatter before rewriting):

<!-- cluster-index:start -->
- [Cluster 01 — tmux-control-and-listings](./clusters/01-tmux-control-and-listings.md) — Extract a single `tmux-listings.ts` helper that the six current inline `list-sessions` / `list-windows` / `display-message` parsers across `http.ts` and `ws.ts` collapse into; fix two `ControlClient` correctness issues uncovered while reading those call sites. · **closed** · autofix-ready (resolved-in b986e3b755512e40f01d1f087dba09eff2203822)
- [Cluster 02 — server-fs-hardening](./clusters/02-server-fs-hardening.md) — Apply four small defensive improvements to the server's filesystem and probe surfaces — true LRU on the origin-reject map, exclusive-create on the TLS keypair temp file, drop the never-used multi-key warn-times Map shape, replace `Math.random` token with `crypto.randomBytes`. · **closed** · autofix-ready (resolved-in 00d1a308917235de3a6838807b0f663a42d59b5c)
- [Cluster 03 — endpoint-hardening](./clusters/03-endpoint-hardening.md) — Tighten authenticated HTTP/WS endpoints whose post-auth amplifiers chain into denial-of-service or session hijack on a single stolen credential. · **closed** · needs-decision (resolved-in a6ed60debe2d81babd6006ffda07d18731b5e3d9)
- [Cluster 04 — security-low-defenses](./clusters/04-security-low-defenses.md) — Five small Security findings that share severity (Low) and decision axis (defence-in-depth, not load-bearing) but live in unrelated subsystems — OSC-title trust, --reset TLS verification, IPv6 allowlist canonicalization, homebrew-tap supply chain. · **partial** · needs-decision (partial: 0fe9ad1dccf16cb3d65649dc6598e848428b80ea (partial — F5 homebrew-tap SHA validation deferred per 2026-04-26 preflight decision))
- [Cluster 05 — ci-artifact-verification](./clusters/05-ci-artifact-verification.md) — Add a post-package smoke test that exercises the actual `tmux-web` binary users download, plus close the macOS coverage-gating gap. · **closed** · needs-decision (resolved-in 6b66b81e13812e1d57bd73b4bfc4e71c67b0f3eb)
- [Cluster 06 — ci-and-release-improvements](./clusters/06-ci-and-release-improvements.md) — Bring CI's typecheck and fuzz/e2e gating closer to local `make` parity, plus add a workflow `concurrency:` group to prevent racing tag pushes. · **partial** · needs-decision (partial: 5752a225fd667d0272257d61510447432f927dc4 (partial — F2/F3 widened-typecheck scaffolded as tsconfig.tooling.json with 62 surfaced errors > 20-error threshold; not wired into make typecheck or release.yml. F1, F4, F5, F6 fully landed.))
- [Cluster 07 — release-pipeline-hygiene](./clusters/07-release-pipeline-hygiene.md) — Five small mechanical edits to dev wrappers, systemd unit files, and packaging artifacts left stale by recent rename / removal cycles, plus a one-patch dependency bump. · **open** · autofix-ready
- [Cluster 08 — docs-drift](./clusters/08-docs-drift.md) — Eight mechanical edits to README, AGENTS.md, CHANGELOG, and `docs/superpowers/plans/` cleaning up the residue of the CLAUDE→AGENTS rename, the v1.8→v1.9 churn, the embedded-tmux removal, and the desktop wrapper addition. · **open** · autofix-ready
- [Cluster 09 — frontend-a11y](./clusters/09-frontend-a11y.md) — Three a11y fixes covering form-control labelling, modal focus trap, and dynamic button defaults. · **open** · autofix-ready
- [Cluster 10 — bench-baseline-and-hot-path](./clusters/10-bench-baseline-and-hot-path.md) — Add a measurement loop for the WebGL render-math hot path and address the per-cell allocation pattern that flows through it. · **open** · needs-decision
- [Cluster 11 — frontend-ws-and-input](./clusters/11-frontend-ws-and-input.md) — Five frontend findings covering WS error reporting, send-while-not-OPEN UX, client input parser bounds, protocol framing fallback semantics, and per-input PUT request fan-out. · **open** · needs-decision
- [Cluster 12 — frontend-topbar-teardown](./clusters/12-frontend-topbar-teardown.md) — Bring the Topbar's lifecycle into the project's `__twDispose` teardown contract, plus close two small Topbar-state edge cases. · **open** · needs-decision
- [Cluster 13 — frontend-ui-quality](./clusters/13-frontend-ui-quality.md) — Six small UI quality items: slider reset clamp, type-cast density in topbar id-lookup, low-info boot toast, native confirm() destructive dialogs, drag-overlay state, drops-row event ordering. · **open** · needs-decision
- [Cluster 14 — frontend-low-architectural](./clusters/14-frontend-low-architectural.md) — Four architectural notes flagged for completeness — desktop-host messaging shape, WS auth fallback (Firefox-only), toast singleton state, i18n absence. · **open** · needs-spec
- [Cluster 15 — backend-low-cleanup](./clusters/15-backend-low-cleanup.md) — Honest catch-all for seven Backend Low-severity findings sharing the "needs-decision" axis but no other natural topical home — startup probes, lifecycle shutdown, PTY env, sessions-store concurrency, clipboard-policy hash caching, body reader cancel timeout. · **open** · needs-decision
- [Cluster 16 — theme-pack-runtime](./clusters/16-theme-pack-runtime.md) — Three findings about the embedded-theme runtime — bundled themes are extracted to `tmpdir()/tmux-web-themes-${pid}` on startup with a process exit listener; the xterm sentinel SHA is recovered by regex-grepping a 1.5 MB bundle though `bun-build.ts` already has it; the `materializeBundledThemes` exit listener could accumulate on test re-mounts. · **open** · needs-decision
- [Cluster 17 — naming-consistency](./clusters/17-naming-consistency.md) — Three small consistency cleanups: pick one spelling for sanitize/sanitise, fix the lone `.ts` extension import among 30+ `.js`-extension imports, replace the only `as any` cast in the client surface with the now-supported native call. · **open** · autofix-ready
- [Cluster 18 — test-flaky-sleeps](./clusters/18-test-flaky-sleeps.md) — Replace ~17 raw `setTimeout` waits in `ws-handle-connection.test.ts` and four e2e specs with event-driven or poll-with-condition completion signals, where signals exist. · **open** · needs-decision
- [Cluster 19 — test-assertion-quality](./clusters/19-test-assertion-quality.md) — Replace `expect(true).toBe(true)` tautologies and weak `toBeDefined()` assertions with concrete observables; fix one mock-float pattern flagged as fragile. · **open** · needs-decision
- [Cluster 20 — test-and-coverage-gaps](./clusters/20-test-and-coverage-gaps.md) — Close coverage-gate blind spots — the gate currently fails one file (`prepare-electrobun-bundle.ts`), is structurally blind to files no test imports (`src/desktop/index.ts`), and the empty `tests/unit/build/` directory next to a load-bearing `bun-build.ts` is an attractive nuisance. · **open** · needs-decision
- [Cluster 21 — test-organisation](./clusters/21-test-organisation.md) — Seven small organizational test improvements: stale `PORTS.md` row, mixed `.test.ts`/`.spec.ts` extensions undocumented, e2e helpers cleanup swallow, console-silencer fragility, fuzz-coverage strengthening, missing fuzz file for `ControlParser`, e2e webServer ergonomics. · **open** · needs-decision
<!-- cluster-index:end -->

- **By analyst** (for traceability, not for reading end-to-end): [backend](./by-analyst/backend.md) · [frontend](./by-analyst/frontend.md) · [database](./by-analyst/database.md) · [tests](./by-analyst/tests.md) · [security](./by-analyst/security.md) · [tooling](./by-analyst/tooling.md) · [docs](./by-analyst/docs.md) · [coverage-profiling](./by-analyst/coverage-profiling.md)
- [Checklist](./checklist.md)
- [META-1 draft rules](./meta.md)
- [Out of scope](./not-in-scope.md)

## How to use this report

1. Read the executive summary (note: empty this run; jump to the cluster index above for prioritization).
2. Pick one cluster. Open its file. Start a brainstorming session against that cluster alone — do not try to bundle clusters.
3. When a cluster's status changes, flip `Status:` inside the cluster file and set `Resolved-in:` to the merging commit SHA (or form `SHA (partial — <blocker>)` for `partial`). Then from this report's directory run `./scripts/render-status.sh .` to validate the frontmatter and regenerate the index block above. **Do not edit the index by hand** — it will drift. The scripts were copied into this report at render time, so you can run them without the skill repo on disk.

## Commit conventions

Every commit resolving a cluster (fully or partially) follows these rules:

1. **Subject line names cluster slug and date:** e.g., `fix(cluster 03-endpoint-hardening, 2026-04-26): tighten /api/exit and OSC52 read bounds`. This lets `git log --grep='cluster 03'` navigate the report later, and lets `Resolved-in:` stay machine-findable.
2. **Incidental fixes section.** If the fix had to touch code outside the cluster's named scope to pass a verification gate (typecheck, lint, existing tests), add an `Incidental fixes` section listing each extra file with a one-line reason. See `synthesis.md` §12 for when this is legitimate.
3. **Do not name `Depends-on:` in the commit message** — that relationship is carried by the cluster file's frontmatter, not the git log. If the fix also resolved a finding from another cluster (via `Depends-on:` chain), flip that downstream cluster to `Status: resolved-by-dep` separately; synthesis §11 covers the semantics.
4. **`informally-unblocks:` edges are not named in commits either.** They are soft ordering hints, not promises.

Per-cluster files only add commit-message guidance when there's cluster-specific context (expected scope expansion, a `Depends-on:` chain to traverse, a known-hairy `Incidental fixes` set).

## Pre-release verification checklist

This repo has both CI config (`.github/workflows/release.yml`, `.github/workflows/bump-homebrew-tap.yml`) and a documented local CI-equivalent runner (`act` per AGENTS.md:30, `make fuzz`, `make typecheck`, `make test`). Before tagging a release:

- [ ] Run `act -j build --matrix name:linux-x64 -P ubuntu-latest=catthehacker/ubuntu:act-latest` against the release workflow on a throwaway branch. Catches workflow-level typos before they fail the real push.
- [ ] Run `make fuzz` locally — `tests/fuzz/` is intentionally excluded from CI's `bun test` (see `bunfig.toml`); regressions in security-sensitive parsers (shell quoting, sanitisation, OSC52 framing, origin parsing) only surface here. See cluster 06.
- [ ] Verify the commit(s) resolving closed clusters (see index above) are all on the release branch.
- [ ] Confirm no cluster still `in-progress` is a release blocker.
- [ ] Confirm `not-in-scope.md` "Deferred this run" entries are either still deferred-on-purpose or have tracking tickets.
- [ ] (Per cluster 05 outcome) Once a packaged-tarball smoke test exists, ensure it runs as part of the release workflow before publishing.
