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

## Part B — Fix coordinator retrospective

_Not yet filled. Append this section when the last cluster from this report has been resolved, deferred, or is stuck behind something outside the fix coordinator's control. Use the template in `references/analysis-analysis-template.md` Part B as scaffolding._

### Run identity (carry from Part A)

```
Skill revision at report time: version:3.7.2 (path:3.7.2)
Skill revision at fix time: <fill in when fix work concludes>
Report directory: docs/code-analysis/{stem}/
Clusters at start: 21
Clusters closed: <fill>
Clusters in-progress: <fill>
Clusters deferred: <fill>
Clusters resolved-by-dep: <fill>
Span of fix work: <first commit date> → <last commit date>
```

### Did the TL;DR block tell the truth?

_Pending fix work._

### Cluster sizing honesty

_Pending fix work._

### Was the `Suggested session approach` useful?

_Pending fix work._

### `Depends-on` edges in practice

_Pending fix work. The single edge declared this run is cluster 20 → cluster 06; verify whether closing 06 made any of cluster 20's findings incidentally resolved._

### Scope-expansion events

_Pending fix work._

### Deferred items

_Pending fix work. No `[~] deferred` items at report time; track whether any clusters convert to deferred during fix work._

### Findings the report missed entirely

_Pending fix work._

### Findings the report had that didn't matter

_Pending fix work._

### Tooling reality

_Pending fix work. Note: `./scripts/render-status.sh .` and `./scripts/validate-frontmatter.sh .` worked on the first try at render time._

### Suggestions for codebase-deep-analysis v-next

_Pending fix work._

### Suggestions for implement-analysis-report v-next

_Pending fix work._
