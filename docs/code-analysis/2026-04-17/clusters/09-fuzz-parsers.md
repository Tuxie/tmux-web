# Cluster 09 — fuzz-parsers

> **Goal:** Cap the OSC-52 write path to 1 MiB and add targeted property / adversarial tests for the two parsers that read attacker-influenced input.
>
> Session size: Small · Analysts: Security, Test (joint FUZZ-1) · Depends on: none

## Files touched

- `src/server/protocol.ts` (OSC-52 cap)
- `src/server/ws.ts` (DoS anchor)
- `src/server/colours.ts` (TOML edge cases)
- `tests/unit/server/colours.test.ts`, `tests/unit/server/protocol.test.ts` (new tests)

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 1 · Low: 2
- autofix-ready: 1 · needs-decision: 1 · needs-spec: 1

## Findings

- **No upper-bound cap on OSC-52 write clipboard base64 forwarded to client** — `processData` streams every OSC-52 write through to the client. The read path caps at 1 MiB (`ws.ts:390`), but write has no cap, so a PTY program can fire arbitrarily large `ESC ] 52 ; c ; <giant> BEL` sequences, each becoming a JSON envelope held in the WS send buffer.
  - Location: `src/server/protocol.ts:46-50`, `src/server/ws.ts:308-323`
  - Severity: Low · Confidence: Verified · Effort: Small · Autonomy: autofix-ready
  - Cluster hint: `osc52-write-dos`
  - Raised by: Security, Test
  - Fix: Cap `b64` at 1 MiB before pushing `{clipboard: b64}`; drop-with-warn on overflow.

- **Alacritty TOML colour parser unfuzzed, runs on user-supplied content** — `alacrittyTomlToITheme` is reached via `listColours` on every `/api/colours` request; content comes from user theme-pack dirs. `Bun.TOML.parse` exceptions are caught at call sites but the normalize/key-validation logic has no fuzz or property coverage. Untested: deeply nested tables, Unicode confusables in colour keys, `0x`-prefix strings that pass the regex but produce non-hex after normalize (e.g. `"0xgg"` → `"#gg"`).
  - Location: `src/server/colours.ts:17-48`, `src/server/themes.ts:140-171`
  - Severity: Low · Confidence: Plausible · Effort: Medium · Autonomy: needs-spec
  - Cluster hint: `fuzz-toml-theme`
  - Raised by: Security, Test
  - Notes: For T2, skip a full fuzz harness. Add 3–5 targeted edge-case tests in `colours.test.ts` covering non-hex-after-`0x`, uppercase hex, whitespace-only values, unknown colour keys, and deeply nested tables.

- **OSC-52 base64 regex lacks length bound and has no property test** — `OSC_52_WRITE_RE` at `src/server/protocol.ts:24` matches `[A-Za-z0-9+/=]+` with no upper bound. Client-side `decodeClipboardBase64` calls `atob` + `TextDecoder.decode` without size limits. Same defect as the write-DoS above but from the test-coverage angle.
  - Location: `src/server/protocol.ts:24`, `src/client/ui/clipboard.ts`
  - Severity: Medium · Confidence: Plausible · Effort: Small · Autonomy: needs-decision
  - Cluster hint: `fuzz-osc52`
  - Raised by: Test
  - Notes: After adding the 1 MiB cap above, add a property-style test (e.g. `fc.base64String({ maxLength })` from fast-check, or a handful of hand-crafted adversarial strings if the project would rather not take the dep) across `processData` → `decodeClipboardBase64` round-trip.

## Suggested session approach

Apply the 1 MiB cap in `processData`, then add the targeted edge-case tests — these land as a single commit. The fast-check question (take a new dev dependency vs hand-craft adversarial strings) is the only design decision; default to hand-crafted for T2 unless the project already ships another property-testing lib.
