# analysis-analysis.md

Retrospective on the `codebase-deep-analysis` skill itself, written from the inside of a real run. Audience: the author of the next version of the skill. Project specifics anonymised.

---

## Part A — Runner retrospective

### Run identity

```
Repo: T1 single-author repo. Bun-runtime browser-rendered terminal frontend with vendored UI submodule, ~43k non-vendored LOC, 162 test files.
Stack family: TypeScript everywhere on Bun runtime; no DB; auth-gated + bind-gated local-first web UI; native build pipeline with vendored UI submodule; Electrobun desktop wrapper.
Project tier called by Scout: T1
Skill revision: version:3.10.1
Skill source: tuxie/vibe @ plugins/codebase-deep-analysis (loaded from plugin cache, .git/ absent, VERSION file used per fallback chain)
Report directory: docs/code-analysis/{stem}/
Analysts dispatched: Backend, Frontend, Styling, Accessibility, Test, Security (Senior/opus default), Tooling, Docs Consistency
Analysts skipped: Database (Scout flag database: absent), Coverage & Profiling (user directive `skip coverage` at Step 0)
Step 0 confirmation: Free-text directive applied — `skip coverage` (recorded as `Analyst override: Coverage & Profiling skipped per user request`).
Coverage command: auto-detected — single specific match on a `coverage:check` script in the manifest (skipped by user directive before dispatch).
Senior-1M usage: none (Scout emitted `Recommend senior-1m for: none`; no Path A gradient triggers fired).
Effort overrides: none (every dispatch ran at default effort).
Total wall time, approximate: ~25 minutes (Scout ~3m; 8 parallel analysts ~12m max; synthesis + render ~10m).
Total output tokens, approximate: ~80k across analysts (Security/opus ~18k; Frontend ~22k due to extensive "for record" entries; Backend/Styling/Accessibility/Test/Tooling/Docs ~6–10k each; Scout ~5k).
```

### What worked

- **The Step 0 single-confirmation gate with free-text directive slot held up.** The user picked `Instructions / questions`, typed `skip coverage`, then `Proceed`. The directive parsed cleanly, Coverage was dropped from the dispatch list with the canonical Run-metadata line, and Steps 1–6 ran unattended. Round-trip cap was not approached. The closed directive vocabulary (`skip <analyst>` etc.) was sufficient for this run.
- **The Scout's tier signal-weighting rule produced the correct call.** A solo-author repo with rich CHANGELOG, multi-job CI, comprehensive AGENTS.md, and 162 test files is exactly the calibrating example for "T1 with a careful author." The Scout cited 1 unique contributor + zero coordination infra (no SECURITY.md / CODEOWNERS / CONTRIBUTING / CODE_OF_CONDUCT / issue templates) and refused the upgrade. Every subsequent analyst respected the call; no analyst's evidence contradicted T1.
- **Local-first calibration was load-bearing.** The Scout flagged `web-facing-ui: present, auth-gated` (and noted `bind-gated` informally — default 0.0.0.0 bind with 127.0.0.1/::1 IP allowlist). The Security analyst applied the Local-first severity table and held network-boundary findings at Low/Medium that would otherwise have been Medium/High under the public-surface table. Without this calibration the report would have been uncalibrated alarm — correctly rejected.
- **Right-sizing dropped at source, not at synthesis §3.** Every analyst's checklist for items with min-tier > T1 came back as `[-] N/A — below profile threshold (project=T1)` already, so synthesis §3's filter ran with `Below profile threshold: 0`. The 4 drops at synthesis §3 were all "borderline / clean-with-record" entries one analyst filed (see Friction below). T1 right-sizing is doing its work where it should — at analyst dispatch time, with the wrapper's tier directive — rather than as a post-hoc filter.
- **Compact multi-file mode rendered cleanly.** 51 findings post-filter, T1 → compact mode per `report-template.md`. Layout: README + executive-summary + themes + clusters/ + by-analyst.md (single file) + checklist + meta + not-in-scope + scripts + .scratch + analysis-analysis. `render-status.sh` rebuilt the index on first try after `validate-frontmatter.sh` passed; no manual edits were needed to the cluster index.
- **Pre-release-surface detection caught the local-CI-equivalent runner.** Scout flagged `Recommend pre-release checklist in report: yes` based on CI present + `act` referenced in the Makefile and AGENTS.md. The README emitted the pre-release checklist block per the conditional template; this is a low-cost, high-signal feature for any T2+ repo with structured release flow.

