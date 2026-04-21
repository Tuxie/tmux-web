---
Status: resolved
Resolved-in: 11b8d7d
---

> **Resolution (2026-04-21) — maintainer decisions:**
> 1. Framework: `fast-check@4.7.0` as a devDependency.
> 2. All 9 targets landed in one session (not the staged rollout the
>    cluster suggested). Each parser has its own `tests/fuzz/*.test.ts`
>    with invariant-level assertions. 58 property tests total.
> 3. CI budget: fuzz pass is excluded from `bun test` (bunfig pins
>    root to `tests/unit`). New `make fuzz` target runs them locally.
>    CLAUDE.md release protocol updated: `act` first, then `make fuzz`,
>    then tag push.
>
> **Real bug caught by the fuzz pass:** `sanitizeSession('%')` threw
> because the internal `decodeURIComponent` rejects malformed
> percent-escapes. Fixed in the same commit (try/catch fallback to
> the raw input, which the charset filter then strips). Also
> captured as a regression guard in `tests/unit/server/pty.test.ts`
> so the fix is visible under the default `bun test` run too.


# Cluster 15 — fuzz-gaps

## TL;DR

- **Goal:** Introduce a property-based testing framework (`fast-check` or equivalent) and use it to cover the nine security-sensitive parsers / decoders / builders currently covered only by hand-picked fixture tests.
- **Impact:** The parsers in scope are the project's adversarial-input surface — shell quoting, filename sanitization, OSC / TT extraction, origin parsing, JSON-from-WS routing, TOML parsing of user theme packs, `/proc/<pid>/stat` parsing. Fixture tests catch yesterday's bugs; property tests catch tomorrow's.
- **Size:** Medium (pattern-first, then expand)
- **Depends on:** none
- **Severity:** Medium

## Header

> Session size: Medium · Analysts: Security, Test · Depends on: none

## Files touched

- `package.json` (new devDependency)
- `tests/unit/server/shell-quote.test.ts` (first property test — highest leverage)
- `tests/unit/server/pty.test.ts` (sanitizeSession property test)
- `tests/unit/server/file-drop.test.ts` (sanitiseFilename property test)
- `tests/unit/server/protocol.test.ts` (processData property test)
- `tests/unit/server/origin.test.ts` (parseOriginHeader / parseAllowOriginFlag property tests)
- `tests/unit/server/ws-router.test.ts` (routeClientMessage fuzz)
- `tests/unit/server/colours.test.ts` (alacrittyTomlToITheme fuzz)
- `tests/unit/server/foreground-process.test.ts` (parseForegroundFromProc fuzz)
- `tests/unit/client/protocol.test.ts` (extractTTMessages fuzz)

## Severity & autonomy

- Critical: 0 · High: 0 · Medium: 1 · Low: 0
- autofix-ready: 0 · needs-decision: 0 · needs-spec: 1

## Findings

- **Nine security-sensitive parsers covered only by fixture tests, with no property / fuzz framework in the repo** — Each of the nine modules listed below eats adversarial or semi-adversarial input and has well-defined invariants that are trivial to express as properties. The Security Analyst prioritized the four with the highest adversarial-input exposure (`processData`, `extractTTMessages`, `routeClientMessage`, `sanitiseFilename`); the Test Analyst prioritized the two with the tightest invariant (`shellQuote` — "round-trips through a real POSIX shell"; `sanitizeSession` — "never contains dangerous chars"). Those six overlap into a clear "start here" set.
  - Location: `src/server/shell-quote.ts` · `src/server/pty.ts` (sanitizeSession) · `src/server/file-drop.ts` (sanitiseFilename) · `src/server/protocol.ts` (processData) · `src/server/origin.ts` (parseOriginHeader, parseAllowOriginFlag) · `src/server/ws-router.ts` (routeClientMessage) · `src/server/colours.ts` (alacrittyTomlToITheme) · `src/server/foreground-process.ts` (parseForegroundFromProc) · `src/client/protocol.ts` (extractTTMessages)
  - Severity: Medium · Confidence: Plausible · Effort: Medium · Autonomy: needs-spec
  - Cluster hint: `fuzz-gaps`
  - Raised by: Security Analyst (FUZZ-1, from the security-criticality angle), Test Analyst (FUZZ-1, from the test-infrastructure angle — merged)
  - Notes: Suggested approach — add `fast-check` (~small devDependency) and write the first property against `shellQuote` because its contract is both the tightest and the most security-adjacent: "for any Unicode string `s`, `exec('sh', '-c', `echo ${shellQuote(s)}`).stdout.trimEnd()` equals `s`." That proves the pattern works in the project's Bun-native test harness. Then apply the same shape to the remaining parsers in priority order. Each new property is 15-30 minutes once the pattern is established.

## Suggested session approach

This is the only cluster in the report that is genuinely scope-open — "how thorough should property-testing be?" is a judgement call. Run as a short brainstorm: pick `fast-check` or equivalent, decide the first target (`shellQuote` is the recommended pick), and commit the pattern. The other eight targets can then be broken out as follow-on small PRs or added one per session. Don't try to cover all nine in one go.

## Commit-message guidance

1. Name the cluster slug and date — e.g., `test(cluster 15-fuzz-gaps, 2026-04-21): add fast-check + first property test on shellQuote`.
2. Note that follow-on PRs will extend the pattern to the other eight parsers listed in the cluster file.
3. No `Depends-on:` chain.
