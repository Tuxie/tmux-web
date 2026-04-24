# `make test` can hang indefinitely in `bun test --parallel`

Date found: 2026-04-24

## Context

While fixing the web-menu session switch bug, I ran the full project verifier:

```bash
make test
```

The command successfully completed the early phases:

- configured and installed `vendor/tmux`
- generated `src/server/assets-embedded.ts`
- ran `bun x tsc --noEmit -p tsconfig.json`
- ran `bun x tsc --noEmit -p tsconfig.client.json`

It then reached:

```bash
bun test --parallel
```

and produced no further output for several minutes.

## Observed State

`pgrep -af 'bun test|make test|playwright|node_modules/.bin/playwright'` showed:

- `make test`
- `bun test --parallel`
- one `bun test --test-worker --isolate --timeout=5000 --max-concurrency=20 --preload ./tests/unit/_setup/silence-console.ts --jsx-runtime=automatic`

The run did not appear to honor the per-test timeout at the process level, or at least no timeout output reached the parent `make test` command.

I stopped it with escalated:

```bash
kill 3111993 3111996 3110159
```

The original `make test` session then exited with:

```text
make: *** [Makefile:52: test-unit] Error 130
```

## Additional Symptom

While trying to inspect the hung run, this command failed:

```bash
ps -eo pid,ppid,stat,etime,cmd | rg 'bun test|playwright|tmux-web|node node_modules'
```

and `/bin/ps -eo pid,ppid,stat,etime,args` also failed with:

```text
fatal library error, lookup self
```

`pgrep -af ...` still worked and was enough to identify the stuck process.

## Why This Matters

The repo instructions ask for full-suite verification after fixes. If `make test` can hang silently in `bun test --parallel`, a future model may wait forever or kill the run without enough diagnostic context.

## Suggested Next Steps

1. Reproduce with `make test` from a clean shell.
2. If it hangs, run unit tests with a lower concurrency or with per-file isolation to identify the stuck test file.
3. Investigate why `bun test --timeout=5000` leaves the worker process alive without reporting a timed-out test.
4. Separately check why `ps` fails with `fatal library error, lookup self` in this environment while `pgrep` works.
