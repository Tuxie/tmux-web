# Checklist

Rendered per-item in ID order, grouped by category. Multi-owner items show one line per owning scope (per `synthesis.md` §4). Defect-demoted entries appear verbatim with their `— defect: …` suffix; this run had no defects.

## EFF — Efficiency

- `EFF-1 [x] (backend) clean — sampled 22/24 server files; no O(n²) or large-constant loops on hot paths`
- `EFF-1 [x] (frontend) src/client/index.ts:62 — main() does serial work; net cost small at T2`
- `EFF-2 [x] (backend) clean — all tmux subcommands async; PTY data event-driven`
- `EFF-2 [x] (frontend) src/client/session-settings.ts:144 — see cluster 11-frontend-ws-and-input`
- `EFF-3 [x] (backend) src/server/file-drop.ts:115 — pendingAutoUnlinks Map cleared on rmDrop`
- `EFF-3 [x] (frontend) src/client/ui/topbar.ts:541 — see cluster 11-frontend-ws-and-input`

## PERF — Performance beyond algorithm

- `PERF-1 [x] (backend) src/server/clipboard-policy.ts:32-40 — see cluster 15-backend-low-cleanup`
- `PERF-1 [x] (frontend) src/client/adapters/xterm.ts:338-374 — see cluster 10-bench-baseline-and-hot-path`
- `PERF-2 [x] (frontend) clean — sampled oklab/fg-contrast/tui-saturation/xterm-cell-math; bench covers them`
- `PERF-3 [x] (backend) clean — per-connection state cleaned; rate-limit maps capped`
- `PERF-3 [x] (frontend) clean — scrollbar uses RAF-equivalent throttling`
- `PERF-4 [x] (backend) clean — sendBytesToPane has 5s default timeout; cluster-04 from 2026-04-21 verified resolved`
- `PERF-5 [-] (backend) N/A — below profile threshold (project=T2)`
- `PERF-5 [x] (frontend) src/client/adapters/xterm.ts:119 — load order intentional per upstream`

## QUAL — Code quality

- `QUAL-1 [x] (backend) src/server/ws.ts:1071-1148 — see cluster 01-tmux-control-and-listings`
- `QUAL-1 [x] (frontend) src/client/index.ts:41 — see cluster 17-naming-consistency`
- `QUAL-2 [x] (backend) clean — module boundaries tight; single-responsibility`
- `QUAL-2 [x] (frontend) clean — Topbar size reflects 17-slider table not sprawl`
- `QUAL-3 [x] (backend) clean — consistent style except sanitiz/sanitis blip`
- `QUAL-3 [x] (frontend) clean — sampled pure-math files; well-decomposed`
- `QUAL-4 [x] (backend) clean — no over-engineering relative to T2`
- `QUAL-4 [x] (frontend) clean — no over-engineering relative to T2`
- `QUAL-5a [x] (backend) clean — sanitisation, --argv anchoring, body caps verified`
- `QUAL-5a [x] (frontend) — see cluster 13-frontend-ui-quality (slider clamp)`
- `QUAL-5b [x] (backend) clean — external I/O try/catch consistent`
- `QUAL-5b [x] (frontend) clean — error-path coverage reviewed`
- `QUAL-5c [x] (backend) clean — fd close in finally, PTY/watchers killed on exit`
- `QUAL-5c [x] (frontend) clean — scrollbar/file-drop/connection cleanups verified`
- `QUAL-6 [x] (backend) clean — idiomatic Bun/Node patterns`
- `QUAL-6 [x] (frontend) clean — client-log try/catch fallback intentional`
- `QUAL-7 [x] (backend) clean — no stdlib reimplementations`
- `QUAL-7 [x] (frontend) clean — magic numbers named`
- `QUAL-8 [x] (backend) clean — workarounds documented inline`
- `QUAL-8 [x] (frontend) src/client/ui/topbar.ts:621 — see cluster 13-frontend-ui-quality`
- `QUAL-9 [x] (backend) clean — protocol.ts mirror correct; no cross-boundary duplication`
- `QUAL-9 [x] (frontend) clean — sampled validation at module boundaries`
- `QUAL-10 [x] (backend) src/server/ws.ts:1083 — see cluster 01-tmux-control-and-listings`
- `QUAL-10 [x] (frontend) clean — text-parsing pass: structured-value smell not present in client`
- `QUAL-11 [x] (backend) clean — notification surface returns structured types`
- `QUAL-11 [x] (frontend) clean — same as QUAL-10`

## ERR — Error handling patterns

