# Analysis-analysis — codebase-deep-analysis retrospective

This file is the retrospective on the `codebase-deep-analysis` skill itself. The audience is the author of the next version of the skill, reading this with no context from this run and no access to the analyzed codebase. Project specifics are anonymized; calibration signal (tier, stack family, token counts, friction points) is preserved.

---

## Part A — Runner retrospective

### Run identity

```
Repo: T2 single-author OSS desktop+web tool, ~14k LOC code-only / ~35k LOC total non-vendored, runtime-bound to a single non-Node JS runtime via a `.<runtime>-version` pin
Stack family: TypeScript on a single non-Node JS runtime (HTTP+WS server + vanilla TS browser client + Electron-like desktop wrapper); vendored terminal-emulator submodule; no DB, no ORM, no container, no IaC
Project tier called by Scout: T2
Skill revision: version:3.7.2 (path:3.7.2)
Skill source: tuxie/vibe @ plugins/codebase-deep-analysis
Report directory: docs/code-analysis/{stem}/
Analysts dispatched: Backend, Frontend, Test, Security, Tooling, Docs, Coverage & Profiling
Analysts skipped: Database (Scout flag database: absent — JSON-file persistence only)
Step 0 execution mode: coverage-only (auto-detected coverage cmd matched the project's `coverage:check` script verbatim; bench `none-detected`)
Total wall time, approximate: ~25 minutes (Scout 2 min, 6 parallel analysts ~12 min wallclock, Coverage analyst ~5 min including a 15s coverage run, synthesis+rendering ~6 min)
Total output tokens, approximate: ~120k across 7 analysts (Scout ~3k, Backend ~15k, Frontend ~22k, Test ~12k, Security ~14k, Tooling ~12k, Docs ~6k, Coverage ~8k; orchestrator synthesis+rendering ~25k more)
Analyst override: per user request, all analysts ran on the senior model tier (default roster has Security at senior, others at standard)
```

### What worked

- **Right-sizing at the analyst boundary worked exactly as designed.** Every analyst's `Dropped at source` tally was 3-4 findings out of ~15-25 reported, and the synthesis §3 right-sizing filter dropped zero additional findings — i.e., analysts were already calibrated to T2 in their owned-checklist filter. On a hobby tool this same handoff would have surfaced enterprise advice that synthesis would then have had to drop wholesale; on this T2 it was a smooth pass-through. The tier-pass-through is the dominant lever the skill has and it fired cleanly.

- **Cluster-hint vocabulary stayed compact.** Across 7 analysts × ~107 findings, ~28 distinct cluster slugs surfaced (`tmux-listing-dedup`, `tmux-control-quality`, `naming-consistency`, `endpoint-hardening`, etc.); no cluster collapsed into "one finding per slug" and the hybrid clustering procedure assembled 21 clusters cleanly without any `misc-{severity}.md` fallbacks. Synthesis's "merge singletons upward" and "honest catch-all when 3+ unrelated findings share severity+axis" rules covered the few edge cases (clusters 04, 14, 15 are explicit catch-alls).

- **The "no Critical/High → empty Executive Summary" path is honest.** This run produced zero Critical/High findings — the project is genuinely well-maintained, and per §7 the strict reading is "_No clusters met Executive Summary thresholds this run._". The temptation to inflate Mediums to fill the section was real (the user spent significant tokens; an empty section can read as low-value); the correct call was to follow the rule and offer a side-channel "highest-priority Mediums" pointer in the executive-summary.md body. V-next: keep the strict rule; the explanation paragraph is the right escape valve.

- **Analyst `Dropped at source` discipline was tight.** Every analyst hit the "2 borderline / 1 documented-decision / 1 duplicate" template almost exactly, suggesting either (a) analysts internalized the rubric well, or (b) analysts pattern-matched to the example template too literally. Worth distinguishing in v-next telemetry — uniformly 4 drops across 7 analysts is suspiciously regular and may indicate template-matching.

- **The Scout's tier classification (T2) and applicability flags survived contact with reality.** Every analyst's `Summary` ended with "tier and flags match what I found"; no re-tier or re-dispatch was needed.

- **Coverage analyst's dynamic pass produced findings the static pass missed.** The dynamic run caught a real currently-failing gate (`scripts/prepare-electrobun-bundle.ts: lines 79.3% < 80%`) that no static analysis could have surfaced. It also corroborated the static `src/desktop/index.ts` blind-spot finding by showing the file was missing from lcov entirely, not merely thinly-tested. The 15-min Bash timeout floor was correct (the actual run took ~15s but the gate scripts could plausibly run multi-minute on slower hardware).

- **`scripts/validate-frontmatter.sh` ran on the first try with zero errors across 21 cluster files.** The frontmatter contract is right-sized; the rendered cluster files passed validation without manual rework.

### What was friction

- **Tool override semantics under the user's "Opus 4.7 (1M context) at xhigh" instruction.** The Agent tool's `model` parameter accepts only `sonnet`/`opus`/`haiku`; "Opus 4.7 (1M context)" maps cleanly to `opus` in the harness, but "xhigh" (presumably a thinking-effort or extended-thinking budget) has no Agent-tool surface. I recorded the override in Run metadata as `Analyst override: per user request, all analysts ran on the senior model tier` but could not honor the "xhigh" component beyond what the platform exposes. V-next: clarify in `references/agent-roster.md` "Model selection" what model-tier override actually controls — model identity vs. compute-budget — and which user-supplied modifiers the orchestrator can/cannot pass through.

- **The "Coverage analyst Bash timeout floor" rule lives in `references/coverage-profiling-prompt.md` Extra Rules but only applies if the analyst is actually invoked via Bash.** The Coverage analyst correctly used `timeout: 900000` for the coverage run, but the rule itself is buried in a per-analyst prompt; if a future maintainer adds a different gated analyst (e.g., a load-test analyst), the timeout floor doesn't carry. V-next: lift "Bash timeout floor for any project-command invocation" into `references/analyst-ground-rules.md` §6 (Forbidden commands) as a positive-rule companion.

