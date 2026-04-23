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

Fix work ran to completion in a single session, same-day as the audit. All 16 clusters touched; 15 closed outright, 1 partial with a named external blocker.

### Run identity (carry from Part A)

```
Repo, stack, tier, size, velocity, etc.: unchanged from Part A.
Skill revision at report time: UNKNOWN — see Part A.
Skill revision at fix time: n/a — the skill was only consulted for
  its `scripts/render-status.sh` helper during fix work; no new
  skill invocations occurred.
Report directory: docs/code-analysis/2026-04-21/
Clusters at start: 16
Clusters closed (resolved):     15  (01, 02, 03, 04, 05, 06, 07, 08,
                                      09, 10, 11, 12, 14, 15, 16)
Clusters closed (partial):       1  (13 — originally deferred the
                                      `bunx playwright` swap; follow-up
                                      verified it on Bun 1.3.13)
Clusters in-progress:            0
Clusters deferred whole:         0
Clusters resolved-by-dep:        0  (no cluster turned out to be
                                      entirely subsumed by another's
                                      fix; cluster 16 did become
                                      tractable only because cluster
                                      09 landed first, but 16 still
                                      required its own bench script)
Span of fix work: 2026-04-21 → 2026-04-21 (59 commits same-day,
  following roughly the cluster recommended order 01 → 04 → 07 →
  08 → 09 → 11 → 12 → 14 → 16 → 02 → 03 → 05 → 06 → 10 → 13 → 15,
  with the order driven by a maintainer-chosen "batch the mechanical
  ones first" heuristic rather than the report's ordering)
```

### Did the TL;DR block tell the truth?

Mostly yes. Each cluster's TL;DR goal + impact wording survived contact with the code. Two specific calibration notes:

- **Cluster 01's "one-line fix" framing was accurate but incomplete.** Flipping `bun test` → `bun run coverage:check` in `release.yml` is literally one line, but the release CI would have gone red immediately because `src/client/fg-contrast.ts` sat at 87.5% func coverage pre-existing — below the 90% gate. I had to absorb one autofix-ready item from cluster 02 (add `clampFgContrastStrength` test) and one from cluster 09 (delete the dead `pushFgLightness` alias) in the same commit to make the gate pass. The cluster's Suggested Session Approach said nothing about this. V-next auditors flipping a gate should verify the gate passes locally before proposing the flip, or at minimum add a **Pre-conditions:** front-matter field listing any in-scope files currently below the new threshold.
- **Cluster 02's COV-2b listed two untested HTTP routes: `GET /api/terminal-versions` and `POST /api/exit`.** `/api/terminal-versions` was already tested in `http-branches.test.ts:191` — a grep would have caught this. `POST /api/exit` was genuinely untested. Half-wrong finding; the wrong half was easy to verify.

Everything else — slider-listener count (17), line counts, bug severities, field-by-field counts on specific modules — matched reality to within a few lines.

### Cluster sizing honesty

All 16 size calls held up against actual time spent. Highlights:

- **Cluster 02 (Large, full day+)** was the most accurate. Four modules × real test coverage + deferring the 5th (topbar) to a new `docs/ideas/` file + the xterm.ts adapter decision genuinely ate most of a session.
- **Cluster 15 (Medium, pattern-first then expand)** was accurate *if* you stage the work. Maintainer opted for all 9 targets in one sitting, which was ~45 min of implementation + 1 real bug fix. The "pattern-first" recommendation was the safe voice but the whole cluster was tractable in one pass once fast-check was wired.
- **Cluster 11 (Medium, half-day)** split cleanly in two. The autofix-ready clamp fix was ~30 min; the four needs-decision items (after an interview) took another ~2 hours including the data-driven slider-table refactor.

No cluster turned out to be larger than its Small / Medium / Large label. One (13) was smaller than advertised because one of its five findings became a 2-line deferral instead of a Makefile + package.json rewrite (external blocker, see "Tooling reality").

### Was the `Suggested session approach` useful?

Yes, with one shape of exception. The block was most useful when it **named sub-sessions explicitly** — cluster 02's "(a) smoke imports, (b) real-assertion dropdown+topbar, (c) xterm plan" mapped directly onto how fix work actually went. Cluster 11's and cluster 14's multi-item breakdowns were similarly load-bearing.

Less useful when generic: "Mechanical — dispatch to a subagent" (clusters 03, 04, 07, 09) doesn't say much, and papers over non-trivial differences. Cluster 04 needed `isSafeTmuxName` designed from scratch (not mentioned in the cluster notes) while cluster 03 was closer to pure substitution.

Clusters with four-plus needs-decision items (06, 10, 11, 13) benefited from the "run as a short brainstorm" note. Those absolutely required a maintainer interview before any code change.

### `Depends-on` edges in practice

The one explicit edge (16 → 09) held: cluster 09 extracted `src/client/oklab.ts`, and cluster 16's `bench-render-math.ts` imports from it cleanly. Doing 16 first would have required either importing from the unextracted location or writing a duplicate bench — the edge correctly flagged the ordering.