- `ERR-1 [x] (backend) clean — retry patterns appropriate (applyColourVariant, sendStartupWindowState, tmuxControl.run fallback)`
- `ERR-2 [x] (backend) clean — atomic .part → rename writes`
- `ERR-3 [-] (backend) N/A — below profile threshold (project=T2)`
- `ERR-4 [x] (frontend) src/client/index.ts:359 — see cluster 11-frontend-ws-and-input`
- `ERR-5 [x] (backend) clean — JSON.parse try/catched; PTY exit handled`
- `ERR-5 [x] (frontend) src/client/connection.ts:42 — see cluster 11-frontend-ws-and-input`

## CONC — Concurrency correctness

- `CONC-1 [x] (backend) clean — per-connection state on ws.data.state; no shared module-scope state`
- `CONC-1 [x] (frontend) clean — sampled all WS / async-data sites`
- `CONC-2 [x] (backend) clean — void annotations are intentional fire-and-forget`
- `CONC-2 [x] (frontend) clean — index.ts boot path awaits cleanly`
- `CONC-3 [x] (backend) clean — no WS connection cap; T2 absence-is-correct`
- `CONC-4 [-] (backend) N/A — below profile threshold (project=T2)`
- `CONC-4 [x] (frontend) clean — Topbar.refreshCachedSessions serialises concurrent calls`
- `CONC-5 [-] (backend) N/A — no lock primitives in use`
- `CONC-6 [x] (backend) src/server/sessions-store.ts:121-126 — see cluster 15-backend-low-cleanup`
- `CONC-6 [x] (frontend) clean — async-event pass: all wait for real events`
- `CONC-7 [x] (backend) src/server/http.ts:620 — see cluster 15-backend-low-cleanup`
- `CONC-7 [x] (frontend) clean — sleep/poll pass: all setTimeout instances are one-shots`

## OBS — Observability beyond logs

- `OBS-1 [-] (backend) N/A — below profile threshold (project=T2)`
- `OBS-2 [-] (backend) N/A — below profile threshold (project=T2)`
- `OBS-3 [x] (backend) clean — no /health endpoint; for T2 personal-use systemd service behind auth, absence is correct`
- `OBS-4 [-] (backend) N/A — no telemetry emitted`
- `OBS-4 [x] (frontend) clean — client-log.ts for diagnostic posts`

## LOG — Logging

- `LOG-1 [x] (backend) clean — startup failures logged; origin rejects logged; OSC 52 oversized writes logged`
- `LOG-2 [x] (backend) clean — recoverable parse failures console.warn; debug() with structured key=value`
- `LOG-3 [x] (backend) clean — startup listening line; reset action logs; PTY spawn at debug`
- `LOG-4 [x] (backend) clean — [debug] / [themes] / tmux-web: prefixes consistent`
- `LOG-5 [x] (backend) clean — appropriate severity levels`
- `LOG-6 [x] (backend) clean — no contradictory messages observed`
- `LOG-7 [x] (backend) clean — consistent structured key=value format`

## TYPE — Type safety

- `TYPE-1 [x] (backend) src/server/colours.ts:28, src/server/file-drop.ts:297, src/server/pty.ts:76 — minor as-any casts at unavoidable boundaries`
- `TYPE-1 [x] (frontend) src/client/adapters/xterm.ts:15 — private term!: any plus 6 other any casts justified by xterm.js WebGL internals`
- `TYPE-2 [x] (backend) clean — public surfaces typed`
- `TYPE-2 [x] (frontend) src/client/ui/topbar.ts:446 — see cluster 13-frontend-ui-quality`
- `TYPE-3 [x] (backend) clean — non-null assertions limited and safe`
- `TYPE-3 [x] (frontend) clean — no @ts-ignore / @ts-expect-error in client/desktop/shared scope`

## A11Y — Accessibility

- `A11Y-1 [x] (frontend) src/client/index.html:71-171 — see cluster 09-frontend-a11y`
- `A11Y-2 [x] (frontend) src/client/ui/clipboard-prompt.ts:79-95 — see cluster 09-frontend-a11y`
- `A11Y-3 [x] (frontend) clean — status-dot aria-label added in 2026-04-21 cluster 05; verified`
- `A11Y-4 [x] (frontend) clean — keyboard navigation per AGENTS.md §7b; aria-activedescendant correct`
- `A11Y-5 [x] (frontend) src/client/ui/topbar.ts — see cluster 09-frontend-a11y`

## I18N — Internationalization

- `I18N-1 [-] (frontend) N/A — no i18n intent`
- `I18N-2 [-] (frontend) N/A — no i18n intent`
- `I18N-3 [-] (frontend) N/A — no i18n intent`