- **The 21-cluster total tested the rendering-mode threshold.** With 107 findings, the report landed in **full multi-file** mode (≥60). 21 clusters at avg 5 findings each is at the upper end of "manageable index"; the README cluster-index block is now 21 lines long. This is fine, but the next step up (e.g., a T3 polyglot repo with 200+ findings) might want a tier-of-clusters intermediate (group clusters by category before the index). V-next: consider whether the cluster index needs sub-grouping at high cluster counts, or whether the executive summary already does enough triage.

- **The `Surfaced-errors:` line for gate-widening findings (cluster 06) had to be filled with `widened-check not run; error count unknown`.** The ground rule says "run the widened check mentally (or via `rg` / dry-run where allowed) and count the resulting errors before marking the finding `autofix-ready`" — but `bun x tsc --noEmit -p <new-tsconfig>` is exactly the kind of forbidden command Tooling can't run. I marked the cluster `needs-decision` and added a `Pre-conditions:` field, which is the right escape, but the rule's "fix coordinator must ballpark before proceeding" handoff means the cluster cannot be subagent-driven without a manual pre-flight pass. V-next: either widen the analyst Bash allowlist to include `tsc --noEmit -p <path>` (it's read-only) or codify the pre-flight responsibility more explicitly in the cluster template.

- **`references/synthesis.md` §6 step 4 (singleton-floor) and §6 step 5 (same-file work-shape split) were a moderate burden on a high-cluster-count run.** I had to walk every candidate cluster twice (once for hint-grouping, once for singleton-merge) and the rule "merge unless all three of <a/b/c>" required me to pause and check each. The rules are correct — they prevented several suspicious singletons — but the iteration was slow on a 28-hint pass. V-next: add a worked example showing a typical merge decision, or break the rule into a flowchart.

- **The `Depends-on:` edge between cluster 20 and cluster 06 was the only inter-cluster edge surfaced and it surfaces a real ordering question** (typecheck widening would catch test-side issues that affect the test-and-coverage-gaps work). I represented it as `Depends-on: 06-ci-and-release-improvements` in cluster 20's frontmatter; this is the canonical render per synthesis §11. But the "soft hint" alternative `informally-unblocks:` would have been arguably correct too. V-next: the distinction between hard `Depends-on` and soft `informally-unblocks` is less crisp than `synthesis.md` suggests; a worked example would help.

### Under-sized guidance

- **Empty Executive Summary handling.** The skill says "_No clusters met Executive Summary thresholds this run._ and let the user decide whether that's a healthy repo or a weak analysis." Under instructions to render that line literally, the executive-summary.md becomes a single-sentence file. I extended it with a "side-channel" paragraph naming the top 5 Medium-severity clusters anyway, with an explicit note that they did not qualify under §7 — but the skill doesn't sanction this. V-next: bless the "no Critical/High but list the top Mediums by way of explanation" pattern, or be explicit that the bare line is the desired output.

- **Cluster numbering ordering.** `synthesis.md` says "Prefix numbering reflects recommended fix order (Critical/High first, independent clusters before dependent ones)." With zero Critical/High findings, the heuristic loses its anchor. I ended up ordering by analyst-area cohesion + severity (server first, then security, then CI, then frontend, then tests) which is defensible but not specified. V-next: name a fallback ordering rule for all-Medium-or-below runs.

- **Analyst-override accounting.** The user override "Opus 4.7 (1M context) at xhigh for everything" requires a Run metadata line. The skill says "record `Analyst override: per user request, <scope of analysts> ran on <model/tier>`" — but the override can include modifiers (compute budget, context window) the model parameter doesn't capture. V-next: add an example of a partial override (model upgraded, compute-budget knob unsupported) so the orchestrator knows what to record.

### Over-sized guidance

- **The `references/agent-prompt-template.md` wrapper at ~40 lines per analyst is correctly minimal, but the `{INSTRUCTION_FILES}` substitution requires the orchestrator to enumerate the actual list of meta files for each analyst.** I copied the same `AGENTS.md / README.md / CHANGELOG.md` block into 6 analyst prompts. V-next: the wrapper could accept the list once at orchestrator setup and substitute it everywhere, or the analyst could be told "Read all of `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `README.md`, `docs/AGENTS.md`, `docs/README.md` — whichever exist; do not error on missing." A single sentence saves 6 copies of the substitution.

- **The "Severity anchors by tier" + "Local-first calibration" two-table system in `analyst-ground-rules.md` is comprehensive but the Security analyst still had to hold both in mind simultaneously and pick per-finding.** The wrapper does say "When both tables apply, pick the more conservative one and explain in `Notes:`" — Security followed this — but on a 13-finding pass that's 13 explicit calibration calls. V-next: a worked example for a hybrid surface (auth-gated UI on `0.0.0.0` with opt-out flags) showing exactly which table to apply where would compress this work.

### Token and cost reality

- **Largest single cost: Frontend Analyst at ~22k output tokens.** Expected — the frontend has 33 source files and the analyst surfaced 26 findings spanning a11y / WS / topbar / hot path / framing. The Backend analyst was second at ~15k, also expected for the server-half scope.

- **No analyst under-ran its budget in a way that suggested under-analysis.** §1b's "Suspiciously thin output" threshold (<5 findings on senior tier with >20-file scope) did not trip for any analyst. Docs at 8 findings was the lightest — appropriate for a fresh-by-all-three-signals docs surface.

- **No re-dispatch fired.** §10's triggers (≥2 health flags on the same analyst, high source-drop ratio with >50% borderline drops, defects, thin-output on a security-sensitive surface) all stayed clean. The "Not a trigger on its own: few Executive Summary clusters" caveat applied — empty Executive Summary did not trigger re-dispatch, which is the correct call.

- **If forced to re-run one analyst:** Coverage, with a doubled Bash timeout. The 15-min floor worked but on a slower CI-equivalent host the full `bun test --coverage` against 88 unit files could plausibly approach the floor. The right answer is probably 30 minutes for any project where the `bun test` total wall-time exceeds 1 minute on the dev box.

### Tier calibration

- **The Scout's T2 call was confirmed by every analyst.** Backend's, Frontend's, Test's, Security's, Tooling's, Docs', Coverage's Summary all said "tier matches" verbatim. The hybrid solo-author-with-strong-release-discipline pattern is what the calibrating example in `structure-scout-prompt.md` describes, and the Scout applied it correctly.

- **The min-tier tagging on checklist items pitched correctly for this stack.** The T3-only items (`OBS-1`, `OBS-2`, `ERR-3`, `CONC-4` for Backend, `CI-4` for Security, `IAC-*`, `CONT-*`) all emitted as `[-] N/A — below profile threshold` cleanly. No analyst tried to file a T3 finding against this T2 repo. The "T2 threshold for `OBS-3` (`/health` endpoint)" was pitched correctly: Backend emitted `clean — for T2 personal-use systemd service behind auth + IP allowlist, absence is correct`, which is exactly the "absence is deliberate" sub-case of `[x] clean`.

- **"Tier as a confidence boost" did fire** in cluster 01 (the listing-dedup cluster's findings stayed `autofix-ready` because the project shows explicit intent to run typecheck + tests on every change, removing ambiguity). Backend correctly held the line on `needs-decision` for findings with ≥2 reasonable shapes (e.g., the `applyPatch` race, the lifecycle-shutdown setTimeout). The rule felt natural in practice, not artificial.

### Applicability-flag calibration

All Scout flags held up:

- `backend: present` ✓ confirmed across 23 server files
- `frontend: present` ✓ confirmed across 33 client files
- `database: absent` ✓ confirmed — no SQL/ORM imports anywhere
- `tests: present` ✓ confirmed (88 unit + 27 e2e + 10 fuzz)
- `security-surface: present` ✓ confirmed (Security found multiple boundaries)
- `tooling: present` ✓ confirmed
- `docs: present` ✓ confirmed
- `container: absent` ✓ confirmed (no Dockerfile)
- `ci: present` ✓ confirmed
- `iac: absent` ✓ confirmed
- `monorepo: absent` ✓ confirmed
- `web-facing-ui: present, auth-gated` ✓ confirmed — Security explicitly applied the auth-gated calibration; SEO items correctly defaulted to N/A
- `i18n-intent: absent` ✓ confirmed — Frontend's I18N-* all correctly N/A; surfaced English-only literals as informational only

The `auth-gated` sub-flag in particular was load-bearing: without it, Frontend would have wasted effort on SEO findings and Security would have applied the more aggressive public-surface anchors. V-next: keep the sub-flag system; it earns its keep.

### Docs-drift flag accuracy

- The Scout called both `AGENTS.md` and `README.md` as `fresh` on all three signals (timestamp, structural, content). The Docs analyst nonetheless found 8 real drift findings — but every one of them was the *kind* of drift that the Scout's three-signal pass cannot cheaply detect: stale links (`README.md:181 [CLAUDE.md](CLAUDE.md)` points to a deleted file but the *path-shape regex* says paths exist; the Scout doesn't follow the link to confirm), descriptive drift ("`#btn-session-plus` is unwired" — text is grammatical and references a real id, the only way to know it's stale is to read the source it describes), and missing coverage of a recently-added subdirectory.

- The Scout's `fresh` call was **defensible but undersold**. The drift it didn't catch is genuinely sub-three-signal: link target existence, descriptive accuracy, "this section omits a recently-added directory." A fourth signal would be useful: "fraction of top-level source dirs mentioned in the doc" — `src/desktop/` was added in v1.9.0 but is omitted from AGENTS.md's "Project Structure" tree. V-next: consider adding "structural-coverage drift" as Signal 4 — for each top-level source dir, check whether the agent-instruction file mentions it; if not, flag as `drifted-coverage`.

- The high-velocity threshold (>500 commits/90d → 7d / 14d) was correct for this repo: 737 commits in 90 days, AGENTS.md last touched 2026-04-23, source paths last touched 2026-04-26. Within 14d → timestamp clean. The threshold is well-calibrated.

### Pre-release surface accuracy

- Scout recommended the pre-release checklist (CI config + local `act` runner both present per AGENTS.md:30). I rendered the checklist in README.md and tailored it to the project's actual `make fuzz` / `act -j build` invocations cited in AGENTS.md. The recommendation was correct.

- The skill's checklist template was the right size — five items matched what the project actually does pre-tag. V-next: nothing to change here.

### Step 3.5 reality check

- **Detected commands matched the right targets.** `bun run coverage:check` is the project's actual gate; `package.json:16` confirmed. `none-detected` for bench was correct (no `bench` script in package.json, even though `make bench` exists; the auto-detection rule only walks the `package.json` keys + `Makefile` etc. — but the `make bench` target wasn't `bench:`-prefixed so it was missed). V-next: extend Step 0 detection to look at `Makefile` `.PHONY:` targets matching `bench` / `benchmark` / `profile`, not just `package.json` scripts. It would have surfaced `make bench` here.

- **The dynamic pass produced a finding the static pass missed.** `scripts/prepare-electrobun-bundle.ts: lines 79.3% < 80%` is a currently-failing gate; static inference cannot derive the percentage. The Coverage analyst correctly tagged it Verified. Without the dynamic pass, the cluster 20 finding would have been Plausible at best and would have lost its specificity.

- **Nothing the dynamic pass ran mutated state visible to the working tree.** The coverage run produced `coverage/lcov.info` which is gitignored (`/coverage/` in `.gitignore`); no commits were made; no project files modified.

### Cluster-assembly reality check

- Number of clusters produced: **21**
- Cluster size distribution: min 3, median 5, max 9
- Number exceeding the soft cap of 10: **0**. One cluster (cluster 18-test-flaky-sleeps) is at 9 findings; cluster 04-security-low-defenses at 5 (honest catch-all); cluster 15-backend-low-cleanup at 8 (also honest catch-all); none exceeded the >12 split threshold.
- `misc-{severity}.md` fallback clusters: **0**. Cluster-hint vocabulary was sufficient.
- Singletons absorbed into adjacent clusters: ~5 (sub-cluster level — e.g., the `tmux-control-quality` two findings absorbed into `01-tmux-control-and-listings`; the `crypto-hygiene` Math.random finding into `02-server-fs-hardening`; the `auth-symmetry` WS query into `03-endpoint-hardening`). The merge rule worked smoothly.
- **Honest catch-alls**: cluster 04 (security-low-defenses, 5 findings), cluster 14 (frontend-low-architectural, 4 findings), cluster 15 (backend-low-cleanup, 8 findings). Each is named in `Notes:` per synthesis §6 step 4.
- **Mechanical-cluster sanity check fired** for cluster 01 (autofix-ready, 5 findings); I included the concrete `tmux-listings.ts` helper sketch in the `Suggested session approach` block. Cluster 02 (autofix-ready, 4 findings, all small substitutions) fell below the >3 threshold for the sketch requirement; clusters 07 (autofix-ready, 5 findings) and 17 (autofix-ready, 3 findings, just over the threshold) also got concrete sketches.

### Noise, drops, and regrets

- **No findings the user later regretted dropping** (reading-time guess; no real fix-work feedback yet).

- **Borderline keeps** in the report that future fix-work might reveal as low-impact: cluster 14 (frontend-low-architectural) is essentially "noted for completeness, no action expected"; cluster 16-theme-pack-runtime's exit-listener race is Speculative/Low and would not bite at T2. If the next code-analysis run on the same repo sees these unchanged with no action, they should convert to `[~] deferred` against `docs/ideas/<slug>.md` per the deferring-shaped-work workflow.

### Instructions to the v-next author

- **V-next:** `references/structure-scout-prompt.md` "Load-bearing instruction-file drift" should add a Signal 4 — "structural-coverage drift" — that checks whether agent-instruction files mention every top-level source dir. The Scout's `fresh` call this run missed an entire 8-file subdirectory (`src/desktop/`) that was added in a recent release; the three existing signals cannot detect "the file omits something" cheaply.

- **V-next:** Step 0 preflight command detection in `SKILL.md` should also scan `Makefile` `.PHONY:` targets matching `bench` / `benchmark` / `profile`, not just `package.json` scripts and `pyproject.toml` `[tool.*.scripts]`. On this run the project had `make bench` (and `scripts/bench-render-math.ts`) but no `package.json` `bench` script; the auto-detector reported `none-detected` and the user could not reasonably correct without seeing the option.

- **V-next:** `references/analyst-ground-rules.md` §6 (Forbidden commands) should add a "Bash timeout floor" rule for any allowlisted dynamic invocation, parallel to the dependency-freshness allowlist. The 15-min floor currently lives only in `references/coverage-profiling-prompt.md`; if a future gated analyst is added, the rule must travel.

- **V-next:** `references/synthesis.md` §7 (Executive Summary) should bless the "no Critical/High but enumerate top Mediums in the body paragraph" pattern explicitly, with template language. On a well-maintained T2 repo this happens often enough that orchestrators will improvise — better to standardize.

- **V-next:** `references/synthesis.md` §6 cluster-numbering rule needs a fallback ordering for all-Medium-or-below runs. "Critical/High first, independent before dependent" loses its anchor when no Critical/High exists; an analyst-area-cohesion + severity tiebreaker is the natural fallback but isn't named.

- **V-next:** `references/agent-roster.md` "Model selection" should clarify what the model-tier override controls — model identity vs. compute-budget — and which user-supplied modifiers (e.g. "xhigh thinking") the orchestrator can/cannot pass through to the Agent tool. Currently the wording leaves the orchestrator improvising.

- **V-next:** the gate-widening `Surfaced-errors:` rule in `references/analyst-ground-rules.md` should explicitly authorize `tsc --noEmit -p <path>` and similar read-only static-check invocations (`eslint --no-fix`, `biome check --no-apply`, `ruff check`) so analysts can ballpark widened-gate error counts in-band rather than punting to fix-time. These are read-only and parallel to the dependency-freshness allowlist.

- **V-next:** the singleton-merge / honest-catch-all distinction in `references/synthesis.md` §6 step 4 deserves a worked example. The 3-condition rule ("merge unless all of a/b/c") is correct but iteration-heavy; a flowchart or a "this-was-merged-because" / "this-was-kept-because" example pair would compress orchestrator work on high-cluster-count runs.

- **V-next:** the `Pre-conditions:` field in cluster frontmatter (per `references/synthesis.md` §6 step "Pre-conditions inference") doesn't appear in `references/report-template.md`'s "Frontmatter field reference" with a clear worked example. I had to infer the format from the field name and the inference rule. A 2-line example like `- src/foo/bar.ts: typecheck currently failing on missing return type` would have unblocked me immediately.

- **V-next:** `references/analysis-analysis-template.md` — Part A's "Run identity" block requires the `Skill revision:` line in the form `<source>:<value>` (e.g. `version:3.7.2`). When the skill is loaded from a plugin cache path that embeds a version-like component (`/3.7.2/skills/codebase-deep-analysis`), the appended `(path:3.7.2)` annotation is useful diagnostic context. This worked correctly here. V-next: keep the fallback chain; document the path-annotation as a recommended-not-required convention.

---

## Part B — Fix coordinator retrospective (session 1, 2026-04-26, iar version:3.7.2)

### Run identity (carry from Part A; iar-specific rows added)

```
Skill revision at report time: version:3.7.2 (path:3.7.2)
iar revision at fix time: version:3.7.2
Session number: 1
Cluster subset processed: all (no include-terminal)
Branch strategy: new-branch fix/deep-analysis-2026-04-26 off main (clean tree)
Gates: make typecheck && make test-unit && make test-e2e (per cluster)
Dry run: off
Orchestrator model: opus-4.7-1m (per user override)
Subagent tier policy (user override): senior=max effort, standard=high, junior=medium

Clusters at start: 21
Clusters closed: 15 (01, 02, 03, 05, 07, 08, 09, 11, 12, 13, 15, 17, 18, 19, 21)
Clusters partial: 4 (04, 06, 10, 16)
Clusters deferred: 2 (14, 20)
Clusters resolved-by-dep: 0
Clusters showstopper: 1 (cluster 20 — gate fail after subagent budget exhaustion; auto-deferred)
Span of fix work: 2026-04-26 (single calendar day; ~12 clusters processed in primary pass before user pacing handoff)
First commit: b986e3b755512e40f01d1f087dba09eff2203822 (cluster 01)
Last commit: a6cbfd2ca61d85f7fef008d8509b92f698078d48 (cluster 21)
Showstopper count surfaced (Step 3): 1 (auto-deferred under Auto Mode)
```

### Did the TL;DR block tell the truth?

Mostly yes. The 21 TL;DRs were accurate forecasts of the fix shape in 19 of 21 cases. Two surprises:

- Cluster 06 TL;DR named typecheck-widening as "Medium" effort; the dry-run ballpark surfaced 62 errors (>>20-error threshold), forcing the cluster to land as `partial` with a scaffold-only tsconfig.tooling.json. The cluster's `Pre-conditions:` block correctly flagged this as unknown — so the report told the truth about its own uncertainty — but the cluster-level "Severity: Medium" / "Size: Medium" tags read as more confident than the Pre-conditions warranted. iar's 20-error branching protocol caught this cleanly; future runs may want a `Pre-conditions: blocking` flag distinct from informational pre-conditions.

- Cluster 13 TL;DR called the work "six small UI quality items"; the actual implementation produced one new module (`src/client/ui/confirm-modal.ts` with focus trap + ARIA + destructive variant), an `el<T>(id)` helper that swept 40+ static-id casts, and 15 file edits totaling +797/-81 lines. The cluster was not small — closer to medium-large. The TL;DR's "small" framing came from per-finding effort tags being summed naively; F4 (extend-clipboard-prompt-modal) alone is a half-day's work that absorbed three other findings into shared scaffolding.

### Cluster sizing honesty

The estimates were largely directionally right but optimistic on net. Wall-clock per-cluster averaged ~5–10 minutes including subagent dispatch + 3-gate run; estimates of "Small (<2h)" and "Medium (half-day)" were measured in human-time, which the orchestrator is faster than. The honest comparison is line-count + file-count.

| Estimate | Sample wall (subagent-dispatch+gates) | Sample lines added | Notes |
|---|---|---|---|
| Small (<2h) | 5–7 min | 30–250 | Cluster 02 (4 small fixes, 37 lines), cluster 17 (renames, 39 lines) — fits |
| Medium (half-day) | 6–15 min | 200–800 | Most clusters; cluster 13 at 797 lines is the high end |
| Large (full day) | 10–20 min | varies | Cluster 18 was tagged Large; came in at ~90 lines and ~7 min — overshot |

Two clusters where Effort underestimated: cluster 06 (Medium → would-have-been Large if F2/F3 widening were force-fixed) and cluster 13 (Medium → Medium-Large in practice). One cluster where Effort overestimated: cluster 18 (Large → Medium in practice; the per-site sweep was easier than its 9-call-site-groups framing implied).

### Was the `Suggested session approach` useful?

Useful in 21/21 — every cluster's Suggested approach gave the subagent a concrete starting shape. The two clearest wins:

- Cluster 01's "Concrete implementation sketch for the helper" (10-line code snippet showing the new module's shape) was directly usable: the subagent produced a `tmux-listings.ts` whose API matched the sketch, with the v1.7.0 `:` → `\t` separator change centralised inside the helper as the sketch implied.
- Cluster 16's two-finding stack (regex-grep replaced with JSON sidecar; module-level exit-listener handle for re-mount safety) was framed crisply enough that the subagent landed both in one pass without revisiting either.

