---
Status: open
Autonomy: needs-decision
Resolved-in:
Depends-on:
informally-unblocks:
Pre-conditions:
attribution:
Commit-guidance:
model-hint: standard
---

# Cluster 09 — backend-correctness-micro

## TL;DR

- **Goal:** Bundle of small backend cleanups: per-pool naming fix, timing-safe consistency on the desktop bearer, sync stat-walk on every drop, tmux.conf path quoting, jsdom dev-dep bump, and `as any` Bun-API gaps acknowledged.
- **Impact:** Eliminates per-upload event-loop blocking, removes a confusing per-session-but-actually-per-pool name, makes the desktop bearer comparison consistent with the Basic Auth path, prevents `tmux.conf` parse failure on paths with spaces, and bumps one dev dep.
- **Size:** Small (<2h).
- **Depends on:** none.
- **Severity:** Low.
- **Autonomy (cluster level):** needs-decision — the `as any` casts on Bun API gaps are blocked-upstream and a decision is needed about whether to file an upstream issue or annotate locally.

## Header

> Session size: Small · Analysts: Backend, Tooling, Frontend (jsdom triple-flag) · Depends on: none · Autonomy: needs-decision

## Files touched

- `src/server/file-drop.ts` (3 sites: stat-walk + rename + writeSync cast)
- `src/server/http.ts` (timing-safe + as-any cast)
- `src/server/ws.ts` (timing-safe consistency site)
- `src/server/index.ts` (tmux.conf path quoting + as-any cast)
- `src/server/pty.ts` (1 cast)
- `src/server/tmux-control.ts` (cast)
- `package.json` (jsdom bump)

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 0 · Low: 6
- autofix-ready: 4 · needs-decision: 2 · needs-spec: 0

## Findings

- **`currentRootBytes()` does sync `readdirSync` + `statSync` walk on every upload** — Blocks the event loop. At default ring-buffer size (20 drops) the impact is bounded, but the fix is trivial: maintain an in-memory byte counter updated on write/delete.
  - Location: `src/server/file-drop.ts:318`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `efficiency`
  - Raised by: Backend Analyst
  - Notes: Decision: in-memory counter (most efficient, requires write/delete instrumentation) vs accept the bounded sync cost (simpler). For a 20-file ring buffer the sync cost is small; for headroom on larger pools the counter wins.

- **`DropStorage.maxFilesPerSession` is a global per-user pool cap, not per-session** — `sweepRoot` applies it against the root directory regardless of session. Misleading name leads future contributors to think the cap is session-scoped.
  - Location: `src/server/file-drop.ts:11`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `naming`
  - Fix: Rename to `maxFilesPerPool` or `maxDropsTotal`; update all callsites and the type comment.
  - Raised by: Backend Analyst

- **Desktop bearer token compared with `===`; Basic Auth uses `timingSafeEqual`** — Inconsistent. The desktop-only loopback bearer is near-unexploitable in practice, but consistency matters.
  - Location: `src/server/http.ts:449`
  - Location: `src/server/ws.ts:206`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `auth-consistency`
  - Fix: Replace both `===` comparisons with `safeStringEqual(...)` for consistency with the Basic Auth path.
  - Raised by: Backend Analyst

- **`tmuxConf` path is unquoted in materialised tmux.conf** — `src/server/index.ts:459` writes `\nsource-file -q ${config.tmuxConf}\n` via template literal without quoting. A path containing spaces silently breaks tmux's config parser. Operator-controlled input; no security implication.
  - Location: `src/server/index.ts:459`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `quote-paths`
  - Fix: Wrap the path in single quotes (or use the project's existing `shellQuote` helper): `\nsource-file -q '${config.tmuxConf.replace(/'/g, "'\\''")}'\n`.
  - Raised by: Backend Analyst

- **`as any` casts for Bun API gaps** — Five sites: `src/server/pty.ts:97` (`SpawnOptions.env`), `src/server/file-drop.ts:432` (`fs.writeSync`), `src/server/index.ts:350` (fetch options), `src/server/tmux-control.ts` (array ops). Not fixable without upstream Bun type improvements.
  - Location: `src/server/pty.ts:97`
  - Location: `src/server/file-drop.ts:432`
  - Location: `src/server/index.ts:350`
  - Severity: Low · Confidence: Verified · Effort: Unknown · Autonomy: needs-decision
  - Cluster hint: `type-safety`
  - Raised by: Backend Analyst
  - Notes: Decision: file upstream Bun issues per cast and reference the issue in a comment; or wrap each in a tiny typed helper that documents the gap; or accept and stop flagging on future runs. Recommend the helper approach — keeps `any` contained to one place per gap and makes the API-gap visible without depending on upstream resolution.

- **`jsdom` outdated by one patch (29.0.2 → 29.1.0)** — devDependency only. Source: `bun outdated` (2026-04-28).
  - Location: `package.json:32`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `dep-freshness`
  - Fix: `bun add -d jsdom@^29.1.0` (or hand-edit `package.json` to `^29.1.0` and run `bun install --frozen-lockfile=false`).
  - Raised by: Backend Analyst, Frontend Analyst, Tooling Analyst (triple-flagged)
  - Notes: Source citation: `bun outdated`, 2026-04-28. All other dependencies current at run time.

## Suggested session approach

Five of six findings are mechanical and ship in one PR: rename `maxFilesPerSession`, swap `===` → `safeStringEqual` in two places, quote `tmuxConf` path, bump jsdom. The two needing decisions (`currentRootBytes` counter vs accept; `as any` Bun gaps) deserve a 5-minute brainstorm — recommend the in-memory counter (small extra plumbing, eliminates event-loop block) and the helper-wrap pattern for `as any` (documents the gap, contains the lie). Single commit.
