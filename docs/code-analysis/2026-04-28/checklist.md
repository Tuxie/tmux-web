# Checklist

Rendered per-item in ID order. Multi-owner items show one line per owning scope. Items above project tier (T1) are `[-] N/A — below profile threshold (project=T1)` unless counter-evidence cited. Items not applicable per Scout flags are `[-] N/A — <flag reason>`.

## EFF

- `EFF-1 [x] (backend) src/server/file-drop.ts:318 — see cluster 09 (backend-correctness-micro)`
- `EFF-1 [x] (frontend) clean — sampled all 32 src/client/ .ts files`
- `EFF-2 [x] (backend) clean — sampled server I/O paths`
- `EFF-2 [x] (frontend) clean — debounce/coalesce/rAF patterns verified`
- `EFF-3 [x] (backend) clean — no dead code in server scope`
- `EFF-3 [x] (frontend) clean — sampled hot path caching`

## PERF

- `PERF-1 [-] N/A — below profile threshold (project=T1)`
- `PERF-2 [-] (frontend, JS-bundle slice) N/A — below profile threshold (project=T1)`
- `PERF-2 [-] (styling, CSS-bundle slice) N/A — below profile threshold (project=T1)`
- `PERF-3 [x] (backend) clean`
- `PERF-3 [x] (frontend) clean — bun-build minify configured`
- `PERF-4 [x] (backend) clean — readBodyCapped, subprocess timeouts`
- `PERF-5 [-] N/A — below profile threshold (project=T1)`

## QUAL

- `QUAL-1 [x] (backend) clean`
- `QUAL-1 [x] (frontend) clean`
- `QUAL-2 [x] (backend) clean`
- `QUAL-2 [x] (frontend) clean`
- `QUAL-3 [x] (backend) src/server/index.ts:459 — see cluster 09 (tmuxConf path quoting)`
- `QUAL-3 [x] (frontend) clean`
- `QUAL-4 [x] (backend) clean — no over-engineering`
- `QUAL-4 [x] (frontend) clean`
- `QUAL-5a [x] (backend) clean`
- `QUAL-5a [x] (frontend) clean`
- `QUAL-5b [x] (backend) clean`
- `QUAL-5b [x] (frontend) clean`
- `QUAL-5c [x] (backend) clean`
- `QUAL-5c [x] (frontend) clean`
- `QUAL-6 [x] (backend) clean`
- `QUAL-6 [x] (frontend) clean`
- `QUAL-7 [x] (backend) clean`
- `QUAL-7 [x] (frontend) clean`
- `QUAL-8 [x] (backend) clean`
- `QUAL-8 [x] (frontend) clean`
- `QUAL-9 [x] (backend) clean`
- `QUAL-9 [x] (frontend) clean`
- `QUAL-10 [x] (backend) clean — procfs/tmux-F structured`
- `QUAL-10 [x] (frontend) src/client/colours.ts:27 (parseRgbString — legitimate use; flagged for record). src/client/ui/topbar.ts:1287 stripTitleDecoration — see cluster 10`
- `QUAL-11 [x] (backend) clean`
- `QUAL-11 [x] (frontend) clean`

## ERR

- `ERR-1 [-] N/A — below profile threshold (project=T1)`
- `ERR-2 [-] N/A — below profile threshold (project=T1)`
- `ERR-3 [-] N/A — below profile threshold (project=T1)`
- `ERR-4 [-] N/A — below profile threshold (project=T1)`
- `ERR-5 [x] (backend) clean`
- `ERR-5 [x] (frontend) src/client/index.ts:284 (document.fonts.load swallows error reason) — see cluster 01`

## CONC

- `CONC-1 [x] (backend) clean`
- `CONC-1 [x] (frontend) clean`
- `CONC-2 [x] (backend) clean — serialiseFileWrite`
- `CONC-2 [x] (frontend) clean`
- `CONC-3 [-] N/A — below profile threshold (project=T1)`
- `CONC-4 [-] N/A — below profile threshold (project=T1)`
- `CONC-5 [-] N/A — below profile threshold (project=T1)`
- `CONC-6 [x] (backend) src/server/ws.ts:339,348 (handleTitleChange/handleReadRequest fire-and-forget) — see cluster 01`
- `CONC-6 [x] (frontend) src/client/ui/topbar.ts:622,758,892 (onSettingsChange void omitted) — see cluster 01`
- `CONC-7 [x] (backend) clean`
- `CONC-7 [x] (frontend) clean`

