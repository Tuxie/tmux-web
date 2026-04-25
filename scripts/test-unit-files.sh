#!/bin/sh
set -eu

BUN_BIN=${1:-bun}
SMOKE_TEST='tests/unit/desktop/smoke.test.ts'
SERVER_PROCESS_TEST='tests/unit/desktop/server-process.test.ts'

run_file() {
  file=$1
  printf '\n==> %s test %s\n' "$BUN_BIN" "$file"
  "$BUN_BIN" test "$file"
}

files=$(find tests/unit -name '*.test.ts' -print | sort)

for file in $files; do
  if [ "$file" = "$SMOKE_TEST" ]; then
    run_file "$file"
  fi
done

for file in $files; do
  if [ "$file" != "$SMOKE_TEST" ] && [ "$file" != "$SERVER_PROCESS_TEST" ]; then
    run_file "$file"
  fi
done

for file in $files; do
  if [ "$file" = "$SERVER_PROCESS_TEST" ]; then
    run_file "$file"
  fi
done
