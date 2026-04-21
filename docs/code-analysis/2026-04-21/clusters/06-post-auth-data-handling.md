---
Status: resolved
Resolved-in: b2caebd
---

> **Resolution (2026-04-21) — maintainer decisions:**
> 1. TOCTOU between BLAKE3 pin and OSC 52 reply: accepted as a
>    documented T2 limitation — added an explicit "TOCTOU assumption"
>    subsection under Workaround 4 in CLAUDE.md, recording both the
>    threat model ("attacker must already be the tmux user") and the
>    rejected mitigations (rehash-before-send, pidfd routing).
> 2. Clipboard sub-object in `PUT /api/session-settings`: rejected
>    with 400 ("clipboard entries are not writable via PUT — use the
>    consent prompt"). New `hasClipboardField` helper walks the patch
>    body's `sessions.*` and refuses if any session patch carries a
>    `clipboard` key. Legitimate traffic never sends this field.
> 3. Absolute path in `GET /api/drops`: stripped from the API
>    response. `drops-panel.ts`'s tooltip no longer shows the absolute
>    path (which was the only consumer). Server still resolves paths
>    from `dropId` server-side at paste time.


# Cluster 06 — post-auth-data-handling

## TL;DR

- **Goal:** Close three post-auth data-handling footguns: TOCTOU between BLAKE3 pin and OSC 52 reply delivery, unvalidated `clipboard` field in `PUT /api/session-settings`, and absolute-path disclosure in `GET /api/drops`.
- **Impact:** Each is a Low-severity post-auth concern (authenticated clients already have significant authority), but each undermines a security invariant the code explicitly intends to maintain (binary pinning, consent-prompt sole source of grants, minimal info disclosure).
- **Size:** Small (<2h)
- **Depends on:** none
- **Severity:** Low

## Header

> Session size: Small · Analysts: Security · Depends on: none

## Files touched

- `src/server/clipboard-policy.ts` (TOCTOU)
- `src/server/hash.ts` (TOCTOU)
- `src/server/ws.ts` (TOCTOU reply path)
- `src/server/http.ts` (unvalidated clipboard PUT, drops GET path disclosure)
- `src/server/sessions-store.ts` (unvalidated clipboard PUT)
- `src/server/file-drop.ts` (drops GET path disclosure)

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 0 · Low: 3
- autofix-ready: 0 · needs-decision: 3 · needs-spec: 0

## Findings

- **TOCTOU between BLAKE3 binary pin and OSC 52 reply delivery** — `resolvePolicy` hashes `/proc/<pid>/exe` at decision time; the reply travels back to the same pid via `tmux send-keys -H`. Between the two, the process could `exec` a different binary (same pid) and receive a clipboard reply that the consent prompt granted to the previously-hashed binary. On Linux, `/proc/<pid>/exe` updates on exec but the skill's read is one-shot in `clipboard-policy.ts`. An attacker needs code execution as the same tmux user to trigger this, so practical risk is low; the concern is that the BLAKE3 pin is precisely intended to defend against "binary swap", so the gap undermines its own invariant.
  - Location: `src/server/clipboard-policy.ts:32-40`, `src/server/hash.ts:11-18`, `src/server/ws.ts:311-349`
  - Severity: Low · Confidence: Plausible · Effort: Medium · Autonomy: needs-decision
  - Cluster hint: `clipboard-consent`
  - Raised by: Security Analyst
  - Notes: Mitigation options: (a) re-verify `/proc/<pid>/exe` readlink + hash immediately before `deliverOsc52Reply`, (b) capture the pidfd at policy-check time and use the pidfd for the `send-keys` delivery, (c) accept as a documented limitation and note the assumption in CLAUDE.md (which is fine at T2 given the attacker must already be the tmux user). Any of the three is defensible; the first is the simplest.

- **`PUT /api/session-settings` accepts unvalidated `clipboard` sub-object** — `applyPatch` stores `sessions[<name>].clipboard = { [exePath]: { blake3, read, write } }` as-is from the request body. An authenticated client can pre-seed allow-grants for arbitrary `exePath` strings with a matching BLAKE3, bypassing the consent prompt for any binary they control at that path. Effective authority is identical to the authenticated user (who already has write-access to `sessions.json` on disk), so severity is low; the concern is that the server treats the on-disk policy file as authoritative without validating that grants arrived via the consent-prompt pipeline.
  - Location: `src/server/http.ts:482-530`, `src/server/sessions-store.ts:100-124`
  - Severity: Low · Confidence: Verified · Effort: Medium · Autonomy: needs-decision
  - Cluster hint: `clipboard-consent`
  - Raised by: Security Analyst
  - Notes: Straightforward fix: reject `clipboard` entries in the PUT body and document that clipboard grants are only writable through `recordGrant` driven by the consent prompt. The UI does not need to write clipboard grants via PUT today (inspection confirms `saveSessionSettings` does not include clipboard in its partial body), so the rejection should be a no-op for legitimate traffic.

- **`GET /api/drops` response discloses absolute filesystem paths** — `listDrops` at `src/server/file-drop.ts:264-301` returns each drop's `absolutePath` (e.g., `/run/user/1000/tmux-web/drop/<id>/<filename>`), which leaks the runtime uid and the `$XDG_RUNTIME_DIR` layout. Returned to `/api/drops` GET at `http.ts:374`. The documented client pipeline uses `dropId` for the re-paste flow (`POST /api/drops/paste`), so `absolutePath` in the GET response is redundant.
  - Location: `src/server/http.ts:374`, `src/server/file-drop.ts:264-301`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `file-drop-path-safety`
  - Raised by: Security Analyst
  - Notes: Fix: strip `absolutePath` from the response and have the server re-resolve at paste time from `dropId`. Before merging, verify no client code actually reads `absolutePath` from the response (drops-panel.ts is the likely consumer).

## Suggested session approach

Three independent needs-decision calls; best handled as a single focused brainstorm so the decisions are made with shared context rather than ad-hoc. Decisions required: (1) which of three TOCTOU mitigations to adopt (read: are the extra syscalls worth it for the threat model, or is a CLAUDE.md note enough); (2) confirm nothing legitimate writes `clipboard` through PUT before rejecting it; (3) confirm no client reads `absolutePath` from the drops GET response before stripping it. Once decided, the implementation is short.

## Commit-message guidance

1. Name the cluster slug and date — e.g., `harden(cluster 06-post-auth-data-handling, 2026-04-21): reject unvalidated clipboard PUT, strip absolute path from drops GET`.
2. If TOCTOU mitigation is deferred to a CLAUDE.md note, mark that finding as `deferred` (not closed) and point `Resolved-in:` at the CLAUDE.md commit.
3. No `Depends-on:` chain.
