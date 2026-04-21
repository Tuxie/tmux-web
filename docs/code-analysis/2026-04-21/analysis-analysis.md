# analysis-analysis.md

Retrospective on the `codebase-deep-analysis` skill itself, written from inside a real run. Addressed to the author of the next version of this skill — not to the user of the current report.

This repo is anonymized for the v-next reader in the spirit of the template's writing rules. Specifics that matter for calibration (tier, stack, size, token costs) are preserved; specifics that identify the project are generalized.

---

## Part A — Runner retrospective

### Run identity

```
Repo: T2 browser-frontend for an established CLI tool, ~48k non-vendored LOC,
      single-maintainer high-velocity (~450 commits/90d). TS throughout,
      server + SPA client in one repo, single static-binary distribution model.
Stack family: Bun (server + build + test) + TypeScript + vendored DOM library via git submodule
              (WebGL rendering); Playwright for E2E; Node stdlib http/https + ws package.
Project tier called by Scout: T2
Skill revision: UNKNOWN — skill was loaded from a plugin cache directory that contained no
  `.git/`. `git -C <skill-repo> rev-parse --short HEAD` produced no output. This is a real
  problem for v-next diffing and is noted as a V-next action below.
Skill source: plugin cache (tuxie/vibe-style layout at plugins/codebase-deep-analysis)
Report directory: docs/code-analysis/{date}/
Analysts dispatched: Backend (Sonnet), Frontend (Sonnet), Test (Sonnet),
  Security (Opus), Tooling (Sonnet), Docs (Sonnet), Coverage & Profiling (Sonnet,
  dynamic pass with second-consent).
Analysts skipped: Database (absent flag — no DB surface).
Step 3.5 consent: granted — user explicitly specified the coverage command was
  `bun test --coverage` (different from the `coverage:check` script the orchestrator
  had detected from package.json). See "Step 3.5 reality check" below.
Total wall time, approximate: ~45 minutes orchestrator wall-clock (user-facing);
  analyst agents ran in parallel so total analyst time was smaller than sequential would be.
Total output tokens, approximate: not instrumented by orchestrator. Largest single
  subagent output (Backend) produced a fully-realized set of 8 findings + 60+ checklist
  lines in a single message — roughly 5-7k tokens. Frontend was comparable but larger
  (22 findings, 4k+ tokens of finding bodies). Opus Security was dense but surprisingly
  compact (6 findings, ~3k tokens). Total estimate across 7 analysts: 30-45k output tokens
  of analyst work, plus comparable input tokens for prompt assembly (big templates per-agent).
```

### What worked

- **The Scout on Haiku is a real win.** The Structure Scout prompt, 150 lines long and packed with specific checks (tier signal collection, applicability flags, docs-drift, pre-release surface), executed cleanly on Haiku in a single pass and produced a complete, accurate tier call with signal-cited rationale. This is the single most prompt-efficient step in the skill — the scout did not get confused by the large budget, and the structured output slotted directly into the orchestrator's downstream scope-resolution logic.
- **The right-sizing filter at synthesis §3 paid off even on a well-maintained repo.** Four findings dropped at that layer (two stylistic inline-style carve-outs, two rule-restatements) — exactly the shape of noise that accumulates in long reports. Without §3 these would have bloated the clusters with non-actionable items and reduced the signal density of the whole report. On a T2 repo the filter was gentle; I expect it to be doing heavy work on T1 projects.
- **Cluster-hint vocabulary held up well across 7 analysts.** Hints were consistent enough — `ws-router-cleanup`, `xterm-adapter-patches`, `topbar-rewrite`, `coverage-gaps`, etc. — that clustering was natural rather than forced. Only a handful of singleton hints (`drop-path-privacy`, `stale-artifacts`) needed rehoming. The controlled-vocabulary instruction in `references/agent-prompt-template.md` line 140 ("Cluster-hint sprawl. Keep cluster-hint labels to a small controlled vocabulary per analyst run") was load-bearing — analysts clearly read and applied it.
- **The "Security Analyst on Opus by default" escalation paid for itself.** Opus produced the TOCTOU finding between BLAKE3 pin and OSC 52 reply, which is exactly the kind of cross-step threat-model observation that Sonnet regularly misses. Without Opus, the six Low security findings would have been three or four, and the most subtle one would be gone.
- **The Step 0 token warning plus second-consent gate at Step 3.5 was exactly right.** Users should be warned twice — once at dispatch, once before dynamic execution. The template's insistence on keeping the two consents separate (per "Common mistakes: Rolling Step 3.5 consent into the Step 0 token warning") felt pedantic reading the SKILL.md but was correct in practice — the user wanted to clarify the exact command before consenting to the dynamic pass, which is the shape of decision that shouldn't be pre-approved.
- **The `[?]` vs `[~]` distinction (synthesis §8) came up zero times this run and that's fine.** On a well-maintained T2 repo with active dev, there were no deferred findings — all actionable items landed in clusters. The distinction exists to support harder cases; absence here is not a signal against it.

