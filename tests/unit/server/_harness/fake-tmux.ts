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
export function makeFakeTmux(opts: { panePid?: number; failDisplayMessage?: boolean } = {}): { path: string; logFile: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'fake-tmux-'));
  const logFile = join(dir, 'calls.log');
  const bin = join(dir, 'tmux');
  const panePid = opts.panePid ?? 1;
  writeFileSync(bin, `#!/usr/bin/env bash
LOG="${logFile}"
# Use flock-free append with single write() via printf; append mode is
# atomic on POSIX for writes <= PIPE_BUF (4096 bytes).
printf '%s\\n' "$*" >> "$LOG"
sync 2>/dev/null || true
# Skip leading '-f <path>' so the command dispatcher sees the real verb.
if [ "$1" = "-f" ]; then shift 2; fi
case "$1" in
  display-message)
    ${opts.failDisplayMessage ? 'exit 1' : ''}
    for arg in "$@"; do
      case "$arg" in
        *pane_pid*pane_current_command*) echo -e "${panePid}\\tbash"; exit 0;;
        *pane_title*) echo "fake-title"; exit 0;;
      esac
    done
    echo -e "${panePid}\\tbash"
    ;;
  list-windows) echo "0:one:1"; echo "1:two:0";;
  list-sessions) echo "main: 1 windows"; echo "dev: 1 windows";;
  new-session)
    # Keep the PTY alive for integration tests, but exit on signals so
    # proc.kill() cleans up reliably.
    trap 'exit 0' TERM INT HUP
    # Put PTY into raw mode so control bytes (ESC) pass through unchanged —
    # tests for OSC 52 read depend on raw-byte round-tripping.
    # Explicitly set raw attributes. Double up for reliability.
    stty -icanon -echo -onlcr -icrnl -inlcr -igncr -ixon -ixoff -istrip -opost min 1 time 0 2>/dev/null || true
    stty raw -echo 2>/dev/null || true
    # If a trigger file exists, emit its contents after a short delay so
    # the client WebSocket has time to finish its handshake (server-side
    # PTY onData drops data when ws.readyState != OPEN).
    if [ -f "${dir}/trigger" ]; then
      # Short delay so the server-side ws has reached OPEN (PTY onData drops
      # bytes before that). 150ms is a comfortable margin on localhost —
      # going lower occasionally loses the trigger bytes.
      (sleep 0.15; cat "${dir}/trigger") &
    fi
    # Read stdin in background and forward to stdout (so client-sent bytes
    # round-trip, enabling OSC 52 detection in processData).
    cat &
    READER_PID=$!
    sleep 30 &
    wait $!
    kill "$READER_PID" 2>/dev/null || true
    exit 0
    ;;
  select-window|new-window|kill-window|rename-window|rename-session|kill-session|set-environment|send-keys) exit 0;;
  *) exit 0;;
esac
`);
  chmodSync(bin, 0o755);
  return { path: bin, logFile, dir };
}