### What was friction

- **Frontend analyst filed several "for record / actually clean" entries as findings instead of as clean checklist lines.** Three to four entries in the Frontend output were structurally "I traced this code path and concluded it's correct; filing so the pass is documented" — `connection.ts:74` reconnect null-onclose, `bun-build.ts:71` regex pattern, `colours.ts:27` legitimate parser use, `topbar.ts:1282` correct `void` usage. These belong in the checklist as `[x] <evidence pointer>` or `[x] clean — sampled <X>`, not in the Findings list. Synthesis §3 caught and dropped them as "borderline" but the dispatch wrapper could prevent the shape upstream. **V-next:** consider adding to `analyst-ground-rules.md` "Anti-patterns in your output": *"Verification-of-cleanliness goes in `[x] clean — <evidence>` checklist lines, not in the Findings list. If your description ends with 'this is the correct approach' or 'verified-clean', emit it as a checklist line."*
- **`{OWNED_CHECKLIST_ITEMS}` substitution as comma-separated list with `(min-tier)` tags hit a quality wall on the larger analysts.** Backend/Frontend each owned 50+ items. The wrapper currently expects the orchestrator to inline-tag every item; on larger analysts this resulted in compact lines that one analyst (Frontend) misread as requiring a Findings entry per checked item. A grouped/categorical format ("EFF-1..3, all T1; PERF-1 T2; PERF-3..4 T1; …") is harder for a model to mistake for "produce a finding for each." **V-next:** consider grouping owned items by category in the wrapper substitution rather than enumerating, OR add a one-line reminder to the wrapper that "checklist line shapes are emitted in the Checklist section, not as findings."
- **Joint ownership on FE-1, FE-6, FE-7, FE-8, FE-21, FE-22, FE-23 between Frontend and Styling produced redundant `(frontend) clean` / `(styling) clean` checklist lines.** The split is intentional (frontend lens vs system-shape lens) but on a small T1 styling surface the two lenses converged on the same answer for most items. The redundancy is fine in the by-analyst dump but bloats the checklist. Not worth structural change for v-next; a small note in the rendering rules could help: when both lenses report `clean — <same sampling statement>`, collapse to one line with `(frontend, styling) clean`. Already done in this report by hand at synthesis time (see `checklist.md` under FE-21/22/23).
- **Cluster 11 (deferred → `docs/ideas/...`) required hand-curating the `Deferred-reason:` field.** The validate-frontmatter.sh script enforces `Status: deferred` requires both `Deferred-reason:` and `Resolved-in:`. The shape is correct but `report-template.md` "Cluster `Status` lifecycle" section names the requirement only loosely and then the validator enforces the precise spelling — runner had to cross-reference both files to get past validation. **V-next:** include an example deferred cluster file in `report-template.md` with both `Deferred-reason:` and `Resolved-in: deferred → <path>` filled in.
- **The `skip <analyst>` directive form did not check capitalisation.** User typed `skip coverage` — orchestrator interpreted as "Coverage & Profiling Analyst" by string-prefix match. This worked but is brittle; a future user typing `skip cov` or `skip Coverage Profiling` would behave the same way through a more permissive (and forgiving) prefix match, while `skip security-analyst` (with the precise hyphenated form) might fail. **V-next:** define the permitted analyst-name forms in the directive vocabulary spec — either roster slug, kebab name, or "the first non-stopword token of the analyst name."

### Under-sized guidance

