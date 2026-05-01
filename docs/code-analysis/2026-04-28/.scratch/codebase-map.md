# Codebase map — Structure Scout output

# File inventory

**Top-level bucket counts (git ls-files):**

| Directory / file group | Files |
|---|---|
| `tests/` | 162 |
| `docs/` | 162 |
| `src/` | 69 |
| `themes/` | 23 |
| `scripts/` | 11 |
| `.github/` | 3 |
| `vendor/` | 1 (submodule pointer) |
| Root-level files (Makefile, package.json, tsconfigs, service files, etc.) | ~22 |

Total tracked: ~453 files (excluding untracked build outputs and node_modules).

**Submodules (.gitmodules present):**
- `vendor/xterm.js` — pinned to upstream `xtermjs/xterm.js` HEAD commit; built from source by `bun-build.ts`, never taken from npm.

# Tech stack

- **Language:** TypeScript — every file under `src/`, `tests/`, `scripts/` is `.ts`; `tsconfig.json` at root.
- **Runtime:** Bun 1.3.13 — declared in `.bun-version` and locked in `bun.lock`; `@types/bun ^1.3.13` in `package.json`.
- **Frontend framework:** Vanilla TypeScript + xterm.js — `src/client/index.ts` directly instantiates `XtermAdapter`; no React/Vue.
- **Desktop shell:** Electrobun 1.16.0 — `electrobun.config.ts`, `src/desktop/`, `electrobun` in devDependencies.
- **Bundler:** Bun's native build API — `bun-build.ts` calls `build({ entrypoints: ['src/client/index.ts'], target: 'browser' })`.
- **Test runners:** Bun test (`bun test`) for unit/fuzz; Playwright (`@playwright/test ^1.59.1`) for e2e.
- **Fuzz library:** fast-check 4.7.0 — `tests/fuzz/*.test.ts`.
- **Database:** None — sessions held in in-memory store (`src/server/sessions-store.ts`); no SQL/NoSQL dependency.
- **TLS:** Self-signed cert generation in `src/server/tls.ts` using Bun's built-in crypto.
- **CSS/Theming:** Custom CSS variables system — `src/client/base.css`, `themes/*/` directories with `.css` + `.toml` colour files.
- **Hashing:** `@noble/hashes ^2.2.0` — only runtime dependency.

# Entry points

| Role | File:line |
|---|---|
| Server bootstrap (HTTP + WebSocket + PTY) | `src/server/index.ts:95` (`parseConfig`) + line 50 (`runServerCleanup`) |
| `package.json` `"main"` / `"start"` target | `src/server/index.ts` (`bun src/server/index.ts`) |
| Client browser entrypoint | `src/client/index.ts:1` (module loaded by `src/client/index.html`) |
| Desktop main (Electrobun app) | `src/desktop/index.ts:34` (`async function main()`) |
| Build entrypoint | `bun-build.ts:1` (invoked by `bun run build`) |
| Desktop build config | `electrobun.config.ts:1` |
| E2E test config | `playwright.config.ts:1` |
| Bench runner | `scripts/bench-render-math.ts:1` |
| Release pre-flight verify | `scripts/verify-vendor-xterm.ts:1` |
| Coverage threshold check | `scripts/check-coverage.ts:1` |

# Project tier

```
Tier: T1
Rationale: Single author (1 unique git contributor). Zero coordination infrastructure
— no SECURITY.md, CONTRIBUTING, CODEOWNERS, CODE_OF_CONDUCT, issue templates, or PR
templates. Rich docs (CHANGELOG, CI, AGENTS.md) are hallmarks of a well-maintained
solo project, not team coordination signals.

Signals:
- Contributors (unique authors): 1
- Recent activity (commits last 90d): 825
- Approximate LOC (code-only, non-vendored): 42,858
- LICENSE: present (ISC, 2026-04-26)
- CI: multi-job (release.yml has 4 jobs: e2e, build matrix, release, bump-homebrew)
- Deploy artifacts: none (Homebrew tap formula updated via CI; no Dockerfile/compose/k8s/terraform)
- Release / changelog: CHANGELOG.md present + 41 git tags (v0.9.0–v1.10.4)
- Security/policy files: none (no SECURITY.md, CODE_OF_CONDUCT.md, CONTRIBUTING.md, CODEOWNERS)
```

# Applicability flags

