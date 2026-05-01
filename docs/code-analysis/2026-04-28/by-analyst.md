# By-analyst dumps

> Preserved for traceability. For fix work, use the clusters under `./clusters/` — they cross-cut these per-analyst sections.

## Backend Analyst

### Summary

Backend is well-structured for a T1 project: correct timing-safe Basic Auth, consistent input capping, solid path-containment for theme reads, atomic session persistence with proto-poisoning guards, and good PTY lifecycle handling. The two real concerns are fire-and-forget async on the PTY data path (CONC-6, inconsistent WS state on throw) and the synchronous stat-walk on every file upload (EFF-1, event-loop blocking). All other findings are naming accuracy, minor type consistency, and one outdated devDep — none blocking.

### Findings

- CONC-6 — fire-and-forget `handleTitleChange`/`handleReadRequest` on PTY hot path (`src/server/ws.ts:339,348`). Medium · Verified · → see [cluster 01](./clusters/01-async-fire-and-forget.md).
- EFF-1 — `currentRootBytes()` sync stat-walk on every upload (`src/server/file-drop.ts:318`). Low · Verified · → see [cluster 09](./clusters/09-backend-correctness-micro.md).
- NAM-1 — `DropStorage.maxFilesPerSession` is global per-user pool, not per-session (`src/server/file-drop.ts:11`). Low · Verified · autofix-ready · → see [cluster 09](./clusters/09-backend-correctness-micro.md).
- API-4 — desktop bearer token uses `===`, Basic Auth uses `timingSafeEqual` (`src/server/http.ts:449`, `src/server/ws.ts:206`). Low · Verified · autofix-ready · → see [cluster 09](./clusters/09-backend-correctness-micro.md).
- QUAL-3 — `tmuxConf` path unquoted in materialized tmux.conf (`src/server/index.ts:459`). Low · Verified · autofix-ready · → see [cluster 09](./clusters/09-backend-correctness-micro.md).
- TYPE-1 — `as any` casts at five sites for Bun API gaps. Low · Verified · needs-decision · → see [cluster 09](./clusters/09-backend-correctness-micro.md).
- DEP-1 — `jsdom` 29.0.2 → 29.1.0 (one patch). Low · Verified · autofix-ready (source: `bun outdated`, 2026-04-28) · → see [cluster 09](./clusters/09-backend-correctness-micro.md).

### Checklist (owned items)