### What was friction

- **The prompt template's "Copy the text between the fences into the Agent prompt" instruction is expensive.** Seven analyst dispatches, each with a ~130-line prompt template (base) + per-agent OWNED_CHECKLIST_ITEMS inlined (50-90 lines each). Total prompt-token cost was significant — back-of-napkin 5-8x analyst-side output. V-next should seriously consider a mechanism for analysts to read a canonical ground-rules file from `references/` at dispatch time rather than having the full rules pasted into every prompt. A single `references/analyst-ground-rules.md` + per-agent scoping prompt would cut dispatch cost by roughly half.
- **Tools deferred behind `ToolSearch` surprised me.** `AskUserQuestion`, `TaskCreate`, `TaskUpdate`, `TaskList` were not loaded at session start — I had to `ToolSearch` for them before I could ask the user for Step 0 consent. The SKILL.md does not say this will happen. V-next: either `references/structure-scout-prompt.md` or the SKILL.md should warn the runner "Step 0's user prompt requires AskUserQuestion; fetch the schema via ToolSearch before attempting." Hit twice during this run.
- **`references/agent-roster.md` does not split `scripts/` between Backend and Tooling ownership.** I assigned it to Tooling on instinct because build scripts feel like tooling, but `scripts/check-coverage.ts` is really owned by Coverage & Profiling, and a `scripts/bench-render-math.ts` would be owned by Frontend/Backend depending on target. V-next: add a one-liner to the roster making explicit that `scripts/` files are owned by whichever analyst is closest to the target of the script, with a default of Tooling.
- **`references/report-template.md` cluster-index lifecycle is ambiguous when `scripts/render-status.sh` lives in the *skill repo* rather than the analyzed repo.** The template tells the user "run `scripts/render-status.sh <report-dir>`" but the script is not in the analyzed repo — it's in the skill. If the user does not have the skill repo cloned, the instruction is dead. V-next: either (a) copy `scripts/render-status.sh` into `docs/code-analysis/{stem}/` at Step 5 rendering time, making the report directory self-contained; or (b) document explicitly that the script is in the skill package and name a canonical way to invoke it (e.g., `~/.claude/plugins/cache/.../scripts/render-status.sh`).
- **Step 3.5 consent path required re-asking after the user supplied a different coverage command than the orchestrator detected.** I detected `bun run coverage:check` from `package.json` and offered it; user clarified "I use `bun test --coverage`". Had to re-issue the consent prompt with the corrected command. V-next: `references/coverage-profiling-prompt.md` step 1's `{DETECTED_COVERAGE_CMD}` placeholder should have a "user override" fallback, and the Step 0 token warning could mention "the skill will detect coverage/bench commands automatically but will confirm with you before running them — if the detected command is wrong, you can correct it at the consent prompt."
- **Singleton clusters (1 finding) felt wrong but the synthesis guidance allows them.** I produced three clusters with single findings (`drop-path-privacy` merged upward, but `15-fuzz-gaps`, `16-bench-and-stale-artifacts` stayed as semi-singletons). Synthesis §6 says "A cluster of 15+ is almost always two clusters wearing a trench coat" — good rule — but says nothing about the opposite problem. V-next: either explicitly permit singleton clusters for self-contained work, or introduce a floor rule like "singleton clusters are OK only if the finding's fix is genuinely its own session; otherwise merge upward."
- **The rendering pass (Step 5) is *enormous*.** Roughly 30 files written, most containing overlapping content (cluster findings + by-analyst duplicates + checklist re-emission). On this T2 run this felt proportionate. On a T1 repo with 10 findings I suspect the multi-file structure would be overkill. V-next: consider a single-file report mode for low-finding runs (<15 findings total), gated on the Scout's tier + finding-density call.

