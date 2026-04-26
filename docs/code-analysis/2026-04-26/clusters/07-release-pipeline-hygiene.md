---
Status: open
Autonomy: autofix-ready
Resolved-in:
Depends-on:
informally-unblocks:
Pre-conditions:
attribution:
Commit-guidance:
model-hint: junior
---

# Cluster 07 — release-pipeline-hygiene

## TL;DR

- **Goal:** Five small mechanical edits to dev wrappers, systemd unit files, and packaging artifacts left stale by recent rename / removal cycles, plus a one-patch dependency bump.
- **Impact:** Removes "wrong file referenced" sources of confusion; the `tmux-web-dev` and `tmux-web-dev.service` references work today only because the broken comparison is masked by an unconditional rebuild — a future bug here will be hard to diagnose because the file does the right thing for the wrong reason.
- **Size:** Small (<2h).
- **Depends on:** none
- **Severity:** Low
- **Autonomy (cluster level):** autofix-ready

## Header

> Session size: Small · Analysts: Tooling · Depends on: none · Autonomy: autofix-ready

## Files touched

- `tmux-web-dev` (1 finding)
- `tmux-web-dev.service` (1 finding)
- `tmux-web.service` (1 finding)
- `packaging/homebrew/tmux-web.rb` (1 finding)
- `package.json` (1 finding)

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 0 · Low: 5
- autofix-ready: 4 · needs-decision: 1 · needs-spec: 0

## Findings

- **Stale `dist/client/ghostty.js` marker in `tmux-web-dev` dev wrapper** — The dev-loop script gates client rebuilds on a path that no longer exists. The renderer was consolidated to xterm-only long ago (`AGENTS.md:59-65`), and the produced bundle is `dist/client/xterm.js`. Because `[ ! -f "$MARKER" ]` is always true on a clean tree, every invocation re-runs `bun run bun-build.ts` unconditionally and the freshness check downstream is effectively dead — but `find ... -newer "$MARKER"` invoked against a missing `MARKER` returns no entries, so the only branch that runs is the `! -f` rebuild. The script "works" only because the unconditional-rebuild path masks the broken comparison.
  - Location: `tmux-web-dev:6`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `dev-loop-staleness`
  - Fix: Replace `MARKER="dist/client/ghostty.js"` with `MARKER="dist/client/xterm.js"` so the freshness comparison and the existence check both reference the actual produced bundle.
  - Raised by: Tooling

- **`tmux-web-dev.service` passes a non-existent `--terminal xterm` flag** — Systemd unit `ExecStart=` lists `--terminal xterm`, but no such option exists in the CLI surface (`README.md:91-108`, `AGENTS.md:117-137`). The argv parser in `src/server/index.ts` will either reject the flag at startup or silently swallow it depending on the parser's strictness — either way the service operator's intent ("force xterm renderer") is no-op and confusing. The renderer is unconditionally xterm.js + WebGL today, so the flag has no analogue to migrate to.
  - Location: `tmux-web-dev.service:8`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `dev-loop-staleness`
  - Fix: Remove ` --terminal xterm` from the `ExecStart=` line.
  - Raised by: Tooling

- **`packaging/homebrew/tmux-web.rb` is stale and committed with placeholder SHAs** — The committed formula pins `version "1.4.1"` and four `sha256 "PASTE_..._HERE"` literal placeholders. The current release cadence is past `v1.9.0`. The release pipeline does NOT consume this file — `.github/workflows/bump-homebrew-tap.yml` rewrites the formula in the separate `Tuxie/homebrew-tap` repo, not this in-repo copy. Either this file should be deleted (it serves no functional purpose) or reframed as a starter-template with a header comment that says so; right now a new contributor will reasonably assume it's authoritative and the placeholders are a known-broken release artifact.
  - Location: `packaging/homebrew/tmux-web.rb:1`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `release-pipeline-hygiene`
  - Notes: Decision: delete vs. keep as documented bootstrap template.
  - Raised by: Tooling

- **`tmux-web.service` ships without `Environment=TMUX_WEB_PASSWORD=...` placeholder** — The unit file calls `tmux-web --listen=127.0.0.1:4022` with no auth flag. The server requires either a password or `--no-auth`. Out of the box this unit will fail to start because no password is provided. README.md:121 acknowledges the edit step ("Edit the unit to set TMUX_WEB_USERNAME and TMUX_WEB_PASSWORD before enabling"), but the unit file itself ships with no `Environment=TMUX_WEB_PASSWORD=` line at all — even commented-out — so a user who follows the README literally has nothing obvious to uncomment. Add a commented-out template line.
  - Location: `tmux-web.service:11`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `release-pipeline-hygiene`
  - Fix: Add commented placeholder before the existing `Environment=PATH=...` line:
    ```
    # Environment=TMUX_WEB_USERNAME=youruser
    # Environment=TMUX_WEB_PASSWORD=changeme
    ```
  - Raised by: Tooling

- **`@types/bun` lags by one patch (1.3.12 → 1.3.13)** — `bun outdated` reports `@types/bun 1.3.12 → 1.3.13` while every other dependency is current. Pinned bun runtime is `1.3.13` in `.bun-version` and both `release.yml` setup-bun steps. The mismatch between the runtime types and the runtime is small but trivially fixable.
  - Location: `package.json:27`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `dep-freshness`
  - Fix: Bump `"@types/bun": "^1.3.12"` to `"^1.3.13"` in `package.json`, then `bun install` to refresh `bun.lock`. (current pinned 1.3.12, latest 1.3.13 — one patch behind; source: `bun outdated` 2026-04-26.)
  - Notes: All other deps current per `bun outdated` and direct `registry.npmjs.org/<pkg>/latest` fetches: typescript 6.0.3, electrobun 1.16.0, @playwright/test 1.59.1, jsdom 29.0.2, fast-check 4.7.0, @types/node 25.6.0, @noble/hashes 2.2.0, pngjs 7.0.0.
  - Raised by: Tooling

## Suggested session approach

Subagent-driven mechanical sweep. The five edits are independent and small. The homebrew-formula needs-decision (delete vs. keep-as-template) is a 1-line maintainer call before subagent runs. Verify with `make typecheck && make test-unit`; the systemd unit changes are not exercised by tests but are observable by `systemctl daemon-reload && systemctl --user start tmux-web.service` post-install if the maintainer wants belt-and-braces.
