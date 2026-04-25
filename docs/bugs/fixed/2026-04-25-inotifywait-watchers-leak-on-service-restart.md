# inotifywait watchers leak on tmux-web-dev service restart

## Symptom

`journalctl --user -u tmux-web-dev --since="9:41"` showed a large number of
left-over `inotifywait` processes when `tmux-web-dev.service` was restarted:

```text
tmux-web-dev.service: Unit process 3113525 (inotifywait) remains running after unit stopped.
tmux-web-dev.service: Unit process 3115752 (inotifywait) remains running after unit stopped.
...
tmux-web-dev.service: Found left-over process ... (inotifywait) in control group while starting unit. Ignoring.
```

The same restart also logged expected app cleanup:

```text
[debug] tmux-control close clients=1 starting=0 killCount=1
```

So tmux-control cleanup ran, but file-drop watcher cleanup did not reap all
active `inotifywait` children before the systemd user unit stopped.

## Context

I noticed this while checking logs for the fixed tmux-control probe
stale-response bug. The slow window-button issue appears fixed; this is a
separate cleanup/leak problem.

The file-drop implementation uses `inotifywait` watchers for auto-unlink on
file close. Unit tests cover watcher cleanup paths under `tests/unit/server/file-drop.test.ts`,
but the service log indicates real systemd restarts can leave watchers behind.

## Suggested investigation

Look at `src/server/file-drop.ts`, especially watcher spawn/kill bookkeeping,
and the server shutdown path in `src/server/index.ts`:

- Confirm every watcher spawned by file-drop storage is registered in the same
  storage instance passed to `cleanupDrops(dropStorage)`.
- Confirm `cleanupDrops()` actually kills active `inotifywait` children and
  waits or otherwise ensures they exit before process shutdown.
- Confirm SIGTERM/SIGHUP restart paths call the same cleanup and do not exit
  before watcher termination has a chance to complete.
- Add a regression that simulates process shutdown with multiple active
  watchers and asserts all watcher `kill()` hooks are invoked.

## Risk

Leaked watchers accumulate inside the user service cgroup across restarts,
increase process count, and can keep stale file-drop paths or tmux-web service
state alive longer than intended.

## Fixed

Fixed by making file-drop cleanup wait for active watcher `exit` events after
`SIGTERM`, and by making the server signal handlers await cleanup before
calling `process.exit(0)`.
