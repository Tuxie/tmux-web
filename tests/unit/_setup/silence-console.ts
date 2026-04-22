/**
 * Global test preload: silence `console.log/info/warn/error/debug` by
 * routing every call into an in-memory buffer instead of the test
 * runner's stdout/stderr.
 *
 * Why: several modules under test (`src/server/themes.ts`'s warning
 * logger, `src/client/theme.ts`'s font-load fallback, the
 * `src/client/boot-errors.ts` boot-fetch accumulator, the
 * `src/server/origin.ts` rejection logger) legitimately emit
 * `console.warn` / `console.error` during normal operation. In
 * production that's what we want. In `bun test` those lines
 * interleave with the test progress output and make the watcher's
 * terminal unreadable.
 *
 * Tests that *want* to assert on console output can either:
 *   - import `consoleCaptured()` from this file, OR
 *   - swap `console.<level>` themselves (the existing pattern in
 *     `tests/unit/client/boot-errors.test.ts` keeps working — their
 *     `origWarn` captures the silencer, and restoring it just puts
 *     the silencer back in place).
 *
 * Buffer is cleared before each test via `beforeEach` so captures
 * from a prior test can't bleed in.
 *
 * Wired in via `bunfig.toml`'s `[test] preload` so every test file
 * gets the silencer without per-file imports.
 */

import { beforeEach } from 'bun:test';

type Level = 'log' | 'info' | 'warn' | 'error' | 'debug';

export interface CapturedLine {
  level: Level;
  args: unknown[];
}

const buffer: CapturedLine[] = [];

const ORIGINAL = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
  debug: console.debug,
} as const;

for (const level of Object.keys(ORIGINAL) as Level[]) {
  console[level] = (...args: unknown[]): void => {
    buffer.push({ level, args });
  };
}

// Server code routes debug logs through `process.stderr.write(...)`
// directly (see `debug()` in `src/server/ws.ts` + `src/server/http.ts`)
// so `config.debug=true` tests bypass `console.*` and land in stderr.
// Wrap only so bun's own stderr output (unhandled rejection stacks,
// reporter diagnostics) is preserved; we only capture writes that
// start with the `[debug] ` prefix our debug logger uses.
const originalStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = ((chunk: any, ...rest: unknown[]): boolean => {
  if (typeof chunk === 'string' && chunk.startsWith('[debug] ')) {
    buffer.push({ level: 'debug', args: [chunk.replace(/\n$/, '')] });
    return true;
  }
  return (originalStderrWrite as any)(chunk, ...rest);
}) as typeof process.stderr.write;

beforeEach(() => {
  buffer.length = 0;
});

/** Return a snapshot of captured console calls. Optional `level`
 *  filter narrows to one stream. */
export function consoleCaptured(level?: Level): CapturedLine[] {
  return level === undefined ? buffer.slice() : buffer.filter((l) => l.level === level);
}

/** Clear the buffer explicitly — useful for tests that want to
 *  partition captures within a single test body. */
export function resetConsoleCapture(): void {
  buffer.length = 0;
}

/** Escape hatch for the (rare) test that actually needs the real
 *  stdout — e.g. verifying that a CLI script prints its banner. */
export const originalConsole = ORIGINAL;
