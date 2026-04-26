---
Status: open
Autonomy: autofix-ready
Resolved-in:
Depends-on:
informally-unblocks:
Pre-conditions:
attribution:
Commit-guidance: expect an `Incidental fixes` section if the dedup uncovers stale behaviour in `parseWindows` (http.ts:418) — that function shares the inline-parser shape and may need a `.trim()` adjustment to match the new shared helper
model-hint: standard
---

# Cluster 01 — tmux-control-and-listings

## TL;DR

- **Goal:** Extract a single `tmux-listings.ts` helper that the six current inline `list-sessions` / `list-windows` / `display-message` parsers across `http.ts` and `ws.ts` collapse into; fix two `ControlClient` correctness issues uncovered while reading those call sites.
- **Impact:** Removes a documented drift hazard (the 2026-04 `:` → `\t` separator change in v1.7.0 had to be applied to multiple sites; a missed call site silently regresses), fixes a multi-byte UTF-8 codepoint corruption when tmux control output crosses a Bun stdout chunk boundary.
- **Size:** Medium (half-day).
- **Depends on:** none
- **Severity:** Medium (highest in cluster)
- **Autonomy (cluster level):** autofix-ready

## Header

> Session size: Medium · Analysts: Backend · Depends on: none · Autonomy: autofix-ready

## Files touched

- `src/server/ws.ts` (4 findings)
- `src/server/http.ts` (3 findings, partial overlap)
- `src/server/tmux-control.ts` (1 finding)
- `src/server/tmux-listings.ts` (new file — proposed)

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 1 · Low: 5
- autofix-ready: 5 · needs-decision: 1 · needs-spec: 0

## Findings

- **Massive duplication: list-sessions / list-windows / display-message helpers exist 6 times across `http.ts` + `ws.ts`** — The same `'#{session_id}:#{session_name}'` argv + `split('\n')` + `split(':')` + `replace(/^\$/, '')` + `rest.join(':')` logic appears at `http.ts:391/397/406`, `ws.ts:1072/1083`, `ws.ts:1123/1126`. Same pattern for `list-windows` argv + tab-parsing in `http.ts:417/419`, `ws.ts:1091/1102`, `ws.ts:1137/1140`. Same pattern for `display-message -p #{pane_title}` in `ws.ts:1110`, `ws.ts:1151`. Each pair (`*State` / `*StateDirect`) differs only in whether `tmuxControl.run` is tried first with a fallback to `execFileAsync`. Drift risk is high — when the parsing rule changes (as it did in v1.7.0 for tab-separation) every site has to be edited; a missed one regresses silently.
  - Location: `src/server/ws.ts:1071-1157`
  - Location: `src/server/http.ts:387-435`
  - Severity: Medium · Confidence: Verified · Effort: Medium · Autonomy: autofix-ready
  - Cluster hint: `tmux-listing-dedup`
  - Fix: extract a `tmux-listings.ts` module exporting `listSessions(opts, { preferControl })`, `listWindows(opts, session, { preferControl })`, `getPaneTitle(opts, session, { preferControl })` with a single `useControl` boolean. `sendWindowState` passes `true`, `sendStartupWindowState` passes `false`. All 6 inline implementations + the inline `parseWindows` in `http.ts:418` collapse to 3 calls.
  - Raised by: Backend

- **`broadcastWindowsForSession` re-implements list-windows tab-parsing inline rather than reusing the helper just below it** — `ws.ts:1230-1246` re-codes the `'#{window_index}\t#{window_name}\t#{window_active}'` argv and the same `split('\n').filter(Boolean).map(line => line.split('\t'))` parser that `listWindowState` (line 1090) already implements. Because this version does not call `.trim()` on stdout before `split('\n')`, a trailing newline produces a stray empty entry that survives `filter(Boolean)` only because every parsed entry has a truthy `index`/`name`. Behaves identically today but inconsistent.
  - Location: `src/server/ws.ts:1223-1248`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `tmux-listing-dedup`
  - Depends-on: cluster 01-tmux-control-and-listings (the same cluster, internal sequencing — apply after the helper is extracted)
  - Fix: replace the inline body with `const windows = await listWindowState(sessionName, opts);` and the existing `if (!windows || windows.length === 0) return;` guard.
  - Raised by: Backend

