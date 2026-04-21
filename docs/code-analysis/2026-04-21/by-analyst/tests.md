# Test Analyst — analyst-native output

> Preserved for traceability. For fix work, use the clusters under `../clusters/` — they cross-cut these per-analyst sections.

## Summary

The test suite is well-structured and thorough for a T2 project: 52 unit files and 33 E2E files covering the security-critical surfaces (auth, origin validation, OSC 52, clipboard policy, session store) with both unit and integration-level tests. The single substantive correctness finding is a tautological assertion in the `logOriginReject` test (`expect(typeof called).toBe('number')`) that verifies nothing about the rate-limiting or eviction behavior it claims to exercise — this is the only case where a test body does not match its stated intent. The remaining findings are low-severity: moderate unit-coverage gaps on three client modules (`dropdown.ts`, `toast.ts`, `connection.ts` — subsumed by cluster 02), a minor test-redundancy across two PTY test files, and the absence of property-based testing for the security-sensitive parsers. No tier mis-classification — T2 designation is correct.

## Findings (by cluster)

**→ cluster 02-client-unit-test-coverage** subsumes TEST-3 ×3 (dropdown.ts, toast.ts, connection.ts)

**→ cluster 14-test-quality-fixes**
- TEST-6 `logOriginReject` test final assertion is tautological — Medium / Verified
- DET-4 `recentOriginRejects` module-level Map leaks across sibling tests — Low / Plausible
- DET-3 `bundled-themes.test.ts` reads the real `./themes/` directory — Low / Verified
- TEST-5 `pty.test.ts` and `pty-argv.test.ts` duplicate `sanitizeSession`/`buildPtyCommand` assertions — Low / Verified

**→ cluster 15-fuzz-gaps**
- FUZZ-1 Shell-injection surface (shellQuote, sanitizeSession) + other security-sensitive parsers lack property tests — Medium / Plausible (merged with Security Analyst's FUZZ-1 finding)

## Checklist (owned items)

- TEST-1 [x] (1 instance) — `logOriginReject` test name claims rate-limit/eviction behavior; only asserts tautology → cluster 14
- TEST-2 [x] clean — test names throughout are concise and descriptive
- TEST-3 [x] (3 instances) `dropdown.ts`, `toast.ts`, `connection.ts` no unit coverage → cluster 02
- TEST-4 [x] clean — major user-visible flows (sessions, theming, clipboard, file-drop, fullscreen, topbar, reconnect, OSC-52 consent, TLS, origin) have E2E tests
- TEST-5 [x] (1 instance) `pty.test.ts` / `pty-argv.test.ts` duplicate → cluster 14
- TEST-6 [x] (1 instance) `logOriginReject` final assertion always true → cluster 14
- TEST-7 [x] clean — `beforeEach`/`afterEach` with mkdtempSync/rmSync used consistently
- TEST-8 [x] clean — Bun native test runs in single process; E2E tests use port isolation via `PORTS.md` pattern
- TEST-9 [x] clean — no slow-test tagging needed (Bun test has no built-in tagging); one known slow test (`/api/drop POST too large`) carries explicit `30_000` timeout
- TEST-10 [x] clean — no test files mix substantially unrelated concerns
- DET-1 [x] clean — no wall-clock-dependent assertions; `Date.now() ± offset` patterns use controlled relative offsets
- DET-2 [x] clean — no RNG usage without seed
- DET-3 [x] (1 instance, accepted coupling) — `bundled-themes.test.ts` reads live dir; deliberate trade-off → cluster 14
- DET-4 [x] (1 instance) `recentOriginRejects` map not reset between tests → cluster 14
- FUZZ-1 [x] `shellQuote`, `sanitizeSession`, and other security parsers lack property tests; no fuzz framework in repo → cluster 15