EFF-1 [x] `src/server/file-drop.ts:318` — see cluster 09.
EFF-2 [x] clean — sampled all server I/O paths.
EFF-3 [x] clean — no dead code in server scope.
PERF-1 [-] N/A — below profile threshold (project=T1).
PERF-3 [x] clean.
PERF-4 [x] clean — `readBodyCapped` cap + `reader.cancel()` 500 ms timeout; subprocess timeouts handled.
PERF-5 [-] N/A — below profile threshold (project=T1).
QUAL-1 [x] clean.
QUAL-2 [x] clean.
QUAL-3 [x] `src/server/index.ts:459` — see cluster 09.
QUAL-4 [x] clean — no over-engineered patterns.
QUAL-5a [x] clean — `validateSessionPatch`, `hasClipboardField`, `MAX_BASE64`, `readBodyCapped`.
QUAL-5b [x] clean — error handling consistent across server I/O.
QUAL-5c [x] clean — `serialiseFileWrite`, `mkdtempSync` cleanup.
QUAL-6 [x] clean.
QUAL-7 [x] clean — no stdlib re-implementations.
QUAL-8 [x] clean.
QUAL-9 [x] clean.
QUAL-10 [x] clean — `parseForegroundFromProc` reads procfs (structured); tmux `-F` outputs are tab-separated structured.
QUAL-11 [x] clean.
ERR-1 [-] N/A — below profile threshold (project=T1).
ERR-2 [-] N/A — below profile threshold (project=T1).
ERR-3 [-] N/A — below profile threshold (project=T1).
ERR-5 [x] clean — graceful degradation paths verified.
CONC-1 [x] clean.
CONC-2 [x] clean — `serialiseFileWrite` chains; PTY lifecycle proper.
CONC-3 [-] N/A — below profile threshold (project=T1).
CONC-4 [-] N/A — below profile threshold (project=T1).
CONC-5 [-] N/A — below profile threshold (project=T1).
CONC-6 [x] `src/server/ws.ts:339,348` — see cluster 01.
CONC-7 [x] clean — bounded sleeps documented for cases without completion signal (e.g., tmux `new-session` polling, applyColourVariant retry).
OBS-1 [-] N/A — below profile threshold (project=T1).
OBS-2 [-] N/A — below profile threshold (project=T1).
OBS-3 [-] N/A — below profile threshold (project=T1).
OBS-4 [-] N/A — below profile threshold (project=T1).
LOG-1 [x] clean.
LOG-2 [x] clean.
LOG-3 [-] N/A — below profile threshold (project=T1).
LOG-4 [-] N/A — below profile threshold (project=T1).
LOG-5 [x] clean.
LOG-6 [x] clean.
LOG-7 [-] N/A — below profile threshold (project=T1).
TYPE-1 [x] `src/server/pty.ts:97`, `src/server/file-drop.ts:432`, `src/server/index.ts:350`, `src/server/tmux-control.ts` — see cluster 09.
TYPE-2 [-] N/A — below profile threshold (project=T1).
TYPE-3 [x] clean — strict TS, no `@ts-ignore`.
API-1 [-] N/A — below profile threshold (project=T1).
API-2 [-] N/A — below profile threshold (project=T1).
API-3 [-] N/A — below profile threshold (project=T1).
API-4 [x] `src/server/http.ts:449`, `src/server/ws.ts:206` — see cluster 09.
API-5 [x] clean.
DEP-1 [x] `package.json:32` (jsdom) — see cluster 09. (source: `bun outdated`, 2026-04-28)
DEP-2 [x] clean.
DEP-3 [x] clean — single runtime dep (`@noble/hashes`).
DEP-4 [-] N/A — below profile threshold (project=T1).
DEP-5 [x] clean.
DEP-6 [x] clean — no abandoned packages.
DEP-7 [x] clean.
DEP-8 [x] clean — `bun.lock` present, single package.
DEP-9 [x] clean — no native equivalent shadowed by external pkg.
NAM-1 [x] `src/server/file-drop.ts:11` — see cluster 09.
NAM-2 [x] clean.
NAM-3 [x] clean.
NAM-4 [x] clean.
NAM-5 [-] N/A — below profile threshold (project=T1).
NAM-6 [x] clean.
NAM-7 [x] clean.
NAM-8 [x] clean — log/CLI strings sampled, idiomatic.
DEAD-1 [-] N/A — below profile threshold (project=T1).
DEAD-2 [x] clean.
COM-1 [x] clean.
COM-2 [x] clean.
COM-3 [x] clean.
MONO-1 [-] N/A — monorepo: absent.
MONO-2 [-] N/A — monorepo: absent.

## Frontend Analyst

### Summary

`src/client/` is in excellent shape for a T1 project. Architecture is clean vanilla TypeScript with well-documented workarounds, consistent naming, comprehensive async safety, and zero abandoned dependencies. Most actionable findings: three missing `void` casts on `onSettingsChange?.()` in `topbar.ts`, a `currentSession` expression duplicated at three sites, one patch-version-behind `jsdom` dev dep. The xterm adapter uses `any` for top-level fields — tolerable but improvable. The `clientLog` telemetry function silently fails under Basic Auth in production — may explain why client-side diagnostics are not reaching deployed instances.

### Findings