- **Session id stripping uses fragile string parsing on output that already has a structured field** — `http.ts:391`, `ws.ts:1072`, `ws.ts:1123` all use `'#{session_id}:#{session_name}'` as the format string, then split on `:` and rejoin the rest as the name. tmux session names can contain `:` if created by an external tmux client that bypassed `isSafeTmuxName` (the WS path rejects `:` — but tmux's CLI does not). Choosing `'#{session_id}\t#{session_name}'` as the format and splitting on `\t` matches the pattern already used for windows (which moved from `:` to `\t` exactly because of this in v1.7.0).
  - Location: `src/server/http.ts:391`
  - Location: `src/server/ws.ts:1072`
  - Location: `src/server/ws.ts:1123`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `tmux-listing-dedup`
  - Depends-on: cluster 01-tmux-control-and-listings (apply during helper extraction)
  - Fix: change the format literal to `'#{session_id}\t#{session_name}'` and replace `line.split(':') / rest.join(':')` with `line.split('\t')`. Same shape as the v1.7.0 windows fix already in place.
  - Raised by: Backend

- **`ControlClient` decodes tmux stdout chunks as UTF-8 per-chunk, can split multi-byte sequences** — Bun's `proc.stdout` reads emit `Uint8Array` chunks at arbitrary byte boundaries; `tmux-control.ts:288` calls `chunk.toString('utf8')` on each chunk independently. A multi-byte UTF-8 codepoint that straddles a chunk boundary turns into U+FFFD (replacement char). This affects window names and pane titles emitted by `%window-renamed`, `%subscription-changed` value strings, and `display-message` outputs that contain non-ASCII glyphs. The PTY path (`pty.ts:73`) correctly uses `new TextDecoder('utf-8')` with `{stream: true}`; the control path does not.
  - Location: `src/server/tmux-control.ts:287-290`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `tmux-control-quality`
  - Fix: replace `chunk.toString('utf8')` with a per-`ControlClient` `TextDecoder('utf-8')` and call `decoder.decode(chunk, { stream: true })`; flush on `proc.exited`.
  - Raised by: Backend

- **`broadcastSessionRefresh` and `broadcastWindowsForSession` send a `{session: name}` push to every client whose registered session name matches the OSC-event session — but the same WS connection appears in every refresh path keyed by its `state.registeredSession`** — Functionally fine. However the registry is `Map<sessionName, Set<ws>>`. When `handleTitleChange` → `moveWsToSession` migrates a WS from `oldSession` to `newSession`, the WS is removed from `oldSession`'s set and added to `newSession`'s set. Notification fan-out is iterated under the assumption that registry contents are stable per-iteration; `for (const ws of clients)` runs the body synchronously and the body itself doesn't mutate the set, so the assumption holds. The bigger drift risk: if a future refactor makes the body async and awaits anything that could trigger `handleClose` / `moveWsToSession`, the iterator's view becomes stale. No bug today; document the invariant.
  - Location: `src/server/ws.ts:1213-1248`
  - Severity: Low · Confidence: Speculative · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `tmux-control-quality`
  - Notes: T2 — comment-only fix is fine ("body must remain synchronous for iteration safety; convert to `Array.from(clients)` snapshot if any await is added").
  - Raised by: Backend

## Suggested session approach

Mechanical extraction. Subagent-driven, not brainstorm — open the cluster, dispatch a subagent that produces the new `src/server/tmux-listings.ts` module first (three exports: `listSessions`, `listWindows`, `getPaneTitle`, each accepting `{ preferControl: boolean }`), then sweeps `http.ts` and `ws.ts` replacing inline implementations with calls. Apply the format change (`:` → `\t` for session ID) inside the helper so the v1.7.0 separator decision is centralized. Apply the `TextDecoder` fix to `ControlClient` separately at the bottom of the same commit (or a sibling commit), since it touches `tmux-control.ts` not the listings helper. The iteration-safety comment in `ws.ts:1213` is a one-line annotation.

**Concrete implementation sketch for the helper:**

```ts
// src/server/tmux-listings.ts
export async function listSessions(opts, { preferControl }) {
  const argv = ['list-sessions', '-F', '#{session_id}\t#{session_name}'];
  const out = preferControl
    ? await tmuxControl.run(argv).catch(() => execFileAsync(opts.tmuxBin, argv))
    : await execFileAsync(opts.tmuxBin, argv);
  return out.trim().split('\n').filter(Boolean).map(line => {
    const [rawId, ...rest] = line.split('\t');
    return { id: rawId.replace(/^\$/, ''), name: rest.join('\t') };
  });
}
// listWindows and getPaneTitle follow the same shape; preferControl=true for
// the WS-attached path, false for the startup/probe path.
```

Verify with `make typecheck && make test-unit && make test-e2e`. The session-id `:` → `\t` change is observable via the existing `tests/unit/server/_harness/spawn-server.ts` flow; e2e `menu-session-switch-content.spec.ts` exercises the multi-session path that triggers the parsing.