- **No instruction for what to do when an analyst's prose effectively says "I checked but found nothing actionable" but the agent renders it as a Finding shape with `Severity: Low / Confidence: Verified` and the body explains why it's clean.** This is the upstream cause of the 4 borderline drops above. The synthesis §3 filter caught them, but only as "borderline" — there's no ground-rules anti-pattern that names this shape. Adding one would be cheap.
- **No guidance on how to merge the Styling Analyst's `### System inventory` block into the per-cluster output.** The Styling pre-pass is intended to feed cross-cutting themes (synthesis §5), but on a small styling surface the inventory IS the value-add and largely subsumes the per-finding output. The orchestrator chose to render the inventory as part of the by-analyst dump rather than promote it to a per-cluster appendix. Both seem reasonable; the rendering template is silent on the choice.

### Over-sized guidance

- **The `executive-summary.md` template's "If zero qualify, write `_No clusters met..._`" path forces a full file even when the explanation is one sentence.** On this run the executive summary file is 80% boilerplate explanation about why §7 found zero qualifiers, which is exactly the right honesty signal. The template guidance is fine, but on a clean repo it produces a file that costs more to render than it returns. Not a real friction — the file is short — but the renderer wonders if a "summary slot" inside README would suffice.
- **The `not-in-scope.md` "Tier-rule skipped checklist items" block ballooned because every T2/T3 item appears regardless of whether it could conceivably apply.** The list is long-and-mechanical. The template asks for it explicitly; it is useful for traceability; but on a T1 repo it's ~50 line items the user is unlikely to read. **V-next:** consider whether the tier-skipped block can collapse to a single line (`{N} checklist items skipped at min-tier > T{N}; see checklist.md for per-item lines.`).

### Token and cost reality

- **Security on opus was the largest analyst by cost** at ~18k output tokens. Expected per the default tier in `agent-roster.md`. The output quality justified the senior tier — Security was the only analyst to file a Medium-severity finding (HTML/JSON `<script>` injection) that compounds with another Low finding (`/api/exit` CSRF) into a real chain.
- **Frontend on sonnet was the longest by raw output length** at ~22k tokens. Most of the extra length came from the verbose-but-clean checklist lines (almost every item had a sampling statement) and the four "for record / clean" findings that synthesis dropped. Worth flagging: a sonnet analyst with a wide checklist and an instinct to document every check produces a lot of output. The fix at the wrapper level (group owned items by category, add the "verification-of-cleanliness goes in checklist" anti-pattern) should compress this.
- **No re-dispatch (synthesis §10) fired.** §1b health checks: every analyst's clean-sweep ratio under threshold, no zero-findings on non-trivial scope, no high source-drop ratio. Frontend's 4 borderline drops were close to but not over the §1b "drop count exceeds reported findings" threshold. Re-dispatch correctly stayed off.
- **No analyst would benefit from re-running with different instructions** in hindsight. Frontend would benefit from the "verification-of-cleanliness goes in checklist" anti-pattern landing in the wrapper, but that's a v-next change, not a re-dispatch.

### Tier calibration