- `onSettingsChange` async return dropped at three sites in `topbar.ts` (`:622,758,892`). Low · Verified · autofix-ready · → see [cluster 01](./clusters/01-async-fire-and-forget.md).
- `document.fonts.load` swallows error reason (`src/client/index.ts:284`). Low · Verified · → see [cluster 01](./clusters/01-async-fire-and-forget.md).
- `stripTitleDecoration` parses tmux `set-titles-string` output (`src/client/ui/topbar.ts:1287`). Low · Plausible · → see [cluster 10](./clusters/10-frontend-correctness-micro.md).
- `xterm.ts` private fields typed `any` (`src/client/adapters/xterm.ts:15`). Low · Verified · → see [cluster 10](./clusters/10-frontend-correctness-micro.md).
- DEP-1 jsdom (`package.json:32`). Low · Verified · → see [cluster 09](./clusters/09-backend-correctness-micro.md).
- `clientLog` silently 401s in browser-mode production (`src/client/client-log.ts:6`). Low · Verified · → see [cluster 10](./clusters/10-frontend-correctness-micro.md).
- NAM-5 `currentSession` derivation duplicated three sites (`topbar.ts:948`, `index.ts:100,357`). Low · Verified · → see [cluster 10](./clusters/10-frontend-correctness-micro.md).

### Checklist (owned items)

(Full per-item lines preserved in synthesis output. Frontend filed 10 findings across `src/client/` plus several positive verifications. SEO and I18N items all `[-] N/A` per `auth-gated` / `i18n: absent`. PERF-1, PERF-2, PERF-5, ERR-4, CONC-4, OBS-4, FE-6, FE-17, FE-20, UX-1, DEAD-1, MONO-1/2 all `[-] N/A — below profile threshold (project=T1)`. Remaining FE-* lines and async/text-parsing passes traced clean.)

## Styling Analyst

### Summary

Styling architecture is coherent and well-structured for a T1 project: the `base.css` / theme CSS split is clean, `:where()` is correctly used to keep base color rules at zero specificity, and the CSS variable contract is well-documented. Main issues are housekeeping-level: duplicate same-value custom-property declarations in `base.css`, vestigial `#tb-left` div, the 28px topbar-height magic number scattered across 18+ locations without a CSS variable, double `@import` of `base.css` undocumented in Amiga themes. One A11Y-adjacent item (settings panel missing `role="dialog"`) flagged for decision.

### Findings

- Duplicate same-value `--tw-ui-font` and `--tw-scrollbar-topbar-offset` declarations in `base.css` (`:566,579`). Low · Verified · autofix-ready · → see [cluster 04](./clusters/04-css-housekeeping.md).
- Dead `#tb-left` div (`index.html:38`). Low · Verified · autofix-ready · → see [cluster 04](./clusters/04-css-housekeeping.md).
- `28px` topbar-height magic number 18+ sites. Low · Verified · → see [cluster 04](./clusters/04-css-housekeeping.md).
- `@import url('/dist/client/base.css')` double-load in Amiga themes (`themes/amiga/amiga-common.css:9`). Low · Verified · → see [cluster 04](./clusters/04-css-housekeeping.md).
- `aria-haspopup="true"` invalid + missing `role="dialog"` on `#menu-dropdown` (`topbar.ts:428`, `index.html:52`). Low · Verified · → see [cluster 03](./clusters/03-a11y-and-aria-coherence.md).
- `.tw-scrollbar-pinned` no-op CSS hook (`scrollbar.ts:109`, `index.html:178`). Low · Verified · → see [cluster 04](./clusters/04-css-housekeeping.md).

### Checklist (owned items)

STYLE-1 [x] z-index inventory complete; no traps in steady state. STYLE-2 [x] same-value duplicates filed. STYLE-4 [x] 28px filed. STYLE-5 [x] `--tw-ui-font`/`--tw-scrollbar-topbar-offset` filed. STYLE-7 [x] `#tb-left`, `.tw-scrollbar-pinned` filed. STYLE-8 [x] clean — `:where()` zero-specificity, only 2 `!important` (justified). STYLE-10 [x] clean — `tw-` prefix consistent. STYLE-3, STYLE-6, STYLE-9, STYLE-11 [-] N/A. FE-1, FE-7, FE-8, FE-21, FE-22, FE-23 [x] clean (frontend lens) or filed under cluster 04. A11Y-3 [-] N/A — palette-coherence rendering combinations require systematic WCAG audit not warranted at T1; status-dot color cue mitigated. UX-1 [-] N/A. PERF-2 [-] N/A. FE-6 [-] N/A.