## OBS

- `OBS-1 [-] N/A — below profile threshold (project=T1)`
- `OBS-2 [-] N/A — below profile threshold (project=T1)`
- `OBS-3 [-] N/A — below profile threshold (project=T1)`
- `OBS-4 [-] N/A — below profile threshold (project=T1)`

## LOG

- `LOG-1 [x] clean`
- `LOG-2 [x] clean`
- `LOG-3 [-] N/A — below profile threshold (project=T1)`
- `LOG-4 [-] N/A — below profile threshold (project=T1)`
- `LOG-5 [x] clean`
- `LOG-6 [x] clean`
- `LOG-7 [-] N/A — below profile threshold (project=T1)`

## TYPE

- `TYPE-1 [x] (backend) src/server/pty.ts:97 etc. (Bun API gaps as any) — see cluster 09`
- `TYPE-1 [x] (frontend) src/client/adapters/xterm.ts:15 (xterm internal API any) — see cluster 10`
- `TYPE-2 [-] N/A — below profile threshold (project=T1)`
- `TYPE-3 [x] (backend) clean — strict TS, no @ts-ignore`
- `TYPE-3 [x] (frontend) clean — strict TS, no @ts-ignore`

## A11Y

- `A11Y-1 [x] src/client/index.html:40 — see cluster 03`
- `A11Y-2 [x] src/client/ui/dropdown.ts:391 — see cluster 03`
- `A11Y-3 [x] (styling) src/client/base.css:426 status-dot color — see cluster 03 (joint with Accessibility)`
- `A11Y-3 [x] (a11y) src/client/ui/topbar.ts:303 status-dot rendered combinations — see cluster 03`
- `A11Y-4 [-] N/A — below profile threshold (project=T1)`
- `A11Y-5 [x] clean`
- `A11Y-6 [-] N/A — below profile threshold (project=T1) (one related Low finding still filed: aria-haspopup="true" invalid value at topbar.ts:428 — see cluster 03)`
- `A11Y-7 [x] src/client/ui/topbar.ts:460 settings menu Escape — see cluster 03; modals focus return — see cluster 03`
- `A11Y-8 [-] N/A — below profile threshold (project=T1)`
- `A11Y-9 [x] src/client/ui/drops-panel.ts:43, src/client/ui/toast.ts:6, src/client/ui/topbar.ts:218, src/client/ui/dropdown.ts:211 — see cluster 03`
- `A11Y-10 [-] N/A — below profile threshold (project=T1)`

## I18N

- `I18N-1 [-] N/A — no i18n intent`
- `I18N-2 [-] N/A — no i18n intent`
- `I18N-3 [-] N/A — no i18n intent`

## SEO

- `SEO-1 [-] N/A — auth-gated UI, no crawlable surface`
- `SEO-2 [-] N/A — auth-gated UI, no crawlable surface`
- `SEO-3 [-] N/A — auth-gated UI, no crawlable surface`

## API

- `API-1 [-] N/A — below profile threshold (project=T1)`
- `API-2 [-] N/A — below profile threshold (project=T1)`
- `API-3 [-] N/A — below profile threshold (project=T1)`
- `API-4 [x] src/server/http.ts:449, src/server/ws.ts:206 — see cluster 09`
- `API-5 [x] clean`

## DEP

- `DEP-1 [x] (backend) package.json:32 jsdom 29.0.2→29.1.0 (source: bun outdated 2026-04-28) — see cluster 09`
- `DEP-1 [x] (frontend) package.json:32 — see cluster 09 (same finding)`
- `DEP-2..DEP-9 [x] (backend, frontend) clean — single runtime dep, lockfile present, no abandoned packages, no host-system dep, no runtime-native shadowed`

## NAM