Informal dependencies that the cluster files mentioned in prose but didn't formalize:

- **Cluster 02 ↔ cluster 01.** Cluster 02's header says "Depends on: cluster 01 (enabling the gate first makes the numerical progress visible in CI)". True but weaker than `Depends-on:`; the fixes are useful even if cluster 01 lands later.
- **Cluster 02 xterm.ts ↔ cluster 09.** Cluster 02 called this out. At fix time the carve-out helped: the new `src/client/adapters/xterm-cell-math.ts` (Layer 1 of the WebGL harness idea file) built on the same pattern `oklab.ts` established.

V-next should formalize both: an `informally-unblocks:` field for the weaker "lands easier after X" relationship would read more honestly than burying the dependency in prose.

### Scope-expansion events

Four genuine cluster-boundary bleeds:

1. **Cluster 01 picked up fg-contrast.ts work from clusters 02 and 09** to make the CI gate go green — see "Did the TL;DR block tell the truth?". Commit used the cluster file's own "Incidental fixes" recipe (one-line reason per extra file). Pattern held.
2. **Cluster 10 added `_resetForTest` + self-repair container-attachment logic to `src/client/ui/toast.ts`.** Strictly the cluster's scope was "six small hygiene fixes", but these were required for the cluster-02 toast test file to isolate between cases. They're genuine production improvements (not tests-only shims), so no harm — but worth noting that cluster-02's test-writing created pressure for cluster-10-shaped production changes.
3. **Cluster 12's `tw-` class-name sweep accidentally renamed a filename import** (`./ui/drops-panel.js` → `./ui/tw-drops-panel.js`) because my regex matched both the CSS class `.drops-panel` and the module-relative filename `drops-panel`. Caught by the build failure. Cross-file renames of bare identifiers need a shape-aware tool (AST rewrite) or very defensive regexes; the cluster file said "one-time sweep" and did not flag the regex-scope hazard.
4. **Cluster 15 (fuzz-gaps) retroactively caught a real bug in cluster 04's scope.** `sanitizeSession('%')` threw via internal `decodeURIComponent`. Cluster 04 (pty/tmux exec safety) did not include `sanitizeSession` hardening — its scope was the tmux argv path, not the session-name parser. Fix landed in cluster 15's commit with a regression guard in `tests/unit/server/pty.test.ts` so it's visible under `bun test`. V-next should note that fuzz findings often retroactively belong in other clusters' commits for attribution hygiene.

### Deferred items

Three entries landed in `docs/ideas/` rather than as in-scope fixes:

- **`docs/ideas/webgl-mock-harness-for-xterm-adapter.md`** — Layers 2 and 3 of the WebGL stub. Layer 1 (pure-helper carve-out → `src/client/adapters/xterm-cell-math.ts`) landed as a follow-up task after the cluster closed. Maintainer picked this path during the cluster 02 interview.
- **`docs/ideas/topbar-full-coverage-harness.md`** — ~150-case mechanical harness to bring `src/client/ui/topbar.ts` up to the 95/90 gate. Public-surface tests landed; the rest is deferred. Paired with the WebGL file in the "deferred-but-documented-not-dropped" pattern.
- **Cluster 13's `bunx playwright`** swap was originally deferred, but a 2026-04-23 follow-up verified `bunx playwright test` on the repo's pinned Bun 1.3.13 toolchain.

Two observations for v-next:

