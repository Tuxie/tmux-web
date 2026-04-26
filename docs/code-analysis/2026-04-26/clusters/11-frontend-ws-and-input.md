---
Status: closed
Autonomy: needs-decision
Resolved-in: 0f4d850b418d1e58d1238ccf2393c505b069ec6c
Depends-on:
informally-unblocks:
Pre-conditions:
attribution:
Commit-guidance:
model-hint: standard
---

# Cluster 11 — frontend-ws-and-input

## TL;DR

- **Goal:** Five frontend findings covering WS error reporting, send-while-not-OPEN UX, client input parser bounds, protocol framing fallback semantics, and per-input PUT request fan-out.
- **Impact:** Reduces silent failures in disconnected/poor-network states; tightens client-side input handling; debounces a per-slider PUT storm.
- **Size:** Medium (half-day).
- **Depends on:** none
- **Severity:** Medium (highest in cluster)
- **Autonomy (cluster level):** needs-decision

## Header

> Session size: Medium · Analysts: Frontend · Depends on: none · Autonomy: needs-decision

## Files touched

- `src/client/connection.ts` (1 finding)
- `src/client/index.ts` (1 finding)
- `src/client/protocol.ts` (2 findings)
- `src/client/session-settings.ts` (1 finding)
- `src/client/ui/topbar.ts` (call sites — 2 findings)

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 2 · Low: 3
- autofix-ready: 0 · needs-decision: 4 · needs-spec: 1

## Findings

- **`Connection.send()` silently drops messages when WS is not OPEN** — `send(data)` checks `readyState === OPEN` and returns. Several producers (UI-driven WS messages) call `send` synchronously after a UI event without checking `isOpen`. The `index.ts` paste handler at line 427 has an explicit "Not connected — paste ignored" toast, but the `Topbar` session/window/scrollbar messages and `installFileDropHandler`'s upload-then-paste path do not — a session switch or rename clicked while disconnected silently disappears. The user only learns by retrying. The `connection.isOpen` getter exists but has only one caller.
  - Location: `src/client/connection.ts:42-44`
  - Location: `src/client/ui/topbar.ts:879` (sendWindowMsg) — fires through `send` regardless of state
  - Location: `src/client/ui/topbar.ts:260` (rename), `:291` (kill), `:217` (switch-session)
  - Severity: Medium · Confidence: Verified · Effort: Medium · Autonomy: needs-decision
  - Cluster hint: `ws-diagnostics`
  - Notes: T2 fix shape options: (a) buffer-and-flush on reconnect for action messages (semantics-tricky for stale renames); (b) mirror the paste-handler toast in every UI commit path that rides the WS. Either is reasonable — needs an explicit decision.
  - Raised by: Frontend

- **`saveSessionSettings` makes a fire-and-forget PUT on every slider input event** — `src/client/session-settings.ts:179` writes to the server-side store on every commit; in `topbar.ts:610-619` every slider input/change fires `commit({...})` which calls `saveSessionSettings` which calls `persist` which calls `void fetch(... PUT ...)`. A user dragging a slider (e.g. Hue 0→360) fires up to 360 PUT requests with no debounce. The server merges them atomically (per CHANGELOG `.part`→rename) but each request still allocates a body, traverses the WS auth/origin checks, and commits to disk. The handler has `.catch(() => {})` so the user never notices errors. PERF and observability concern at T2.
  - Location: `src/client/session-settings.ts:143-149`, `src/client/session-settings.ts:179-182`
  - Location: `src/client/ui/topbar.ts:541-546` (commit helper called from slider input)
  - Severity: Medium · Confidence: Verified · Effort: Medium · Autonomy: needs-decision
  - Cluster hint: `settings-persist-debounce`
  - Notes: Fix shape: 250–500 ms debounce on `persist`, with `flush` on `beforeunload`. Decision needed because there's a tradeoff with correctness (lose last-millisecond drag if tab closes before flush). Latest-wins server merge means the transient extra writes are otherwise harmless.
  - Raised by: Frontend