## Accessibility Analyst

### Summary

The a11y implementation is meaningfully intentional in several places — modals have focus traps and ARIA attributes, the custom dropdown system implements `aria-activedescendant` and keyboard navigation, session status dots have `role="img"` + `aria-label` and a shape cue for colour-blind users. Main gaps: settings menu cannot be dismissed with Escape (most-impactful keyboard break); three native `<select>`s remain in tab order after custom dropdown replacement; `#btn-session-plus` has no accessible name. All findings are Small-effort fixes. Tier and applicability look correct.

### Findings

- `#btn-session-plus` no accessible name (`index.html:40`). Medium · Verified · autofix-ready · → see [cluster 03](./clusters/03-a11y-and-aria-coherence.md).
- Native `<select>` not removed from tab order (`dropdown.ts:391`). Medium · Verified · autofix-ready · → see [cluster 03](./clusters/03-a11y-and-aria-coherence.md).
- Settings menu no Escape (`topbar.ts:460`). Medium · Verified · autofix-ready · → see [cluster 03](./clusters/03-a11y-and-aria-coherence.md).
- `aria-haspopup="true"` invalid value (`topbar.ts:428`). Low · Verified · autofix-ready · → see [cluster 03](./clusters/03-a11y-and-aria-coherence.md).
- Text inputs no programmatic label (`topbar.ts:218`, `dropdown.ts:211`). Medium · Verified · → see [cluster 03](./clusters/03-a11y-and-aria-coherence.md).
- Drop rows not keyboard-accessible (`drops-panel.ts:43`). Low · Verified · autofix-ready · → see [cluster 03](./clusters/03-a11y-and-aria-coherence.md).
- Toast no live region (`toast.ts:6`). Low · Verified · autofix-ready · → see [cluster 03](./clusters/03-a11y-and-aria-coherence.md).
- Modals do not return focus on close (`clipboard-prompt.ts:70`, `confirm-modal.ts:81`). Low · Verified · → see [cluster 03](./clusters/03-a11y-and-aria-coherence.md).
- Range slider `aria-label` ↔ `<label>` text mismatch (`index.html:106,116,121`). Low · Verified · → see [cluster 03](./clusters/03-a11y-and-aria-coherence.md).
- A11Y-3 status-dot color (`base.css:426`, `topbar.ts:303`). Low · Verified · → see [cluster 03](./clusters/03-a11y-and-aria-coherence.md).

### Checklist (owned items)

A11Y-1 [x] filed. A11Y-2 [x] filed. A11Y-3 [x] filed (joint with Styling). A11Y-4 [-] N/A. A11Y-5 [x] clean — `aria-hidden` on focusable elements verified clean. A11Y-6 [-] N/A. A11Y-7 [x] filed. A11Y-8 [-] N/A. A11Y-9 [x] filed. A11Y-10 [-] N/A. UX-2 [-] N/A.

## Test Analyst

### Summary

Test suite is well-structured for a T1 project: strong unit coverage of server-side state machines via `startTestServer` harness, correct artifact-level smoke tests wired into CI against the extracted tarball, and nine fuzz suites covering security-sensitive parsers. Primary quality gap: a cluster of sleep-poll synchronization patterns where structured completion signals exist or could be introduced. None represents a false-positive test result today, but they create asymmetric flake risk under CI load. One actionable correctness gap: `shell-quote` fuzz property filters out space-containing inputs, which is the most important input class for shell quoting.

### Findings