### Under-sized guidance

- **"Severity: relative to project tier" is correct in principle but under-operationalized.** Analysts rated the same shape of finding differently ("sendBytesToPane no timeout" was Medium, "safeStringEqual length leak" was Low; both are Low-practical-risk but different analysts picked different anchors). V-next: either give more explicit tier-calibrated severity anchors in `agent-prompt-template.md`, or accept analyst disagreement and rely on synthesis §2's "take the highest" rule more visibly.
- **The `Depends-on:` field's format is under-specified.** The template says `cluster {slug}` or `finding {id-or-anchor}` but does not say how synthesis should render that edge across the directory structure. I ended up writing "Depends on: cluster 01-ci-coverage-gate" in TL;DR blocks, which works, but v-next should pick one canonical format and specify it in `references/report-template.md`.
- **No explicit guidance on handling an analyst's cross-scope slip** (Backend Analyst cited `applyColourVariant` which is in `src/client/`). Minor, not a defect, but the synthesis §8 "Validate checklist integrity" list doesn't address "finding cited the wrong scope". I treated it as a minor-but-noted problem in the checklist; v-next could either add a "cross-scope cite" category under §8 or explicitly note it's not tracked.
- **Executive Summary threshold vs. re-dispatch criterion mismatch.** Synthesis §7 requires ≥1 High/Critical per cluster for inclusion; §10 triggers re-dispatch if <3 Executive Summary clusters surface on a non-trivial codebase. On this T2 run, only 2 clusters qualified — the real ceiling, not a weakness. I did not re-dispatch. V-next: §10's criterion should explicitly distinguish "few exec summary clusters because the repo is genuinely clean" from "few exec summary clusters because the analysts under-analyzed" — perhaps the `clean-sweep ratio` health check from §1b is the better trigger, not the exec summary count.

### Over-sized guidance