- `NAM-1 [x] (backend) src/server/file-drop.ts:11 maxFilesPerSession — see cluster 09`
- `NAM-1 [x] (frontend) clean`
- `NAM-2 [x] (backend) clean`
- `NAM-2 [x] (frontend) clean`
- `NAM-3 [x] (backend) clean`
- `NAM-3 [x] (frontend) clean`
- `NAM-4 [x] (backend) clean`
- `NAM-4 [x] (frontend) clean`
- `NAM-5 [-] N/A — below profile threshold (project=T1) (one related Low finding still filed: currentSession derivation duplicated three sites — see cluster 10)`
- `NAM-6 [x] (backend) clean`
- `NAM-6 [x] (frontend) clean`
- `NAM-7 [x] (backend) clean`
- `NAM-7 [x] (frontend) clean`
- `NAM-8 [x] (backend, log/CLI) clean`
- `NAM-8 [x] (frontend, UI strings) clean`
- `NAM-8 [x] (docs, *.md + inline comments) clean`

## FE

- `FE-1 [x] (frontend) clean`
- `FE-1 [x] (styling) clean`
- `FE-2 [x] clean`
- `FE-3 [x] clean`
- `FE-4 [x] clean`
- `FE-5 [x] clean`
- `FE-6 [-] N/A — below profile threshold (project=T1)`
- `FE-7 [x] (frontend) clean`
- `FE-7 [x] (styling) clean`
- `FE-8 [x] (frontend) src/client/index.html:52 settings panel role — see cluster 03`
- `FE-8 [x] (styling) src/client/ui/topbar.ts:428 — see cluster 03`
- `FE-9..FE-15 [x] clean`
- `FE-16 [x] clean`
- `FE-17 [-] N/A — below profile threshold (project=T1)`
- `FE-18 [x] clean`
- `FE-19 [x] clean`
- `FE-20 [-] N/A — below profile threshold (project=T1)`
- `FE-21 [x] (frontend, styling) clean`
- `FE-22 [x] (frontend, styling) clean`
- `FE-23 [x] (frontend, styling) clean`

## STYLE

- `STYLE-1 [x] z-index inventory complete; no traps in steady state`
- `STYLE-2 [x] base.css:566,579 same-value duplicates — see cluster 04`
- `STYLE-3 [-] N/A — below profile threshold (project=T1)`
- `STYLE-4 [x] base.css:79,599,827,865 + Amiga/Default theme files (28px topbar magic number) — see cluster 04`
- `STYLE-5 [x] base.css:37,566 (--tw-ui-font); base.css:79,579 (--tw-scrollbar-topbar-offset) — see cluster 04`
- `STYLE-6 [-] N/A — below profile threshold (project=T1)`
- `STYLE-7 [x] index.html:38 #tb-left dead; .tw-scrollbar-pinned no-op — see cluster 04`
- `STYLE-8 [x] clean — :where() zero-specificity, only 2 justified !important`
- `STYLE-9 [-] N/A — below profile threshold (project=T1)`
- `STYLE-10 [x] clean — tw- prefix consistent`
- `STYLE-11 [-] N/A — below profile threshold (project=T1)`

## UX

- `UX-1 [-] N/A — below profile threshold (project=T1)`
- `UX-2 [-] N/A — below profile threshold (project=T1)`

## DB / MIG

- `DB-1..DB-5 [-] N/A — database: absent`
- `MIG-1..MIG-5 [-] N/A — database: absent`

## TEST

- `TEST-1 [x] sleep-poll patterns — see cluster 02`
- `TEST-2 [x] sleep-poll patterns — see cluster 02`
- `TEST-3 [x] tests/fuzz/shell-quote.test.ts:21 space-filter gap`
- `TEST-4 [-] N/A — below profile threshold (project=T1)`
- `TEST-5 [x] post-compile/binary-smoke.test.ts artifact tests verified`
- `TEST-6 [x] playwright.config webServer correct`
- `TEST-7 [x] sleep-poll patterns — see cluster 02`
- `TEST-8 [-] N/A — below profile threshold (project=T1)`
- `TEST-9 [-] N/A — below profile threshold (project=T1)`
- `TEST-10 [x] sampled 32 test files; clean structure`
- `TEST-11 [x] sleep-poll patterns — see cluster 02`
- `TEST-12 [x] waitFor/waitForMsg helpers correct`

## DET

- `DET-1 [x] tests/unit/server/clipboard-policy.test.ts:66,74 (low-impact, determinism-sound)`
- `DET-2 [x] tests/unit/server/_harness/fake-tmux.ts:83 sleep 0.15 shell — see cluster 02 test-determinism`
- `DET-3 [x] file-drop.test.ts utimes pattern correct; hash-cached.test.ts:50 mtime-resolution gap — see cluster 02`
- `DET-4 [x] scripts/test-unit-files.sh ordering enshrined and correct`