- All sleep-poll cleanup findings → see [cluster 02](./clusters/02-test-sleep-poll-cleanup.md).
- `shell-quote` fuzz property excludes space-containing strings (`tests/fuzz/shell-quote.test.ts:21`). Medium · Verified · autofix-ready. Notes: `shellQuote` wraps in single quotes; the `.filter(s => !s.includes(' '))` guard is over-conservative. Fix: remove the filter (or replace with `\x00` exclusion only). This is a Test-analyst finding sized at Medium because the property cannot detect a regression on the most important shell-quoting input class. **NOT clustered above** — file directly here for the fix coordinator. Add to cluster 07 if it ships in the same PR as the FUZZ-1 parser additions, otherwise standalone.
- `binary-smoke.test.ts:41` uses `Math.random()` for port. Low · Plausible · → see [cluster 02](./clusters/02-test-sleep-poll-cleanup.md) (test-determinism subset).
- DET-1 `Date.now()` in clipboard-policy fixture data (`clipboard-policy.test.ts:66,74`). Low · Verified · low-impact, determinism-sound in practice.

### Checklist (owned items)

TEST-1, TEST-2, TEST-3, TEST-5, TEST-6, TEST-7, TEST-10, TEST-11, TEST-12 [x] all addressed; sleep-poll lines filed in cluster 02. TEST-4, TEST-8, TEST-9 [-] N/A. DET-1, DET-2, DET-3, DET-4 [x] addressed; `Date.now()` and `sleep 0.15` filed; `test-unit-files.sh` ordering correctly enshrined. FUZZ-1 [x] clean for 9 of ~11 parsers; gaps for `isAuthorized` and `parseAllowOriginFlag` filed in cluster 07.

## Security Analyst

### Summary

Repo's security posture is unusually mature for a T1 hobby tool: documented threat model in AGENTS.md/README, intentional local-first calibration (loopback allowlist default, opt-in LAN), constant-time password compare, atomic exclusive-create TLS key writes with `0o600`, per-binary BLAKE3-pinned OSC 52 grants, central typed validator on `/api/session-settings` PUT, fuzz coverage on 9 of ~11 parsers, IP/Origin double-gate on every HTTP and WS path, request-time session snapshotting on OSC 52 reads, drop quota cap, scoped GITHUB_TOKEN permissions and SHA-pinned Actions in CI. The two issues that move the needle: `<script>`-tag JSON injection (Medium, autofix) and the macOS packaged-binary smoke gap (Medium). Everything else is Low or below.

### Findings

- HTML/`<script>` JSON injection (`src/server/http.ts:414`). Medium · Verified · autofix-ready · → see [cluster 05](./clusters/05-html-injection-and-csrf-chain.md).
- macOS post-package smoke gap (`.github/workflows/release.yml:199`). Medium · Verified · → see [cluster 06](./clusters/06-ci-and-build-artifact-verification.md).
- `/api/exit` CSRF chain (`src/server/http.ts:740`). Low · Verified · → see [cluster 05](./clusters/05-html-injection-and-csrf-chain.md).
- WS resource limits (`src/server/ws.ts:289`). Low · Plausible · → see [cluster 05](./clusters/05-html-injection-and-csrf-chain.md).
- `sessions.json` file mode (`src/server/sessions-store.ts:117`). Low · Verified · autofix-ready · → see [cluster 07](./clusters/07-security-low-defenses.md).
- No security headers (`src/server/http.ts:771,251`). Low · Verified · → see [cluster 07](./clusters/07-security-low-defenses.md).
- Desktop URL userinfo (`src/desktop/auth.ts:42`). Low · Verified · → see [cluster 07](./clusters/07-security-low-defenses.md).
- FUZZ-1 missing parsers (`isAuthorized`, `parseAllowOriginFlag`). Low · Verified · → see [cluster 07](./clusters/07-security-low-defenses.md).

### Checklist (owned items)

SEC-1 [x] all sites filed in clusters 05/07. GIT-3 [x] clean — `git log --all -p` against `*.pem`/`*.key`/`secrets/` shows zero hits across 825 commits in 90 days. FUZZ-1 [x] 9/~11 covered; gaps filed in cluster 07. CI-1 [x] clean (joint with Tooling — Actions SHA-pinned). CI-2 [x] clean. CI-3 [x] clean (`bun install --frozen-lockfile`). CI-4 [-] N/A. CI-5 [x] macOS gap filed in cluster 06. CONT-3 [-] N/A. IAC-1..3 [-] N/A.