- **`references/report-template.md` cluster file template has a `## Commit-message guidance` section that mostly restates itself across clusters.** On 16 cluster files, I wrote essentially the same three bullets ("Name the cluster slug and date", "Incidental fixes section if applicable", "no Depends-on:") with minor variations. Reader value of the section drops to near-zero after the second cluster. V-next: either (a) move this block to the README once ("all clusters follow this convention"), or (b) make the per-cluster block conditional on the cluster having interesting commit-message considerations (e.g., Depends-on chains, expected scope expansion).
- **The by-analyst files feel redundant against clusters for this scale of report.** Every finding is in exactly one cluster; every by-analyst section is a table of `→ see cluster NN` pointers. The traceability argument is valid, but on a report where every analyst has <10 findings, a single "findings by analyst" table in the README index would serve the same purpose in 1/7 the file count. V-next: consider collapsing `by-analyst/` into a single `by-analyst.md` for runs where the total analyst-finding count is under some threshold (maybe 60).
- **`Work-avoidance self-check (MANDATORY)` table at the bottom of every analyst prompt.** Good self-check rubric, but every analyst reported something like "within expected ranges" (or didn't report at all); the rubric is not load-bearing output — it's a bar the analyst should have self-cleared before submitting, not a reporting surface. V-next: move the table to `references/analyst-ground-rules.md` (see first friction bullet) and have analysts only output a single line like "Self-check: clean" unless something tripped.

### Token and cost reality

- **Backend + Frontend were the two largest single analyst costs.** Both Sonnet. Backend: 8 findings + deep checklist (~7-8k output tokens). Frontend: 22 findings, wider scope, more granular checklist (~8-9k output tokens). Both expected given scope.
- **Security on Opus was compact.** 6 findings, ~3k output tokens. Opus was efficient here — the escalation was worth the cost-per-token for the cross-step threat model observation, but the volume was smaller than feared.
- **No analyst appeared suspiciously thin.** All 7 analysts returned at least 5 findings except Security (6) and Coverage/Profiling (8); all were proportional to scope. No re-dispatch was triggered.
- **Did §10 re-dispatch fire? No.** Exec summary landed at 2 clusters (below the <3 criterion) but health checks were clean and the shortage reflected genuine repo health, not analyst under-analysis. Skipping re-dispatch was correct; the §10 criterion is over-broad on well-maintained repos.
- **If I had to re-run one analyst with different instructions, it would be Tooling.** The `Dropped at source: 7` vs 6 reported findings flagged in the §1b health check — I walked the drop breakdown, concluded all 7 were legit clean verdicts, and accepted. But in hindsight Tooling's format-switch to a "| Item | Status | Finding |" table instead of the canonical checklist-line shapes made the §8 validation harder. V-next: `references/agent-prompt-template.md` should explicitly reject table-form checklists in favor of the canonical `[x] / [x] clean / [-] N/A / [?] / [~]` line shapes.

### Tier calibration

- **Scout's T2 call matched the rest of the run perfectly.** All analysts flagged items at T3 (ERR-3, OBS-1/2, CI-4) as N/A; no analyst emitted a finding above T2 without explicit counter-evidence. No re-tiering needed.
- **Min-tier tags on checklist items were pitched correctly for a Bun+TS stack.** No "Rust without clippy" analog — Bun-idiomatic linting is the type system itself (tsc --noEmit), and the project does check types in CI. A future calibration note: T2 Bun-native projects legitimately have less tooling than T2 Node projects because bun includes what Node requires external tools for — the TOOL-1 item's "npm + pnpm + bun" example anchored the right intuition here.
- **"Tier as a confidence boost on autonomy" fired.** Several autofix-ready findings on Medium/Low items (window-parse fix, method guards, LOCALHOST_IPS merge) were correctly marked autofix-ready rather than needs-decision because the repo's patterns were clear and the fix was mechanical. Template guidance at `references/agent-prompt-template.md` "Tier as a confidence boost on autonomy, not only a filter" was internalized by analysts — the only pushback is that I can't easily tell from the output whether they read the guidance or arrived at the same conclusion independently.

### Applicability-flag calibration

All Scout-set flags matched what analysts found. Specifically:

- `backend`, `frontend`, `tests`, `security-surface`, `tooling`, `docs`, `ci` — all `present`, correct.
- `database` — `absent`, correct; no DB surface in the repo.
- `container`, `iac` — both `absent`, correct.
- `monorepo` — `absent`, correct (single workspace).
- `web-facing-ui` — `present`, but with the nuance that the UI is auth-gated. The Frontend Analyst correctly flipped SEO items to N/A with the "auth-gated terminal, no crawlable surface" reason. V-next: consider adding an explicit `ui-auth-gated` sub-flag under `web-facing-ui` so Frontend can treat `{SEO_TRIGGER: auth-gated}` as a default state rather than re-deriving the intent per run.
- `i18n-intent` — `absent`, correct (no locales dir, no framework, English-only UI).

No flag was wrong in hindsight.

### Docs-drift flag accuracy

- Scout flagged `Docs drift: fresh` — CLAUDE.md last touched today, recent references. **Analyst disagreed materially.** The Docs Consistency Analyst found three drift items (keyboard scope, theme-switch semantics, DOM contract) that were introduced by v1.6.0 and v1.6.1 additions to the code without corresponding CLAUDE.md updates. The Scout's timestamp-based "fresh" call was technically correct (CLAUDE.md was recently touched) but structurally wrong (the touches didn't cover the v1.6.0 feature surface).
- **V-next: the 30d/90d threshold in `structure-scout-prompt.md` "Load-bearing instruction-file drift" is a blunt instrument on high-velocity repos.** A solo maintainer making 450 commits in 90 days touches CLAUDE.md occasionally for micro-edits (a typo, a rename) while adding feature surface elsewhere; the "fresh" signal is false-positive-prone. V-next: supplement the timestamp heuristic with a "does the doc's sections still match the file structure it references" check — at minimum, compare doc file paths against the actual file tree and flag the doc `likely-drifted-structurally` if ≥20% of referenced paths have moved. Or just trust the Docs analyst more and weight Scout's call less.

