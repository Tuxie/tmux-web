---
Status: closed
Autonomy: autofix-ready
Resolved-in: 2c8bf2d10abc2c0d2162f34a9e80757c0d2c8565
Depends-on:
informally-unblocks:
Pre-conditions:
attribution:
Commit-guidance:
model-hint: junior
---

# Cluster 17 — naming-consistency

## TL;DR

- **Goal:** Three small consistency cleanups: pick one spelling for sanitize/sanitise, fix the lone `.ts` extension import among 30+ `.js`-extension imports, replace the only `as any` cast in the client surface with the now-supported native call.
- **Impact:** Removes "this looks weird" inconsistencies that accumulate in a 737-commits-in-90-days solo repo. None are bugs.
- **Size:** Small (<2h).
- **Depends on:** none
- **Severity:** Low
- **Autonomy (cluster level):** autofix-ready

## Header

> Session size: Small · Analysts: Backend, Frontend · Depends on: none · Autonomy: autofix-ready

## Files touched

- `src/server/pty.ts`, `src/server/file-drop.ts`, `src/server/sessions-store.ts` (1 finding, ~10 call sites)
- `src/client/index.ts` (1 finding)
- `src/client/ui/dropdown.ts` (1 finding)

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 0 · Low: 3
- autofix-ready: 2 · needs-decision: 1

## Findings

- **Naming inconsistency: `sanitizeSession` (American) vs `sanitiseFilename` / `sanitiseSessions` (British)** — `pty.ts:15` exports `sanitizeSession`, while `file-drop.ts:202` exports `sanitiseFilename` and `sessions-store.ts:75` defines `sanitiseSessions`. Same project, same PR-author timeline (per `git log`), three different spellings of the same lemma. AGENTS.md does not pick a spelling so neither is "wrong"; the inconsistency is the smell.
  - Location: `src/server/pty.ts:15`
  - Location: `src/server/file-drop.ts:202`
  - Location: `src/server/sessions-store.ts:75`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `naming-consistency`
  - Notes: Choose one spelling project-wide. American (`sanitize*`) is the JS-ecosystem default; rename `sanitiseFilename` and `sanitiseSessions` and update references. ~10 call-sites across server + tests.
  - Raised by: Backend

- **Inconsistent module-extension convention: one `.ts` import among 30+ `.js`** — All other client/desktop/shared imports use the TypeScript-with-`.js`-extension convention (which Bun, Node ESM, and `tsc --moduleResolution=bundler` accept). `src/client/index.ts:41` is the lone outlier importing `./adapters/xterm.ts`. Bun resolves it fine, but it inverts the rest of the codebase and any future migration to `tsc emit` or stricter ESM tooling would surface this as the single odd file.
  - Location: `src/client/index.ts:41`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `naming-consistency`
  - Fix: `import { XtermAdapter } from './adapters/xterm.js';`
  - Raised by: Frontend

- **`setActive` casts `item.scrollIntoView` through `as any`** — `src/client/ui/dropdown.ts:551`: the cast bypasses the JSDOM stub guard. The runtime check (`typeof scrollIntoView === 'function'`) is correct, but the `(item as any).scrollIntoView` cast is the only `as any` in the entire client surface. JSDOM 29 supports `Element.scrollIntoView` natively now (it was a stub-no-op in earlier versions); the cast is a relic from when JSDOM did not, per `docs/bugs/fixed/2026-04-23-e2e-*-happy-dom.md`.
  - Location: `src/client/ui/dropdown.ts:551`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `naming-consistency`
  - Fix: Replace the `as any` and the typeof guard with `item.scrollIntoView({ block: 'nearest' });` — modern lib.dom always declares it.
  - Raised by: Frontend

## Suggested session approach

Subagent-driven mechanical sweep. Pick the sanitize/sanitise spelling first (one-line maintainer call — recommend American per JS-ecosystem default), then dispatch a subagent with three independent edits. Verify with `make typecheck && make test-unit && make test-e2e`.

**Concrete implementation sketch for the spelling rename:**
1. `rg -l 'sanitis(e|ed|ing|er)' src/ tests/` to enumerate sites.
2. Rename `sanitiseFilename` → `sanitizeFilename` in `src/server/file-drop.ts:202`, propagate to all imports.
3. Rename `sanitiseSessions` → `sanitizeSessions` in `src/server/sessions-store.ts:75`, propagate.
4. Update test fixture/spec references.
5. Update `tests/fuzz/sanitise-filename.test.ts` filename to `sanitize-filename.test.ts` and the documented fuzz-file list in AGENTS.md (line ~50).

The fuzz file rename is the one cross-cluster risk — coordinate with anything else touching AGENTS.md fuzz-list (cluster 06's fuzz-gate decision; cluster 08's docs-drift sweep).
