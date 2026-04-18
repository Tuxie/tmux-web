// tests/unit/server/_harness/fake-tmux.ts
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Returns path to a fake-tmux binary implementing the narrow surface
 *  tmux-web calls: display-message, list-windows, select-window,
 *  new-window, kill-window, rename-window, rename-session, kill-session,
 *  set-environment, send-keys -H <hex>, new-session -A -s …
 *  State is kept in a sidecar JSON file whose path is logged per call so
 *  tests can assert the call sequence. */
export function makeFakeTmux(): { path: string; logFile: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'fake-tmux-'));
  const logFile = join(dir, 'calls.log');
  const bin = join(dir, 'tmux');
  writeFileSync(bin, `#!/usr/bin/env bash
LOG="${logFile}"
printf '%s\\n' "$*" >> "$LOG"
case "$1" in
  display-message)
    for arg in "$@"; do
      case "$arg" in
        *pane_pid*pane_current_command*) echo -e "1\\tbash"; exit 0;;
        *pane_title*) echo "fake-title"; exit 0;;
      esac
    done
    echo -e "1\\tbash"
    ;;
  list-windows) echo "0:one:1"; echo "1:two:0";;
  list-sessions) echo "main: 1 windows"; echo "dev: 1 windows";;
  new-session|select-window|new-window|kill-window|rename-window|rename-session|kill-session|set-environment|send-keys) exit 0;;
  *) exit 0;;
esac
`);
  chmodSync(bin, 0o755);
  return { path: bin, logFile, dir };
}