## FUZZ

- `FUZZ-1 [x] (security) 9 of ~11 parsers covered; isAuthorized + parseAllowOriginFlag gaps — see cluster 07`
- `FUZZ-1 [x] (test) shell-quote space-filter gap → cluster 02 test-determinism subset OR ship with cluster 07 fuzz additions`

## COV / PROF

- `COV-1..COV-6 [-] N/A — Coverage & Profiling Analyst skipped per user directive (skip coverage)`
- `PROF-1, PROF-2 [-] N/A — Coverage & Profiling Analyst skipped per user directive`

## SEC

- `SEC-1 [x] HTML/script JSON injection (cluster 05); /api/exit chain (cluster 05); WS resource limits (cluster 05); sessions.json file mode (cluster 07); security headers (cluster 07); desktop URL userinfo (cluster 07)`

## CONT / IAC

- `CONT-1, CONT-2, CONT-4 [-] N/A — container: absent`
- `CONT-3 [-] N/A — container: absent`
- `IAC-1, IAC-2, IAC-3 [-] N/A — iac: absent`

## CI

- `CI-1 [x] clean — Actions SHA-pinned across all 3 workflow files`
- `CI-2 [x] clean — permissions scoped per-job`
- `CI-3 [x] clean — bun install --frozen-lockfile in all jobs that install`
- `CI-4 [-] N/A — below profile threshold (project=T1)`
- `CI-5 [x] release.yml:199,215,242 macOS smoke gap + tmux-term structural-only — see cluster 06`

## TOOL

- `TOOL-1 [x] clean`
- `TOOL-2 [x] clean — strict TS + typecheck-in-CI`
- `TOOL-3 [x] package.json:32 jsdom — see cluster 09 (source: bun outdated 2026-04-28)`
- `TOOL-4 [x] bun-build.ts:216 — see cluster 06`
- `TOOL-5 [-] N/A — below profile threshold (project=T1)`
- `TOOL-6 [-] N/A — below profile threshold (project=T1)`
- `TOOL-7 [-] N/A — below profile threshold (project=T1)`

## BUILD

- `BUILD-1 [-] N/A — below profile threshold (project=T1)`
- `BUILD-2 [x] clean — frozen-lockfile + vendor xterm SHA pin`
- `BUILD-3 [-] N/A — below profile threshold (project=T1) (counter-evidence: .bun-version pin exists; tier rule could flip back, but solo project + single toolchain is sufficient at T1)`
- `BUILD-4 [x] release.yml:199,215 Linux comprehensive; macOS pre-package only — see cluster 06`

## GIT

- `GIT-1 [x] clean — LICENSE present (ISC, 2026-04-26)`
- `GIT-2 [-] N/A — below profile threshold (project=T1)`
- `GIT-3 [x] clean — git log -p across *.pem/*.key/secrets/ shows zero hits in 825 commits / 90 days`
- `GIT-4 [x] clean — tags semver, CHANGELOG enforced, SHA-256 sidecars`

## MONO

- `MONO-1 [-] N/A — monorepo: absent`
- `MONO-2 [-] N/A — monorepo: absent`

## DEAD

- `DEAD-1 [-] N/A — below profile threshold (project=T1)`
- `DEAD-2 [x] clean`
- `DEAD-3 [x] clean — zero TODO/FIXME/XXX/HACK across src/ scripts/ bun-build.ts (one false positive: src/server/origin.ts:166 IPv6 hex format example)`

## COM

- `COM-1, COM-2, COM-3 [x] (backend, frontend) clean — comments accurate, well-purposed; "what" comments avoided`

## DOC

- `DOC-1 [x] AGENTS.md prose drift filed — see cluster 08`
- `DOC-2 [x] AGENTS.md three drift sites filed — see cluster 08`
- `DOC-3 [x] README.md three drift sites filed — see cluster 08`
- `DOC-4 [-] N/A — below profile threshold (project=T1)`
- `DOC-5 [-] N/A — below profile threshold (project=T1)`

## META

- `META-1 [~] deferred — drafted by synthesis (see meta.md). Doc-drift recurrence shape captured as the single META-1 candidate.`