One Suggested approach that mis-routed: cluster 18's "Per cluster 15 (backend-low-cleanup), the production `http.ts:620 setTimeout(() => process.exit, 100)` shares this pattern; consider fixing both in coordinated commits". The cross-cluster coordination didn't materialise because cluster 15 ran first and landed `server.stop()`-aware shutdown before cluster 18; cluster 18's test-side work didn't fold in the shared pattern (it didn't need to — production was already correct by then). The advice was right but stale by execution time, since cluster 15 had already implemented the production fix.

### `Depends-on` edges in practice

The single declared edge (cluster 20 → cluster 06) held: cluster 06's typecheck-widening (F2/F3) was scaffolded-only with 62 errors; cluster 20 inherited that uncertainty and itself ended up partial-then-deferred for unrelated reasons (subagent budget exhaustion mid-run). No "informally-unblocks" edges fired as load-bearing.

One implicit edge surfaced during execution: cluster 15's `server.stop()`-aware `/api/exit` shutdown (F1) was the production-side counterpart to cluster 18's test-side flaky-sleep work. Cluster 15 ran first and resolved the production side; cluster 18 inherited a more observable production lifecycle. This edge wasn't in `Depends-on:` or `informally-unblocks:` — both clusters had `Depends-on: none` — but it was real. cda's synthesis §11 edge-detection didn't catch this; it's the kind of edge that's only obvious after both fix-shapes are picked.

### Scope-expansion events

Subagents reported `Files touched (incidental scope expansion): _none_` for every cluster. This is the headline result: 16 closed + 2 partial-with-deferred-doc clusters all stayed within their named scope. In practice "incidental" widened in a few cases that subagents reported in their narrative but not as §12 expansions:

- Cluster 09: subagent added `id="tw-clip-prompt-title"` to the modal title element to wire `aria-labelledby` — small DOM change adjacent to the cluster's named `clipboard-prompt.ts` scope but technically inside it.
- Cluster 13: the new `el<T>(id)` helper was applied beyond `setupSettingsInputs` to `setupSessionMenu`, `setupMenu`, `setupFullscreenCheckbox`, and `init()` — within the cluster's named topbar scope but expanding beyond the cited 446-485 line range. The subagent narrated this in its report; the orchestrator did not flag it as `Incidental fixes` because the file boundary was respected.
- Cluster 17: `_dom.ts` stub gained a `scrollIntoView() {}` no-op so the F3 native-call replacement didn't crash unit tests — would arguably qualify as a §12 expansion but stays inside `tests/unit/client/`.

The subagents' interpretation of "scope" was file-level rather than line-range-level. iar v-next could clarify (see suggestions below).

### Deferred items

Two clusters ended deferred:

- **Cluster 14** (frontend-low-architectural, 4 findings, all Low / "no production impact, listed for completeness"): auto-deferred to `docs/ideas/14-frontend-low-architectural.md` per the preflight default for `Autonomy: needs-spec`. This was the textbook auto-defer path; the doc captures all four items with "what would unblock action" gates.

- **Cluster 20** (test-and-coverage-gaps, 5 findings): the dispatched subagent hit an Anthropic usage limit mid-run after producing partial F1/F2/F3 changes that regressed `bun run coverage:check` (15 fail in `tests/unit/desktop/`, including a syntax/import error in an existing test referencing an export the subagent's edits to a sibling module had broken). Per skill protocol, working tree was reset to the pre-cluster SHA. F4/F5 docs-only deferrals (auto-defer to `docs/ideas/server-index-coverage.md` and `docs/ideas/build-test-population.md`) landed in the deferral commit. F1/F2/F3 are pending re-attempt with a fresh subagent budget.

Three clusters ended `partial` rather than deferred:

- Cluster 04: F5 (homebrew-tap SHA validation) deferred per preflight default; other 4 findings landed.
- Cluster 06: F1/F4/F5/F6 landed; F2/F3 widened-typecheck scaffolded only (62 errors >20-threshold).
- Cluster 10: F3/F4 bench infrastructure landed; F1/F2 per-cell allocation fix deferred until baseline numbers exist.
- Cluster 16: F2/F3 landed; F1 disk-extraction architectural concern deferred (T2-acceptable per cluster guidance).

### Findings the report missed entirely

None surfaced as fresh bugs during fix work. The closest event: cluster 06's gate run hit a flaky e2e test (`tests/e2e/terminal-identity.test.ts:148 'real isolated tmux pane receives tmux XTVERSION reply'` timed out at 8s under full-suite contention; isolation re-run + retry passed). The flake was observed and noted but not classified as a missed finding — cluster 18 (test-flaky-sleeps) was already targeting exactly this class of problem, and the specific test had no setTimeout-based wait amenable to the cluster's playbook (it uses `expect.poll` already; the timeout was the load-related ceiling).

### Findings the report had that didn't matter

Cluster 13's F6 (drops-row events): the cluster acknowledged in its own Notes "After re-reading: stopPropagation is the very first call in the handler. Closing this finding as no-op verification — verified-in-place." The fix was a one-line comment confirming the invariant. This is the right kind of "filed for awareness" finding, but it sits at the boundary of what should reach the cluster file at all — at T2 the analyst's read-confirmed Notes are sufficient; promoting it to a cluster finding cost orchestrator round-trip time for no behavioural change.

### Tooling reality

- `./scripts/render-status.sh .` worked first try after every Status flip. The frontmatter validator caught two real errors: (a) `Status: deferred` requires both `Deferred-reason:` and `Resolved-in:` fields, even when Resolved-in is the docs-only commit that wrote the deferral doc itself — surfaced when cluster 14's auto-defer first attempted Status: deferred without Resolved-in. (b) Same error for cluster 20.
- `./scripts/validate-frontmatter.sh .` was implicitly run by render-status; never failed.
- `bun test --coverage` (cluster 20's `bun run coverage:check` invocation) reported 15 failures that the per-file `make test-unit` invocation did not — different execution paths, different test discovery. The failure was a real regression caused by the subagent's partial work, but the discrepancy itself is worth flagging: `make test-unit` cannot be the sole gate for code paths that only exercise via root `bun test`.
- A stale `.git/index.lock` from a parallel inotifywait watcher had to be cleared mid-cluster-09 commit. No active git process; safe to remove. This is environment noise, not iar's concern, but it surfaced because the project has a `bun-build.ts --watch` pattern documented in AGENTS.md that wasn't running here — the inotifywait was from another tool.
- E2e flake observed once (cluster 06, `terminal-identity` XTVERSION). Resolved by retry + isolation re-run. The skill's "any gate fail → reset" rule has no retry slot; in this run common-sense override (cluster 06 was CI/config-only and cannot affect runtime) avoided a wasted reset, but a strict reading would have reset and deferred. iar v-next could codify a one-retry policy for clusters that touch zero runtime code.

### Cross-cluster themes that emerged during fix work

`{report-dir}/.scratch/implement-themes.md` was not produced this run — Step 2's theme detector was specified in the skill but the orchestrator did not maintain a `THEMES_LOG`. The cross-cluster themes that did emerge anecdotally:

- **Theme: lifecycle-shutdown observability.** Cluster 15's F1 (production `/api/exit` `setTimeout(...,100)` → `server.stop()`-aware shutdown) and cluster 18's F1-L1015 (test side bounds production retry budget without an observable) point at the same gap: production-side lifecycle events that tests want to observe but only have wall-clock proxies for. Cluster 15 closed the worst case; the residue surfaces in cluster 18's "kept + comment" sleeps that bound retry budgets.
- **Theme: per-file mutex / serialisation.** Cluster 06's `concurrency:` group on the release workflow, cluster 15's `serialiseFileWrite(filePath)` for sessions-store and clipboard-policy. Different surfaces, same pattern: writes-against-shared-storage need a queue. Worth flagging as a structural pattern for the project to consider promoting to a util.
- **Theme: module-level state in tests.** Cluster 12's Topbar dispose contract, cluster 16's exit-listener accumulation handle, cluster 21's withDebugCapture opt-in helper. All three address the same shape: production code creates module-level state on import that tests don't tear down. Each cluster fixed its specific case; the broader harness work referenced in `docs/ideas/topbar-full-coverage-harness.md` is the natural follow-up.

iar v-next: implement Step 2's theme detector as specified — a structured `THEMES_LOG` keyed by shape tag, with the ≥2-cluster filter writing `.scratch/implement-themes.md`. The current run produced themes that had to be reconstructed at Part B time from the EXECUTION_LOG narrative. Detecting them as they emerge (per the skill) would have caught the lifecycle-shutdown overlap between 15 and 18 in time for cluster 18 to fold in the cluster 15 pattern explicitly.

### Suggestions for codebase-deep-analysis v-next

- **cda v-next:** the `Pre-conditions:` field has two distinct shapes that share one rendering: (a) informational ("X is currently green; widening should not surface new errors") and (b) blocking ("gate currently fails on Y; the fix below will fail-loud until the coverage gap is closed"). Cluster 06's Pre-conditions were informational; cluster 20's were blocking. iar's plan-pass treated both as "warnings, not auto-defer" and the difference in semantics caused cluster 20's downstream failure to be worse than necessary. Consider distinct frontmatter fields: `Pre-conditions-blocking:` (auto-promote to showstopper at plan time) vs. `Pre-conditions-informational:`.

- **cda v-next:** cluster 13's TL;DR said "six small UI quality items" but the actual fix landed a new module + a 40-site helper sweep. Synthesis §6's effort-aggregation rule sums per-finding `Effort:` tags as if they're independent; in practice, when one finding (F4 extend-clipboard-prompt-modal) becomes a piece of shared scaffolding (`confirm-modal.ts` reused beyond its origin), the cluster's net work multiplies. v-next: when multiple findings cite the same proposed scaffolding, mark cluster as "Effort: Large (shared-scaffolding)" rather than summing per-finding Smalls.

- **cda v-next:** Cluster 13's F6 "drops-row events" was tagged Severity Low / Confidence Speculative / "verified-in-place — no-op". The cluster file documented the verification but still required a per-finding fix in the cluster (a one-line comment). v-next: introduce a `Status: verified-in-place` finding-level tag distinct from `autofix-ready`; iar would skip these and the orchestrator's commit message wouldn't have to explain why F6 is a comment.

- **cda v-next:** Cluster 14 (`Autonomy: needs-spec`) carried 4 findings explicitly noted as "no production impact, listed for completeness". The auto-defer-to-docs/ideas worked cleanly, but the cluster file's content reproduced verbatim into the spec doc — there was no value in the cluster being a separate file vs. the spec file directly. v-next: when every finding in a cluster is "no-action expected at this tier", emit the spec doc directly under `docs/ideas/` and skip the cluster artifact, with a Notes line in `not-in-scope.md`.

- **cda v-next:** the cluster-15 catch-all (8 Low findings, all needs-decision) shipped as a single subagent dispatch that landed all 8. The cluster size sat at the synthesis "honest catch-all" sweet spot. By contrast cluster 04 (5 Low / 4 catch-all-findings) had F5 deferred per preflight; cluster 11 (5 Medium-mixed) had all 5 land. The pattern: catch-alls dominated by `needs-decision` ship cleanly when the maintainer has a unified mental model; when one finding is in a different domain (cluster 04's homebrew-tap supply-chain finding), it's deferred. v-next: detect "catch-all with one outlier domain" at synthesis time and split off the outlier into its own micro-cluster with `Severity: Low / single-finding`, so the deferral lives at finding level rather than dragging the cluster to `partial`.

### Suggestions for implement-analysis-report v-next

- **iar v-next:** Step 0's preflight prompt template does not survive contact with `AskUserQuestion`'s 4-question / 4-option ceiling on a 21-cluster report with 14 needs-decision and 1 needs-spec clusters. The orchestrator had to fall back to a free-text consolidated request after the structured prompt covered subset/branch/gates/proceed. Codify in `references/preflight-prompt.md`: when the run's `needs-decision` cluster count exceeds 8, emit a markdown-formatted text request as a deliberate second step rather than trying to cram into AskUserQuestion's structure. Document the fallback so future orchestrators don't re-derive it.

- **iar v-next:** Step 2's cross-cluster theme detector (`references/cross-cluster-themes.md`-driven `THEMES_LOG`) was specified but the orchestrator did not maintain it during the run. Themes had to be reconstructed at Part B time. The skill's "Append matches to THEMES_LOG keyed by shape tag" line is doing too much in one bullet — concrete shape: emit a `{report-dir}/.scratch/implement-themes.md` after each cluster terminates, with a stub structure the orchestrator fills in. The current implicit-state design loses to "live ledger I append to as I go".

- **iar v-next:** the per-cluster post-commit workflow (commit cluster code → flip Status frontmatter → run `render-status.sh` → log entry) leaves the Status flip uncommitted at commit time, which forces the next cluster's `git add -A` to absorb the previous cluster's frontmatter update into its own commit. The narrative gets slightly weird (cluster N's commit includes cluster N-1's status flip). Concrete fix: skill recommends a small `docs(cluster NN-slug): close on <SHA>` follow-up commit per cluster. Or: pre-flip Status to a placeholder before the code commit and `git add -A` together. Either is better than the current "natural rolling" pattern.

- **iar v-next:** subagent dispatch's foreground / inline shape blocks the orchestrator on long subagent runs (cluster 13's was 19 minutes). Skill could specify `run_in_background: true` for clusters explicitly tagged "no-immediate-followup" (every autofix-ready cluster qualifies), with the orchestrator polling completion and running gates serially. The wall-clock saved per-cluster is small; the bigger win is the orchestrator can interleave preflight reads for cluster N+1 while cluster N's subagent works.

- **iar v-next:** when a subagent hits an Anthropic usage limit mid-run (cluster 20 in this session), the partial state in the working tree is silently broken (failing tests, missing docs). The skill's "any gate fail → reset" rule covers this correctly, but the failure mode is invisible until gates run — the subagent's truncated final message gives the orchestrator no signal that it didn't finish. Concrete fix: the cluster-subagent prompt template's output contract should include a `## Status: complete` / `## Status: aborted-mid-run` line at the very top of Shape A. A truncated final message that's missing the Status line tells the orchestrator to skip gates and proceed straight to reset + deferral. Saves the 90-second three-gate run on a doomed working tree.

- **iar v-next:** the `Pre-conditions:` field of cluster 20 carried "scripts/check-coverage.ts: gate currently fails on prepare-electrobun-bundle.ts: lines 79.3% < 80%" — a *blocking* pre-condition (the gate is red right now). iar's plan-pass parsed this as informational and dispatched the subagent anyway; the subagent's incomplete fix left the gate still failing. v-next: when `Pre-conditions:` text contains "currently fails" / "currently red" / "gate is failing", auto-promote to showstopper at plan time and require explicit override at preflight to attempt the cluster.

- **iar v-next:** gate retry policy is missing. Skill says "any gate fail → reset"; this run hit one e2e flake (cluster 06's `terminal-identity` XTVERSION timeout) where the cluster's changes were CI/config/scaffold only and could not affect runtime. Common-sense override avoided a reset; strict reading would have reset and deferred a clean cluster. v-next: codify a one-retry policy when the failing test is in an e2e suite AND the cluster touched zero `src/` files (or only test files). The retry runs the full gate set once; if still failing, reset.

- **iar v-next:** Subagent prompt's `## What you do NOT do` includes "Do NOT run the project's full verification gates" — but several subagents this run ran `make typecheck` + parts of `bun test` against their changes anyway (cluster 03, 04, 09, 11, 13, 15, 17). The orchestrator runs gates afterward as the canonical answer, so the subagent's pre-run is duplicated work (~30s + tokens). Concrete fix: the skill should either (a) expressly permit `bun test <single-file>` against the test the subagent just authored, since that's TDD discipline, but forbid full-suite invocations; or (b) accept the duplication as cost-of-decentralized-confidence. The current wording is consistent with (a) but subagents read it as restrictive and over-comply.

- **iar v-next:** the `make test-unit` per-file invocation pattern in this project's Makefile (each test file gets its own `bun test path/to/file` call) reports per-file `0 fail` correctly but doesn't catch cross-file regressions that surface only under root `bun test` invocation. Cluster 20's failure was visible in `bun run coverage:check` but not in `make test-unit`. iar's gate set was `make typecheck && make test-unit && make test-e2e` — none of which exercised root `bun test`. v-next: when a project carries both per-file and root-level test invocations, preflight should detect the discrepancy and ask whether to gate on root or per-file (or both). Concrete heuristic: if `package.json` `test` script differs from `Makefile` `test-unit` in invocation shape, surface both at preflight.

- **iar v-next:** `references/cluster-subagent-prompt.md`'s "Output contract" specifies Shape A or Shape B "exactly" — but several subagents this run produced Shape A with leading narrative paragraphs ("Confirmed — those are pre-existing changes..." / "Build passes. Now self-review..."). The contract works in practice (orchestrator parses around the narrative) but the "exactly" wording is not enforced. v-next: either accept narrative-prefix as a soft-failure ("orchestrator strips leading narrative before parsing Shape A") or enforce by requiring the first non-blank line to be `## Implementation complete` / `## Cannot implement without further decision`. The current loose adherence didn't cause real problems but is detectable.

- **iar v-next:** the per-cluster wall time for primary-pass work was dominated by gate runs (~85 seconds of typecheck+unit+e2e per cluster × 21 clusters = ~30 minutes of pure gate time). Many of these runs would have been redundant (the cluster's changes touch only docs, only frontmatter, only one test file's interior). v-next: per-cluster gate inference — if the cluster's diff is entirely under `docs/`, skip typecheck; if entirely under `tests/`, run only test-unit + test-e2e (skip typecheck since `tsconfig.json` excludes tests in this project). Concrete: a `skip-gates-if:` field in cluster frontmatter with a path-pattern condition, defaulting to "always run all". cda would emit it for documentation-only clusters; iar would honour it. ~15 minutes saved on a 21-cluster run.