## SEO — SEO / frontend metadata

- `SEO-1 [-] (frontend) N/A — auth-gated UI, no crawlable surface`
- `SEO-2 [-] (frontend) N/A — auth-gated UI, no crawlable surface`
- `SEO-3 [-] (frontend) N/A — auth-gated UI, no crawlable surface`

## API — API contract

- `API-1 [-] (backend) N/A — below profile threshold (project=T2); no versioned API contract`
- `API-2 [-] (backend) N/A — below profile threshold (project=T2); no OpenAPI spec`
- `API-3 [x] (backend) clean — JSON responses consistent`
- `API-4 [x] (backend) clean — read-only endpoints have method guards (405-on-non-GET); cluster-03 fix verified`
- `API-5 [x] (backend) clean — /api/sessions / /api/windows / /api/drops return structured projections`

## DEP — Dependencies

- `DEP-1 [x] (backend+frontend) src/server scope: backend-only @noble/hashes; frontend deps refreshed 2026-04-23. Patch lag on @types/bun — see cluster 07-release-pipeline-hygiene`
- `DEP-2 [x] (backend+frontend) clean — no overlapping packages`
- `DEP-3 [x] (backend) clean — every declared dep imported`
- `DEP-3 [-] (frontend) N/A — no peer-dep declaration in client scope`
- `DEP-4 [x] (backend+frontend) clean — Bun.spawn / Bun.serve / vendor/xterm.js submodule used appropriately`
- `DEP-5 [x] (backend+frontend) clean — execFile/timingSafeEqual/parseArgs/realpathSync/BLAKE3 chosen well`
- `DEP-6 [x] (backend+frontend) clean — no abandoned packages`
- `DEP-7 [-] (backend+frontend) N/A — no backwards-compat shims; frontend has no separate lockfile`
- `DEP-8 [x] (backend+frontend) clean — host deps probed at startup with graceful fallback; license MIT matches`
- `DEP-9 [x] (backend+frontend) clean — no peerDependencies; runtime is Bun, declared in .bun-version`

## NAM — Naming & layout

- `NAM-1 [x] (backend) src/server/pty.ts:15 — see cluster 17-naming-consistency`
- `NAM-1 [x] (frontend) src/client/index.ts:41 — see cluster 17-naming-consistency`
- `NAM-2 [x] (backend+frontend) clean — kebab-case files, camelCase functions, PascalCase types`
- `NAM-3 [x] (backend+frontend) clean — consistent prefixed type names; tw- class prefix per AGENTS.md`
- `NAM-4 [x] (backend+frontend) clean — element ids per "DOM Contract" section; no inverted booleans`
- `NAM-5 [x] (backend+frontend) clean — function names match what they do`
- `NAM-6 [x] (backend+frontend) clean — variable / type names self-explanatory`
- `NAM-7 [x] (backend+frontend) clean — _ prefix for test-only exports applied consistently`
- `NAM-8 [x] (backend) clean — log messages and CLI output correctly punctuated`
- `NAM-8 [x] (frontend) UI strings English-only; consistent capitalisation/tone`
- `NAM-8 [x] (docs) clean — sampled docs and inline comments; no naming drift`

## FE — Frontend code practices

- `FE-1 [x] src/client/index.html:7-19 — sync-before-deferred-module pattern documented`
- `FE-2 [x] src/client/ui/topbar.ts:346 — see cluster 12-frontend-topbar-teardown`
- `FE-3 [x] clean — no XSS surface; textContent everywhere`
- `FE-4 [x] clean — getComputedStyle reads intentional, not hot-path`
- `FE-5 [x] src/client/ui/topbar.ts:541-619 — see cluster 11-frontend-ws-and-input`
- `FE-6 [x] clean — Connection.reconnect cleans up correctly`
- `FE-7 [x] src/client/connection.ts:75-79 — see cluster 14-frontend-low-architectural`
- `FE-8 [x] clean — setStyleProperty defensive JSDOM fallback reasonable`
- `FE-9 [x] clean — sole runtime dep server-side`
- `FE-10 [x] clean — vendor/@xterm/xterm pinned via submodule`
- `FE-11 [x] clean — bun-build.ts inlines all xterm addons`
- `FE-12 [x] clean — no third-party JS at runtime`
- `FE-13 [-] N/A — no third-party CSS`
- `FE-14 [x] clean — favicon inline data: URL`
- `FE-15 [x] clean — no service worker / manifest needed`
- `FE-16 [x] clean — bun-build.ts bundles correctly`
- `FE-17 [x] clean — single SPA route`
- `FE-18 [x] clean — WebSocket reconnect with 2s linear backoff appropriate at T2`
- `FE-19 [x] src/client/ui/topbar.ts:1052 — lastWinTabsKey memoisation reasonable`
- `FE-20 [x] clean — installAuthenticatedFetch returns original fetch unchanged`
- `FE-21 [x] clean — auth-url.ts:withClientAuth preserves cross-origin URLs`
- `FE-22 [x] src/client/index.ts:194-196 — adapter.focus() after init; setupFocusHandling correct`
- `FE-23 [x] clean — index.html has charset/viewport/icon metadata fundamentals`

