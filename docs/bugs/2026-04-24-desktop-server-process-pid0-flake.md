# Flaky desktop server-process test can fail with `pid 0 is still alive`

Observed while verifying the macOS tmux-term bundle layout changes on 2026-04-24.

Command:

```bash
bun test tests/unit/desktop/index.test.ts tests/unit/desktop/server-process.test.ts
```

The first run failed in:

```text
desktop tmux-web launch helpers > startTmuxWebServer timeout kills a pre-readiness child that ignores SIGTERM
```

Error:

```text
error: pid 0 is still alive
at waitForPidExit (/src/tmux-web/tests/unit/desktop/server-process.test.ts:63:13)
```

An immediate rerun of the same command passed all 24 tests. The failure
looks like the test helper sometimes reads or keeps `pid = 0` for the child
it is waiting on, then `isPidAlive(0)` treats that as alive. This appears
unrelated to the tmux-term packaging changes, which touched desktop path
resolution and Electrobun bundle layout.

Suggested future fix: inspect `tests/unit/desktop/server-process.test.ts`
around the failing test's PID capture and `waitForPidExit`; ensure the test
never passes `0` as a real child PID, or treats `0` as "no captured pid" and
fails with a clearer setup error.