- **backend:** present — `src/server/` (Bun HTTP+WebSocket server, PTY management, tmux control mode, TLS, auth)
- **frontend:** present — `src/client/` (xterm.js adapter, UI components, theme system, CSS)
- **database:** absent — only in-memory `sessions-store.ts`; no SQL/NoSQL dependency
- **tests:** present — 162 test files across `tests/unit/`, `tests/e2e/`, `tests/fuzz/`, `tests/post-compile/`
- **security-surface:** present — HTTP Basic Auth (`src/server/http.ts:305`), IP allowlist (`src/server/allowlist.ts`), TLS (`src/server/tls.ts`), OSC-52 clipboard consent (`src/server/osc52-reply.ts`), origin checking (`src/server/origin.ts`)
- **tooling:** present — `scripts/` (bench, coverage check, asset generation, bundle verify), `Makefile` with `typecheck`/`test`/`bench`/`fuzz` targets
- **docs:** present — `README.md`, `AGENTS.md`, `CHANGELOG.md`, `docs/` tree (code-analysis, superpowers plans/specs, bug logs)
- **container:** absent — no Dockerfile, no docker-compose; systemd service files (`tmux-web.service`, `tmux-web-dev.service`) present instead
- **ci:** present — `.github/workflows/release.yml` (multi-job), `fuzz-nightly.yml`, `bump-homebrew-tap.yml`
- **iac:** absent — no terraform/pulumi/helm/k8s/serverless/wrangler
- **monorepo:** absent — single package, no workspaces in `package.json`
- **web-facing-ui:** present, auth-gated — server binds `0.0.0.0:4022` by default (`src/shared/constants.ts:8`), but IP allowlist defaults to `127.0.0.1` and `::1` (`src/server/allowlist.ts`), and HTTP Basic Auth is enabled by default with mandatory password; classify as `bind-gated + auth-gated`
- **i18n-intent:** absent — no i18n libraries, locale files, or translation keys; locale handling is UTF-8 enforcement only (`src/server/index.ts:63`)
- **styling-surface:** present — `themes/` directory with 4 CSS files across `amiga/` and `default/` packs; `src/client/base.css`; CSS variable system for runtime theming; `<style>` injection via `applyTheme()` in `src/client/theme.ts`

# Load-bearing instruction-file drift (docs-drift flag)

Velocity: 825 commits in 90 days = high velocity. Thresholds: timestamp 7d (warn) / 14d (dirty).

**README.md** — last change `dd468c6` 2026-04-27. Age from today (2026-04-28): 1 day. Timestamp: fresh.
- Structural: all checked src/ paths exist (`src/client/adapters/types.ts`, `src/server/themes.ts`, `src/client/adapters/xterm.ts`, `src/client/ui/mouse.ts`, `src/client/session-settings.ts`, `src/server/protocol.ts`, `src/client/protocol.ts` — all confirmed present). 0/9 missing. Clean.
- Content: claims "HTTP Basic Auth — on by default", "TLS by default", "default: 0.0.0.0:4022", "default: tmux" — all match `src/shared/constants.ts` and `src/server/index.ts:99–103`. Clean.

**AGENTS.md** — last change `bd029bc` 2026-04-28. Age: 0 days. Timestamp: fresh.
- Structural: same src/ paths as README — all confirmed present. Clean.
- Content: claims same defaults (0.0.0.0:4022, Basic Auth enabled by default, TLS enabled by default) — all match code. Clean.

```
Docs drift:
- README.md — last change dd468c6 2026-04-27; status: fresh; all src/ paths exist, defaults match code
- AGENTS.md — last change bd029bc 2026-04-28; status: fresh; all src/ paths exist, defaults match code
```

# Pre-release verification surface

```
Pre-release surface:
- CI config: .github/workflows/release.yml (multi-job: e2e, build-matrix, release, bump-homebrew), .github/workflows/fuzz-nightly.yml, .github/workflows/bump-homebrew-tap.yml
- Local runner: `act` mentioned in Makefile line 84 ("Run locally before tagging a release, after `act` has [run]") and AGENTS.md line 27+; no vagrantfile, no Taskfile/justfile; Makefile has `typecheck`, `test`, `bench`, `fuzz`, `bench-check` targets
- Recommend pre-release checklist in report: yes
```

(Both CI config and local runner reference are present.)

# Senior-1M tier recommendations

```
Recommend senior-1m for: none
Reason:
- Single-analyst scope: ~42,858 non-vendored LOC — well below 300k threshold.
- Polyglot: TypeScript only (plus minor shell scripts and TOML config) — 1 language family, not ≥4.
- Total non-vendored LOC <1M — cross-cutting Security analyst criterion fails on volume alone.
- Synthesis pre-prediction: T1 × 1 analyst × log10(1769 files) ≈ 1 × 1 × 3.25 = 3.25; 3.25 × 500 = 1,625 chars — far below 350k threshold.
```

# Notable oddities

- **Vendored xterm.js submodule built from source** (`vendor/xterm.js`): the release pipeline explicitly forbids using the npm `@xterm/xterm` package. `bun-build.ts` patches tsconfig files inside the submodule at build time to inject `experimentalDecorators` (xterm.js's DI system requires the legacy decorator transform).
- **Generated `src/server/assets-embedded.ts`**: listed in `.gitignore`; produced by `scripts/generate-assets.ts` and required before `typecheck` (`Makefile:47`). Not tracked in git but depended on by the TypeScript build.
- **Pre-compiled binary in working tree** (`tmux-web`, 109 MB): an untracked compiled binary is present at the repo root alongside the source, alongside `index.js.map` (427 KB) — these are build outputs not in `.gitignore` (or excluded by it).
- **`tmp/` directory** (108 entries, not tracked): large ephemeral directory present at repo root; not in git.
- **Symlinks only in `node_modules/.bin/`**: no source-tree symlinks found outside node_modules.
- **`docs/code-analysis/`**: three full code-analysis report runs (2026-04-17, 2026-04-21, 2026-04-26) with 50+ analyst output files each, all committed to the repo — these are AI-generated analysis artifacts treated as living documentation.
- **`.claude/`, `.playwright-mcp/`, `.worktrees/`** directories: untracked AI tooling config present in working tree (`mempalace.yaml`, `entities.json` also at root).
- **`tmux-web-dev` script**: an executable shell script at root (tracked) acting as a dev-mode launcher wrapper.
- **Systemd service files committed**: `tmux-web.service` and `tmux-web-dev.service` are tracked in the repo root, intended for installation as a systemd user service.