## UX — Frontend UX

- `UX-1 [x] src/client/ui/topbar.ts:288,977 — see cluster 13-frontend-ui-quality`
- `UX-2 [x] src/client/index.ts:84-91 — see cluster 13-frontend-ui-quality`

## DB — Database schema

- _All N/A — Scout flag `database: absent`._

## MIG — Migration safety

- _All N/A — no DB / migrations._

## TEST — Tests

- `TEST-1 [x] tests/unit/build/ — see cluster 20-test-and-coverage-gaps`
- `TEST-2 [x] tests/e2e/tls.test.ts:19,49 — see cluster 05-ci-artifact-verification`
- `TEST-3 [x] clean — sampled 30+ tests; assertions specific`
- `TEST-4 [x] tests/unit/server/_harness/spawn-server.ts:117 — port: 0; PORTS.md fixed-port allocation`
- `TEST-5 [x] mkdtempSync per test; afterEach close`
- `TEST-6 [x] desktop/server-process.test.ts:30-79 + ws-handle-connection.test.ts:64-85 helpers; legacy raw setTimeout sites — see TEST-11`
- `TEST-7 [x] playwright.config.ts:34-45 — webServer.command starts bun source server fresh per run`
- `TEST-8 [x] tests/fuzz/sanitise-filename.test.ts:14,54 + auth tests + injection rejections; tier-appropriate coverage`
- `TEST-9 [x] clean — race coverage thorough`
- `TEST-10 [x] clean — Bug 3/Bug 4 use real promise gates`
- `TEST-11 [x] ws-handle-connection.test.ts:208,240,245,493,506,1015,1190,1281; e2e specs — see cluster 18-test-flaky-sleeps`
- `TEST-12 [x] ws-handle-connection.test.ts:769; pty-integration.test.ts:14-19 — see cluster 19-test-assertion-quality`

## DET — Test determinism

- `DET-1 [x] clean — fuzz numRuns deterministic`
- `DET-2 [x] menu-session-switch-content.spec.ts:11-14 nextRandom() seeded LCG; silence-console.ts:69 buffer reset`
- `DET-3 [x] PORTS.md:1 + scrollbar.spec.ts:10-15 worker-indexed port — see cluster 21-test-organisation`
- `DET-4 [x] silence-console.ts:60 — see cluster 21-test-organisation`

## FUZZ — Property / fuzz opportunities

- `FUZZ-1 [x] (test) tests/fuzz/ 9 files matching AGENTS.md's nine parsers; two strengthening findings — see cluster 21-test-organisation`
- `FUZZ-1 [x] (security) trust-boundary review verified; gaps in parseScrollbarState and bracketed-paste composition documented`

## COV — Test coverage

- `COV-1 [x] src/desktop/index.ts (0% — invisible to gate); see cluster 20-test-and-coverage-gaps`
- `COV-2 [x] src/server/index.ts startServer() body (26.5% lines) — see cluster 20-test-and-coverage-gaps`
- `COV-3 [x] scripts/check-coverage.ts:11-23 — EXCLUDES + missing-from-lcov blind spot — see cluster 20-test-and-coverage-gaps`

## PROF — Profiling / benchmarking

- `PROF-1 [x] scripts/bench-render-math.ts covers only primitives, not per-cell hot path — see cluster 10-bench-baseline-and-hot-path`
- `PROF-2 [x] No *.prof / flamegraph / bench/results / baseline JSON in tree — see cluster 10-bench-baseline-and-hot-path`

## SEC — Security

- `SEC-1 [x] (security) multiple anchors filed across http.ts/ws.ts/ws-router.ts/tmux-inject.ts/release.yml/bump-homebrew-tap.yml — see clusters 03 / 04 / 05`

## CONT — Container / image security

