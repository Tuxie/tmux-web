#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

TMPPORT=14999
SCRIPT_PID=""
COMMITTED=0

cleanup() {
  [ -n "$SCRIPT_PID" ] && kill "$SCRIPT_PID" 2>/dev/null || true
  [ -n "$SCRIPT_PID" ] && wait "$SCRIPT_PID" 2>/dev/null || true
  if [ "$COMMITTED" -eq 1 ]; then
    git reset --soft HEAD~1 2>/dev/null || true
  fi
}
trap cleanup EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

# Start dev server in test mode
./tmux-web-dev --test --listen "127.0.0.1:$TMPPORT" &
SCRIPT_PID=$!

# Wait for server (up to 5s)
for i in $(seq 1 10); do
  sleep 0.5
  curl -sf "http://127.0.0.1:$TMPPORT/" >/dev/null 2>&1 && break
  [ "$i" -eq 10 ] && fail "server did not start within 5s"
done

# Get initial child server PID
INITIAL_PID=$(pgrep -P "$SCRIPT_PID" 2>/dev/null | head -1 || echo "")
[ -z "$INITIAL_PID" ] && fail "no child process found — script may have exec'd (no restart support)"

# Trigger restart via empty commit
git commit --allow-empty -q -m "test: restart trigger"
COMMITTED=1

# Wait for restart (up to 6s)
NEW_PID=""
for i in $(seq 1 12); do
  sleep 0.5
  NEW_PID=$(pgrep -P "$SCRIPT_PID" 2>/dev/null | head -1 || echo "")
  [ -n "$NEW_PID" ] && [ "$NEW_PID" != "$INITIAL_PID" ] && break
  [ "$i" -eq 12 ] && fail "server did not restart within 6s (PID still $INITIAL_PID)"
done

# Verify server is back up (up to 5s)
for i in $(seq 1 10); do
  sleep 0.5
  curl -sf "http://127.0.0.1:$TMPPORT/" >/dev/null 2>&1 && break
  [ "$i" -eq 10 ] && fail "server did not respond after restart"
done

echo "PASS: server restarted (PID $INITIAL_PID -> $NEW_PID)"
