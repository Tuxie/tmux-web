# `make test` can hang indefinitely in `bun test --parallel`

Date found: 2026-04-24

Fixed: 2026-04-25

## Context

While fixing the web-menu session switch bug, `make test` reached:

```bash
bun test --parallel
```

and produced no further output for several minutes. A bounded reproduction later confirmed the behavior:

```bash
timeout 45s make test-unit
```

The command printed only `bun test --parallel` and then timed out.

## Root Cause

The Makefile-specific `--parallel` Bun test worker path could hang before reporting a timed-out test. Switching to plain `bun test` was not sufficient because the single-process runner exposed cross-file state leakage in server/desktop tests.

## Resolution

`make test-unit` now runs `scripts/test-unit-files.sh`, which executes each `tests/unit/**/*.test.ts` file in its own `bun test <file>` process. This keeps process-level isolation without using Bun's `--parallel` dispatcher.

The runner schedules `tests/unit/desktop/smoke.test.ts` first and `tests/unit/desktop/server-process.test.ts` last because both exercise nested Bun child-server lifecycle behavior and are sensitive to inherited process state in constrained test environments.