- `CONT-1 [-] (tooling+security) N/A — container absent`
- `CONT-2 [-] (tooling) N/A — container absent`
- `CONT-3 [-] (security) N/A — container absent`
- `CONT-4 [-] (tooling) N/A — container absent`

## CI — CI supply chain & workflow security

- `CI-1 [x] (tooling+security) .github/workflows/release.yml:113 — see cluster 06-ci-and-release-improvements`
- `CI-2 [x] (tooling+security) .github/workflows/release.yml:1 — see cluster 06-ci-and-release-improvements`
- `CI-3 [x] (tooling+security) clean — secrets via secrets: block; no echo of env vars`
- `CI-4 [-] (tooling+security) N/A — below profile threshold (project=T2)`
- `CI-5 [x] (tooling+security) .github/workflows/release.yml:144-165 — see cluster 05-ci-artifact-verification`

## TOOL — Tooling & build

- `TOOL-1 [x] bun-build.ts:28-154 — vendor-xterm patching load-bearing and well-commented`
- `TOOL-2 [x] clean — no shell-injection or unsafe spawn patterns in scripts/`
- `TOOL-3 [x] package.json:27 — see cluster 07-release-pipeline-hygiene`
- `TOOL-4 [x] tsconfig.* and tests/ — see cluster 06-ci-and-release-improvements`
- `TOOL-5 [x] Makefile:42-69 — fuzz dep + CI typecheck divergence`
- `TOOL-6 [x] clean — bunfig.toml / playwright.config.ts / electrobun.config.ts correct`
- `TOOL-7 [x] package.json:9-21 — dev script & background pattern documented intent`

## BUILD — Build reproducibility

- `BUILD-1 [x] bun-build.ts:28-154 — vendor patching verified`
- `BUILD-2 [x] Makefile:73-77 — local and CI build flags match`
- `BUILD-3 [x] clean — Makefile:79-85 install target uses POSIX install`
- `BUILD-4 [x] .github/workflows/release.yml:141-142 — see cluster 05-ci-artifact-verification`

## GIT — Git hygiene

- `GIT-1 [x] (docs) LICENSE:1 MIT, matches package.json:6 and README:198 link`
- `GIT-2 [x] (tooling) .gitmodules:1-3 — single submodule, HTTPS URL, pinned HEAD`
- `GIT-3 [x] (security) clean — .gitignore covers all sensitive shapes`
- `GIT-4 [x] (tooling) .gitignore:1-26 — covers expected build outputs`

## IAC — Infrastructure as Code

- `IAC-1 [-] (tooling+security) N/A — iac absent`
- `IAC-2 [-] (tooling+security) N/A — iac absent`
- `IAC-3 [-] (tooling+security) N/A — iac absent`

## MONO — Monorepo boundary violations

- _All N/A — Scout flag `monorepo: absent`._

## DEAD — Dead flags, deprecations, stale TODOs

- `DEAD-1 [x] (backend) clean — --theme legacy no-op documented; test-only exports intentional`
- `DEAD-1 [x] (frontend) clean — sampled exports`
- `DEAD-2 [x] (backend) clean — no @deprecated symbols in scope`
- `DEAD-2 [x] (frontend) src/client/connection.ts:75-79 — see cluster 14-frontend-low-architectural`
- `DEAD-3 [x] (docs) clean — zero TODO/FIXME/XXX/HACK markers`

## COM — Comments & inline documentation

- `COM-1 [x] (backend) clean — non-obvious code well-commented`
- `COM-1 [x] (frontend) clean — workarounds annotated per AGENTS.md`
- `COM-2 [x] (backend) clean — comments verified against code`
- `COM-2 [x] (frontend) clean — no stale comments in sampled files`
- `COM-3 [x] (backend) clean — safeStringEqual comment now matches behaviour`
- `COM-3 [x] (frontend) clean — no commented-out code blocks`

## DOC — Documentation

- `DOC-1 [x] (docs) tests/fuzz/README.md:18 — see cluster 08-docs-drift`
- `DOC-2 [x] (docs) AGENTS.md:316,362,71-100 — see cluster 08-docs-drift`
- `DOC-3 [x] (docs) README.md:181,194,25 — see cluster 08-docs-drift`
- `DOC-4 [x] (docs) clean — sampled top-level meta files plus specs/plans; no genuinely ambiguous wording`
- `DOC-5 [x] (docs) AGENTS.md restructure for new contributors — covered under DOC-2 (tmux-term invisibility)`

## META — Agent-instruction maintenance

- `META-1 [x] (docs) CHANGELOG Unreleased empty + duplicate 1.5.1 heading — see cluster 08-docs-drift; META rules drafted in meta.md`