### Pre-release surface accuracy

- Scout recommended `yes` — both CI workflow and `act`-based local runner are present. **Correct.** The resulting README checklist block reads meaningfully given the repo's CLAUDE.md-documented "run `act` before pushing a release tag" protocol.

### Step 3.5 reality check

- Detected coverage command (`bun run coverage:check`) was almost-right but not what the user actually uses (`bun test --coverage`). Re-ask cycle above.
- Dynamic pass produced meaningful findings the static pass would have missed: COV-1b (`xterm.ts` at 61%/72% — static inference would have marked it "has test imports so probably covered" but the real numbers tell a different story); COV-2b (the `/api/terminal-versions` and `POST /api/exit` endpoints have test imports but no actual hits). Both upgraded from static-Plausible to dynamic-Verified.
- Nothing the dynamic pass ran mutated state beyond the expected `coverage/` directory writes (Bun's own coverage emitter). The "read-only" invariant held modulo the known Bun-internal scratch files — which themselves surfaced as PROF-2.
- The gate paid a dividend on this run.

### Cluster-assembly reality check

- Number of clusters produced: **16**
- Cluster size distribution: min 1 finding (cluster 15-fuzz-gaps, cluster 16 has 2), median ~4 findings, max 6 findings (cluster 10-client-robustness-cleanup, cluster 08-claude-md-refresh)
- No cluster exceeded the soft cap of 10 findings. Closest was cluster 10 at 6.
- No `misc-{severity}.md` fallbacks needed.
- **Possible over-split: clusters 03 (server-http-cleanup) and 07 (server-auth-consistency) both touch `src/server/http.ts` and together have only 6 findings.** A merged cluster would have been 6 findings, well within the cap, and would have saved one cluster file. I kept them separate because the work shapes are different (parse hygiene vs auth), but reasonable people would split the call differently. V-next: add more explicit guidance on when to merge clusters touching the same file but with different work shapes.
- **Possible under-split: cluster 10 (client-robustness-cleanup) bundles 6 findings with three different decision axes (inline CSS, error handling, type safety).** At 6 findings it's within cap, but the cluster's "short brainstorm" approach assumes the three decisions are related; they're not really. Could have been three clusters.

### Noise, drops, and regrets

- No drops I regret. The four filtered items were correctly filtered.
- No kept items that feel like noise. All 60+ remaining findings are actionable at T2.
- **One borderline case worth noting for v-next:** the Backend analyst's "OBS-3 [x] No `/health` endpoint; dropped" is a `[x]` (claims to have analyzed and filed a finding) but then says "dropped" in the evidence text. This is neither a proper `[x]` (no cluster reference) nor a proper `[-] N/A` nor a `[~] deferred`. I accepted it as a `dropped-during-analysis` with explanatory text, which doesn't match any of synthesis §8's five canonical shapes. V-next: either add a sixth line shape for "analyzed, decided not to file", or tighten the rule so analysts must pick one of the five and the "dropped with reasoning" case becomes `[x] clean — <explanation of why the absence is fine for tier>`.

### Instructions to the v-next author

- **V-next:** Capture the skill's own git revision in a way that works for both direct-clone and plugin-cache installations. The SKILL.md's Step 6 says "Capture the skill's own git revision at the start of the run (`git -C <skill-repo> rev-parse --short HEAD`)"; this fails when the skill is loaded from a plugin cache without `.git/`. Add a fallback: read `package.json` version, or bundle a `VERSION` file into the skill, or hash the `SKILL.md` contents. Anything that yields a stable identifier for the v-next diff-against-run case.
- **V-next:** Document explicitly in `SKILL.md` Step 0 that `AskUserQuestion` may be a deferred tool requiring `ToolSearch` to load its schema. Two sentences would save the runner a round-trip.
- **V-next:** Split `references/agent-prompt-template.md` into a canonical `references/analyst-ground-rules.md` (ground rules, forbidden reads/commands, self-check table, anti-patterns) plus a minimal per-agent wrapper. Ground rules get read once by each agent from a file; wrapper has only AGENT_NAME, SCOPE, OWNED_CHECKLIST, TIER, TIER_RATIONALE, CLAUDE_MD_FILES. Roughly halves dispatch token cost.
- **V-next:** `references/synthesis.md` §10 "Targeted re-dispatch" criterion "§7 surfaced fewer than 3 Executive Summary clusters despite the codebase being non-trivial" needs sharpening. On a genuinely well-maintained T2 repo, fewer than 3 H/C clusters is the correct output. Either trust the §1b health checks as the primary signal, or add a rule like "if §1b fired zero flags AND fewer than 3 exec summary clusters, do not re-dispatch — the repo is the signal."
- **V-next:** `references/report-template.md` cluster file template's `## Commit-message guidance` block is low-value at scale — move the canonical guidance to README and make the per-cluster block optional/conditional.
- **V-next:** Clarify `scripts/render-status.sh` invocation path when the skill is loaded from a plugin cache. Either copy the script into the report directory at render time, or name the canonical invocation path explicitly in the README's "How to use this report" block.
- **V-next:** Explicitly permit or forbid singleton clusters. Current synthesis §6 "soft cap 5–10" implies a floor but doesn't say so; I produced 2 near-singleton clusters and felt nervous about it. A floor rule like "merge singletons into the nearest topical cluster unless the singleton's fix is genuinely a separate session" would resolve the ambiguity.
- **V-next:** `references/agent-prompt-template.md` Checklist section should forbid table-form output explicitly. The Tooling and Test analysts both used markdown tables instead of the canonical `[x] / [x] clean / …` line shapes, which made synthesis §8 validation manual. Line shapes are load-bearing infrastructure — enforce them.

---

## Part B — Fix coordinator retrospective

_To be filled when the last cluster from this report is closed, deferred, or stalled. If fix work is ongoing at the next invocation of the skill on this repo, write what you have and flag the rest as open._

### Run identity (carry from Part A)

```
(re-state Part A identity block with same anonymization, plus:)
Skill revision at report time: UNKNOWN — see Part A
Skill revision at fix time: {short SHA or identifier at time fix work concluded}
Report directory: docs/code-analysis/{stem}/
Clusters at start: 16
Clusters closed: _
Clusters in-progress: _
Clusters deferred: _
Clusters resolved-by-dep: _
Span of fix work: {first commit date} → {last commit date}
```

### Did the TL;DR block tell the truth?

_TBD at fix-work conclusion._

### Cluster sizing honesty

_TBD at fix-work conclusion._

### Was the `Suggested session approach` useful?

_TBD at fix-work conclusion._

### `Depends-on` edges in practice

_TBD at fix-work conclusion._ (Note at render time: only one explicit `Depends-on:` edge exists — cluster 16 depends on cluster 09. Cluster 02 has an informal dependency on cluster 01 for progress visibility. Cluster 02's xterm.ts work has an informal dependency on cluster 09's OKLab extract.)

### Scope-expansion events

_TBD at fix-work conclusion._

### Deferred items

_No items deferred this run._ (If fix work surfaces items that warrant deferral, record here.)

### Findings the report missed entirely

_TBD at fix-work conclusion._

### Findings the report had that didn't matter

_TBD at fix-work conclusion._

### Tooling reality

_TBD at fix-work conclusion._

### Instructions to the v-next author

_TBD at fix-work conclusion._
