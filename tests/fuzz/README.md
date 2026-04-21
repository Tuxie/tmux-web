# Property-based tests

Each file here asserts an invariant that must hold for *every* input
drawn from a `fast-check` arbitrary — the idea being that fixture
tests catch yesterday's bugs (regression-style) while property tests
catch tomorrow's (unknown-unknowns).

## Running

Not run by `bun test` / `make test-unit` (the release path) —
`bunfig.toml` pins `root = "tests/unit"` so these are excluded. Run
via:

```
make fuzz
```

Per CLAUDE.md the release protocol is:

1. `act -j build …` (verify workflow against an ubuntu container)
2. `make fuzz` (run the property tests locally)
3. `git push` the tag

Each target is declared in `scripts/check-coverage.ts` as an excluded
path so the fuzz harness doesn't distort coverage numbers — property
tests already run the production code through fixture-level unit
tests, so the fuzz pass is additive coverage of *branches that matter
at scale*, not a substitute for fixture coverage.

## Pattern

```ts
import { describe, test, expect } from 'bun:test';
import fc from 'fast-check';
import { target } from '../../src/…';

describe('target', () => {
  test('invariant description', () => {
    fc.assert(fc.property(fc.<arbitrary>(), (input) => {
      // Assertion about target(input).
    }), { numRuns: 200 });
  });
});
```

Async targets (e.g. `shellQuote` round-trip through a real shell) use
`fc.asyncProperty` + `fc.assert(... , { numRuns: 50 })` — the lower
run count balances the syscall cost.