## Tooling Analyst

### Summary

Tooling and CI infrastructure for this T1 project is notably well-constructed: four separate tsconfigs cover every source surface except test files, all CI action pins use SHA digests, frozen-lockfile is enforced, the release pipeline has comprehensive post-compile smoke tests on Linux against the extracted tarball binary. Two substantive issues: silent-success footgun in `bun-build.ts` when client build fails with warm `dist/` directory, and the `tests/**` typecheck exclusion. One dependency patch update (`jsdom 29.0.2→29.1.0`).

### Findings

- `bun-build.ts:216` silent success on warm cache. Medium · Verified · autofix-ready · → see [cluster 06](./clusters/06-ci-and-build-artifact-verification.md).
- `tsconfig.tooling.json:40` excludes `tests/**`. Low · Verified · → see [cluster 11](./clusters/11-typecheck-tests-gap.md) (deferred).
- DEP-1 / TOOL-3 jsdom one patch outdated (source: `bun outdated`, 2026-04-28). Low · Verified · autofix-ready · → see [cluster 09](./clusters/09-backend-correctness-micro.md).
- `tmux-term` Linux structural-only smoke (`scripts/verify-electrobun-bundle.ts`). Low · Verified · → see [cluster 06](./clusters/06-ci-and-build-artifact-verification.md).

### Checklist (owned items)

TOOL-1, TOOL-2 [x] clean. TOOL-3 [x] jsdom — see cluster 09. TOOL-4 [x] cluster 06 build-pipeline finding. TOOL-5, TOOL-6, TOOL-7 [-] N/A. BUILD-1 [-] N/A. BUILD-2 [x] clean. BUILD-3 [-] N/A. BUILD-4 [x] cluster 06 macOS smoke + tmux-term smoke. GIT-2 [-] N/A. GIT-4 [x] clean. CI-1, CI-2, CI-3 [-] N/A (joint min-tier T2). CI-5 [x] cluster 06. CI-4 [-] N/A. CONT-* [-] N/A. IAC-* [-] N/A.

## Docs Consistency Analyst

### Summary

Documentation is high-quality for a T1 solo project at this velocity. All load-bearing file paths referenced in both README and AGENTS.md resolve correctly. CLI defaults (0.0.0.0:4022, Basic Auth on, TLS on, tmux default) match the implementation. Five findings are all Low severity and mechanical to fix; none indicate behavioral misunderstanding by a future contributor. Recurring drift pattern is a well-written explanation becoming stale after a follow-on code change without a corresponding AGENTS.md update — expected cost of a fast-moving solo repo. No stale TODOs, no misspellings, no inline comment lies in the focus files.

### Findings

- All six findings → see [cluster 08](./clusters/08-doc-drift.md).

### Checklist (owned items)

DOC-1 [x] AGENTS reconnect/theme-defaults/topbar drift filed. DOC-2 [x] same. DOC-3 [x] README CLI gaps filed. DOC-4, DOC-5 [-] N/A. META-1 [~] deferred — drafted by synthesis (see `meta.md`). NAM-8 [x] clean. GIT-1 [x] clean — LICENSE present (ISC). DEAD-3 [x] clean — zero TODO/FIXME/XXX/HACK across `src/`/`scripts/`/`bun-build.ts`.

## Database Analyst

_Not applicable — Scout flag `database: absent` (in-memory `sessions-store.ts` only; no SQL/NoSQL dependency)._

## Coverage & Profiling Analyst

_Not applicable — skipped per user directive (`skip coverage`). The static-pass items (COV-1..COV-6, PROF-1..PROF-2) were not analyzed this run. Project does have a `bun run coverage:check` command and a `scripts/check-coverage.ts` threshold gate (auto-detected during preflight) — coverage tracking infrastructure is in place._