- **`ws.onerror` event ignores the `Event` type — generic Event passed to caller** — `Connection.connect()` declares `onError?: (ev: Event) => void`; this matches the WebSocket interface, but the actual `ev` from a WebSocket error is intentionally information-poor (browsers redact details from the Event for security). The current call site at `index.ts:359` does `console.warn('WebSocket error', ev)` which logs `Event {}`. Useful as a tripwire but the comment "browser CORS / protocol errors" in CHANGELOG over-promises. The toast text itself ("WebSocket connection error — check network / server") doesn't tell the user anything actionable, and the URL (`ws://…/ws?...`) isn't logged either, so debugging requires devtools' network panel anyway.
  - Location: `src/client/index.ts:359-365`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `ws-diagnostics`
  - Notes: T2-appropriate fix would be `console.warn('WebSocket error connecting to', adapter.cols ? buildWsUrl(...) : '(unknown)', ev);` but that re-resolves URL per call. Minor.
  - Raised by: Frontend

- **`extractTTMessages` parser does not bound JSON depth or size** — `src/client/protocol.ts:14-51` walks character-by-character through PTY data looking for the `\x00TT:` sentinel and a balanced `{}` block. There is no `depth > MAX` guard, no `length - jsonStart > MAX` guard, and no per-message budget. Server-side framing already caps clipboard payloads at 1 MiB and OSC 52 frames at 8 per chunk (per CHANGELOG 1.7.0), so current production producers are bounded — but the client trusts that. A misbehaving server (or a future producer that forgets the cap) could send a 50 MB nested JSON and the client would walk it, allocate the slice, and call `JSON.parse`. The browser will recover, but for a thin tier it's worth a note. Mitigation in place: server-side frame cap is the real defence.
  - Location: `src/client/protocol.ts:23-50`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `client-input-defense`
  - Notes: T2 single-tenant authenticated, server is trusted by definition. Filing as Low for that reason. Fix shape: cap `depth <= 64` and abort with a console.warn rather than continuing the parse.
  - Raised by: Frontend

- **`extractTTMessages` re-emits the prefix bytes when JSON is malformed, then keeps walking — risk of confusing terminal renderer** — At `src/client/protocol.ts:47-50`, when the brace-balance parse never reaches `depth === 0` or no `}` close is found, the code writes the raw `\x00TT:` prefix (4 bytes) into `terminalData` and advances `pos` to `jsonStart` (skipping past `\x00TT:`). The terminal then receives those 4 control bytes including the NUL, which xterm will render as a null-glyph and the colon. The intent appears to be "preserve the bytes if framing fails" — but `\x00` in xterm output is not display-only and may confuse downstream terminal apps. Practically only triggered by truncated frames at WS chunk boundaries (which would normally complete on the next chunk if buffered).
  - Location: `src/client/protocol.ts:47-50`
  - Severity: Low · Confidence: Plausible · Effort: Small · Autonomy: needs-spec
  - Cluster hint: `protocol-framing`
  - Notes: WebSocket text frames are guaranteed boundaries by the spec, so a partial JSON inside one frame is a producer bug, not a chunk-boundary issue. The fallback emit may exist solely to surface producer bugs visually; if so, document the intent. needs-spec because behaviour is intentional-but-undocumented.
  - Raised by: Frontend

## Suggested session approach

Brainstorming session — three of the five findings genuinely need a maintainer call. The send-while-not-OPEN finding is the largest impact and has two distinct shapes (buffer-and-flush vs. toast); pick one. The settings-persist-debounce is a one-knob choice (debounce window, e.g. 300 ms). The ws.onerror toast is a one-line cleanup. The two protocol.ts findings are smaller — depth bound is a 4-line addition; the malformed-prefix re-emit needs a maintainer to confirm intent before any change.

After decisions, dispatch a subagent. Verify with `make typecheck && make test-unit && make test-e2e`; the connection-error path has manual testing too (kill the server during a drag and verify the toast).