- **The T1 call held up.** No analyst evidence contradicted it. Per-finding tier filtering was respected. The "tier as confidence boost" rule fired implicitly in cluster 05 (the HTML injection finding's `autofix-ready` is appropriate even though the project lacks formal threat modelling — the existing security posture in AGENTS.md is "explicit intent").
- **Min-tier tags were pitched correctly.** A11Y items (T2 mostly) skipped on a T1 repo is the right call; the few T2 items that surfaced anyway (e.g., invalid `aria-haspopup="true"`, `#btn-session-plus` no name) made it through because the analyst saw concrete keyboard-navigation breaks, which the tier filter is meant to allow when evidence is present. The T2/T3 BUILD-1 / BUILD-3 items (`bun.lock` and `.bun-version` presence) were already covered by the project at T1 — so the tier filter dropped them as `[-] N/A` cleanly without losing signal.

### Applicability-flag calibration

- **`backend`, `frontend`, `tests`, `security-surface`, `tooling`, `docs`, `ci`** — all `present`, all correct.
- **`database: absent`** — correct.
- **`container: absent`, `iac: absent`, `monorepo: absent`** — correct.
- **`web-facing-ui: present, auth-gated`** with `bind-gated` informally noted by the Scout — correct and useful. The Scout's combined sub-flag (auth + bind) gave Security the right calibration table to use; without it the local-first severity anchors would have been ambiguous.
- **`styling-surface: present`** — correct; the Styling Analyst's pre-pass produced useful inventories.
- **`i18n-intent: absent`** — correct; SEO and I18N items all `[-] N/A`.

### Docs-drift flag accuracy

- Scout's call: `README.md fresh, AGENTS.md fresh`. Velocity-adjusted threshold (high-velocity, >500 commits/90d → 7d/14d threshold). Both docs touched within the last day.
- **Docs analyst found 6 drifts that the Scout's signal-3 (content-default) did not surface.** The drifts were small: a 32px → 28px topbar height claim, a missing field in the `applyThemeDefaults` enumeration, a missing `--version`/`--help` in the README CLI table, a `<file>` vs `<path>` metavar inconsistency, a project-structure block missing three subdirs, and a reconnect-flow prose drift that referred to a method (`adapter.fit()`) that does not actually run on reconnect. Scout's signal-3 hit none of these because the patterns are not "Default: X" / "by default" / "is set to X" phrasings — they're load-bearing prose claims and structural enumerations.
- **The 30d/90d / 7d/14d thresholds were correct for this repo's commit rhythm.** Velocity 825 commits/90d → high-velocity → 7d/14d. Both docs were within the strict window. The miss was in *content shape*, not in *threshold tuning*.
- **V-next:** signal-3's regex set is too narrow. Consider adding shapes like `<value>px` on a structural element ("32px toolbar"), enumerated lists ("X, Y, Z" where the third item is the load-bearing one), and CLI metavar drift between docs. The Scout would not have caught all 6, but with a wider regex set it would have caught 2–3.

### Pre-release surface accuracy

- **Scout recommendation: yes.** CI multi-job present + `act` referenced in Makefile/AGENTS.md. **Correct.** The repo's release process is structured around running `act` locally before tagging — exactly the shape the pre-release checklist is meant to encode.

### Coverage & Profiling Analyst reality check

Skipped per user directive at Step 0. Coverage command was auto-detected (`bun run coverage:check`); the user opted to skip the dispatch entirely. No static-pass items (COV-1..COV-6, PROF-1..PROF-2) analysed this run. Note for v-next: the `skip <analyst>` directive worked, but the resulting `[-] N/A` lines in the checklist are uniform across COV/PROF — a one-line note in the report's Run metadata about WHY (user directive) plus a single `[-] N/A` block in checklist.md would be cleaner than per-line. The current report has the per-line shape; future runs may want to collapse.

### Cluster-assembly reality check

- **Number of clusters produced:** 11 (1 deferred).
- **Cluster size distribution:** min 1 (cluster 11, deferred), max 10 (cluster 03 a11y), median 4. No cluster exceeded the soft cap of 10 findings — cluster 03 was at the cap. No `>12` split events fired.
- **No `misc-{severity}` fallback clusters produced.** The cluster-hint vocabulary held up: `async-void-cast`, `async-sleep-poll`, `test-determinism`, `button-names`, `menu-keyboard`, `hidden-select-duplicate`, `live-regions`, `modal-focus`, `label-mismatch`, `palette-and-contrast`, `css-variable-hygiene`, `dead-markup`, `magic-numbers`, `stylesheet-load-order`, `aria-roles`, `html-injection`, `exit-api-csrf`, `ws-resource-limits`, `build-pipeline`, `ci-artifact-verification`, `artifact-smoke`, `file-mode-hardening`, `security-headers`, `desktop-auth`, `fuzz-coverage`, `doc-behavior-drift`, `cli-table-drift`, `project-structure-map`, `efficiency`, `naming`, `naming-duplication`, `text-parsing`, `quote-paths`, `auth-consistency`, `type-safety`, `dep-freshness`, `client-log-auth`, `typecheck-coverage` — ~38 distinct hints across 8 analysts (Styling and Accessibility used the closed vocabulary noted in `synthesis.md` §6). Reshape merged plausibly-related hints (e.g., the four security-low hints all collapsed into cluster 07).
- **One cluster was a singleton (cluster 11, deferred → docs/ideas/) and was kept** per the synthesis §6 floor rule's exception for deferred items with explicit tracking locations. No other singletons survived; small findings (jsdom dep bump, `tmuxConf` quoting, `currentSession` dedup) merged upward into broader clusters.
- **No clusters that should have been merged were kept separate.** Cluster 09 (backend-correctness-micro) and cluster 10 (frontend-correctness-micro) considered for merge per synthesis §6 step 5 (same decision axis); kept separate because the file scopes don't overlap and they map to two different fix sessions. Decision recorded in run metadata implicitly.

### Noise, drops, and regrets

- **No drops the user is likely to regret.** The 4 borderline drops were "verification-of-cleanliness as Finding" — they belong in the checklist, not as findings. The 6 documented-decisions on Security were already explicitly accepted by the project's own AGENTS.md or threat-model docs.
- **No findings kept that were obviously inactionable noise.** Cluster 07's `ws-resource-limits` finding is the closest call — it is conditional on `--no-auth` being explicitly opted into and the maintainer documents that opt-in as advanced-use only. The runner kept it because the chain (XSS → exit, plus `--no-auth` exhaustion) is a real defence-in-depth concern; readers may disagree.

### Instructions to the v-next author

- **V-next:** add to `analyst-ground-rules.md` "Anti-patterns in your output": *"Verification-of-cleanliness goes in `[x] clean — <evidence>` checklist lines, not in the Findings list. If a finding's body ends with 'verified clean' or 'this is the correct approach', it is a checklist line in the wrong section."* This run produced 4 such drops; the wrapper-level fix is cheap.
- **V-next:** in `agent-prompt-template.md` `{OWNED_CHECKLIST_ITEMS}` substitution, emit owned items grouped by category with min-tier tags inline, not as a flat enumeration. On Backend/Frontend with 50+ items the flat list reads like "produce a finding for each."
- **V-next:** in `references/structure-scout-prompt.md` "Load-bearing instruction-file drift" signal-3, broaden the regex set beyond `Default: X` / `default is X` / `is set to X` phrasings. Add shapes like `<value>px` on structural elements, enumerated field lists ("X, Y, Z"), and CLI metavar drift (`<file>` vs `<path>` between README and `--help` output). On this run, signal-3 missed all 6 prose-drift findings the Docs analyst surfaced.
- **V-next:** add an example `Status: deferred` cluster file to `references/report-template.md` showing both `Deferred-reason:` and `Resolved-in: deferred → <path>` filled in. The validator enforces the precise spelling, but the cluster template is silent on it.
- **V-next:** in `references/report-template.md` "Tier-rule skipped checklist items" block, allow a collapsed single-line form (`{N} checklist items skipped at min-tier > T{N}; see checklist.md`) when the per-item list exceeds ~30 entries. On a T1 hobby project the per-item list is mostly noise; the user reads the cluster index, not the tier-skipped block.
- **V-next:** consider whether the `(frontend) clean` / `(styling) clean` redundancy on jointly-owned FE-* items can collapse to `(frontend, styling) clean — <sampling>` when both lenses converge on the same answer. Synthesis §4 currently keeps both lines; the rule could allow collapse when the sampling statements match.
- **V-next:** the `executive-summary.md` template's zero-qualifier path produces a full file for one sentence of explanation. Consider whether a "summary slot" inside README's "## Index" section could replace the file when the cluster gate found no qualifiers. The honest "no clusters qualified — read this anyway" message is short; a separate file may be over-structured.

---

## Part B — Fix coordinator retrospective

_To be appended after the last cluster from this report has been resolved, deferred, or stuck. The fix coordinator (or `implement-analysis-report` skill) writes Part B in place; do not regenerate. See `references/analysis-analysis-template.md` Part B template and `iar`'s `references/partb-writer.md` for the canonical subsection shape._