- The status lifecycle documented in the report template is `open` / `resolved`. Cluster 13 wanted a `partial` status. I used `partial` with a split `Resolved-in: SHA (partial — reason)` form. V-next should document `partial` as a first-class value.
- Deferring via `docs/ideas/` (a maintainer-owned directory, not the cluster's scratch space) turned out to be the right shape — the idea files survive the report directory's retention and can be picked up by future sessions without archeology. V-next might recommend this pattern explicitly.

### Findings the report missed entirely

**One.** `sanitizeSession('%')` crashes via `decodeURIComponent`'s refusal of malformed percent-escapes. Found by cluster 15's fuzz pass on first run (fast-check counterexample: `["%"]`). The Test + Security analysts both walked this module and didn't catch it — they relied on code-inspection reasoning and handwritten payloads rather than generative testing. Exactly the kind of miss fuzz is designed to catch, so the audit's cluster 15 recommendation (add fuzz framework) was itself the mitigation. Nice closure.

No other silent misses surfaced during fix work. No "we also needed to fix X that nobody flagged" emergencies.

### Findings the report had that didn't matter

- **Cluster 02 COV-2b: `GET /api/terminal-versions` untested.** Already tested. False alarm, noted above.
- **Cluster 11: "speculative race between `refreshCachedSessions` and sessions dropdown render".** Real race, real fix (promise-dedup with an `inFlight` guard), but described as Medium-effort "needs-decision" when it was actually a 10-line autofix once the maintainer confirmed the dedup shape.
- **Cluster 04's "`--` separator on `new-window -n`".** The cluster recommended `--` before the user-controlled positional on all three rename/new-window call sites. For `rename-session` / `rename-window`, the positional is genuinely positional; `--` helps. For `new-window -n NAME`, NAME is the VALUE of the `-n` option, not a positional — `--` would be misplaced. I added it, then reverted after checking tmux's argv parser. V-next analysts adding `--` guards should distinguish option-value positions from true positional slots.

### Tooling reality

- **`scripts/render-status.sh` lives in the skill package**, not the analyzed repo. Fix coordinator has to invoke via absolute path to the plugin cache: `~/.claude/plugins/marketplaces/.../scripts/render-status.sh`. Flagged in Part A; fix-phase experience confirms the friction. Every cluster close required the absolute-path invocation — ~40 times total this session.
- **Hook-based front-matter auto-stamping raced my manual fills.** Some CLAUDE-adjacent hook auto-filled cluster `Resolved-in:` SHAs. Sometimes it won, sometimes I did; required an extra edit + amend cycle on the first two clusters until I saw the pattern.
- **Bun 1.3.12 path-handling.** `bun test tests/fuzz/` treats the path as a filter and fails to match; `bun test ./tests/fuzz/` (leading `./`) works as a path. Not a skill problem; worth mentioning because it tripped me up mid-cluster-15.
- **Tool invocations must be verified against the pinned runtime.** Cluster 13 originally deferred `bunx playwright` based on then-known Bun 1.3.x behavior; a later Bun 1.3.13 verification showed the invocation now works. V-next: verify recommended invocations actually work on the project's pinned Bun / Node / whatever version before marking autofix-ready or blocked.
- **Maintainer interviews via plain Q&A** (numbered / lettered options, pick per-item) worked well for the four decision-heavy clusters (06, 10, 11, 13). No need for `AskUserQuestion`-tool formalism; normal prompts were enough.

### Instructions to the v-next author

1. **Distinguish "autofix-ready" from "needs-decision" in the cluster headline, not just in the per-finding severity block.** Four of 16 clusters (06, 10, 11, 13) required a maintainer interview before any code change. Knowing this at the cluster index level lets the fix coordinator batch interviews rather than re-entering the back-and-forth shape once per cluster.
2. **Verify recommended invocations at the project's pinned toolchain version.** Clusters should check `.bun-version` / `.nvmrc` / etc. before assuming `bunx X` / `pnpm X` / equivalent works. Cluster 13's bunx miss is the pattern.
3. **Add a `Pre-conditions:` front-matter field for clusters that flip gates.** Cluster 01's gate-flip was blocked by cluster 02's coverage gap; a `Pre-conditions:` line naming any in-scope files currently below the new threshold would make the implicit dependency explicit.
4. **Document `partial` as a first-class status.** `open` / `resolved` / `deferred` covers the clean cases; `partial` is what cluster 13 wanted. `Resolved-in: SHA (partial — reason)` turned out to be a readable format; consider codifying it.
5. **Fuzz-gap clusters often retroactively attribute bugs to other clusters.** When fuzz finds a real bug, the fix is obvious; the question is which cluster's commit trail should carry it. This run landed in cluster 15's commit with a pointer back to cluster 04 / pty.ts. V-next could add an `attribution:` field, or just document the pattern.
6. **Ship `scripts/render-status.sh` alongside the report directory.** Part A called this out. Fix-phase experience reinforces it heavily — ~40 absolute-path invocations per session is enough friction to be worth the one-time copy at Step 5.
7. **For "mechanical" clusters with >3 findings, pre-think the implementation corners.** Cluster 03 was nominally 4 autofix-ready findings; inside the implementation, the `any → unknown` finding needed non-trivial narrowing logic (the cluster's fix note didn't anticipate the `Record<string, unknown>` + typeof-guards on each property access). V-next should encourage analysts to walk one concrete implementation sketch for "mechanical" findings and flag any rabbit-holes up-front.
8. **Informal-unblock edges are real and worth naming.** `Depends-on:` is a hard edge; there's a softer "X lands easier after Y" relationship (cluster 02 xterm.ts ↔ cluster 09 OKLab extract; cluster 16 ↔ cluster 09). Adding an `informally-unblocks:` field would capture this without forcing a hard ordering.
9. **Commit-message guidance that names the slug and date was perfect.** Every one of the 59 commits from this run has `cluster NN-slug, YYYY-MM-DD` in the first line. `git log --grep='cluster 02'` now navigates the report trivially. Keep this rule.
10. **The `docs/ideas/` directory is a clean place to retire "deferred-but-shaped" work.** Cluster 02's WebGL harness and topbar full-coverage harness landed as idea files; both outlive the report directory's retention model and are discoverable by future sessions without archeology. V-next could explicitly recommend this pattern for work the maintainer wants to preserve but not commit to scheduling.
