#!/usr/bin/env bun
/** Parse coverage/lcov.info produced by `bun test --coverage` and fail
 *  if any in-scope file falls below the per-file threshold or the
 *  overall aggregate drops below the global threshold.
 *
 *  Excluded files (bootstrap / generated / IO-shell wrappers) are
 *  reported but not counted toward the gate. */

import { readFileSync } from 'node:fs';

const EXCLUDES = new Set<string>([
  'src/server/index.ts',
  'src/client/index.ts',
  // Tracked in docs/ideas/webgl-mock-harness-for-xterm-adapter.md —
  // needs a WebGL context stub before the WebGL patcher closures can
  // be unit-tested.
  'src/client/adapters/xterm.ts',
  // Tracked in docs/ideas/topbar-full-coverage-harness.md — ~150
  // mechanical cases required to cover the slider-table + menu render
  // paths. Public surface is tested in tests/unit/client/ui/topbar.test.ts.
  'src/client/ui/topbar.ts',
  // Tracked in docs/ideas/scrollbar-full-coverage-harness.md — the
  // controller is dominated by closure-based event handlers (drag
  // rAF coalescing, autohide reveal/hide cycle, hold-to-repeat
  // arrow timers, dispose teardown) that need a richer DOM stub
  // and a fake-timer harness to exercise. Public surface is
  // partially tested in tests/unit/client/ui/scrollbar.test.ts.
  'src/client/ui/scrollbar.ts',
  'src/server/assets-embedded.ts',
  // Pure interface / type-alias declaration files. The TS compiler
  // erases them at runtime so lcov never emits an SF: record. Listed
  // explicitly so the missing-from-lcov gate (cluster 20 F3) doesn't
  // flag them as untested.
  'src/client/adapters/types.ts',
  'src/server/terminal-transport.ts',
  'src/shared/types.ts',
]);

const PER_FILE_LINE_MIN = 95;
const PER_FILE_FUNC_MIN = 90;
const GLOBAL_LINE_MIN = 95;

/** Per-file overrides. `ws.ts` has four Node-fallback / testMode-only
 *  closures that are architecturally unreachable under Bun, and two
 *  OSC 52 integration-test paths that are timing-sensitive enough to
 *  flap by one or two lines across runs; the v1.8.0 attach/detach/
 *  switchSession + sessionRefs wiring added more such paths around
 *  control-pool lifecycle. `tmux-control.ts` (new in v1.8.0) has
 *  spawn-failure / process-exit / cancellation branches only reached
 *  by real-tmux e2e — unit-side coverage is tracked as follow-up.
 *
 *  The v1.9.0 beta desktop wrapper files sit at native/packaging
 *  boundaries. Unit tests cover the pure selectors, launch helpers,
 *  and host-message routing; the uncovered lines are mostly OS-native
 *  error/fallback branches or post-build filesystem variants exercised
 *  only by real Electrobun packaging. Keep them in-scope with explicit
 *  lower per-file floors instead of excluding the files entirely. */
const PER_FILE_FUNC_OVERRIDES: Record<string, number> = {
  'src/server/ws.ts': 82,
  'src/server/tmux-control.ts': 85,
  'src/client/auth-fetch.ts': 85,
  // src/desktop/index.ts is a native/packaging boundary — its
  // SIGINT/SIGTERM/SIGHUP handlers and the proc.exited / win.close
  // catch-all callbacks are only reached during real Electrobun
  // shutdown. The smoke-coverage harness in
  // tests/unit/desktop/main.test.ts exercises the bring-up branch and
  // the close-window host-message route; the rest is tracked at the
  // native layer.
  'src/desktop/index.ts': 35,
  // bench-compare.ts has a CLI entry path (argv parsing, file-not-found
  // error message, stdin-vs-arg, exit-code routing) reached only under
  // `make bench-check`. The pure helpers (parseJsonLines, compareBench,
  // formatTable) are exhaustively unit-tested in
  // tests/unit/scripts/bench-compare.test.ts; the CLI shell is tracked
  // in docs/ideas/coverage-thresholds-followup.md.
  'scripts/bench-compare.ts': 70,
  // clipboard-prompt.ts gained a focus-trap + ARIA pass in cluster 09 +
  // additional shape variants in cluster 13. The new branches include
  // Tab/Shift+Tab cycle edges and capture-phase keydown stopPropagation
  // paths that are unit-covered for the happy path; the rare
  // failure-mode branches (multiple modals racing) are tracked at
  // docs/ideas/coverage-thresholds-followup.md.
  'src/client/ui/clipboard-prompt.ts': 85,
  // The stdio agent is a transport glue layer around a private loopback
  // HTTP/WebSocket server. Unit tests cover the protocol contract, default
  // server bring-up, and failure framing; the remaining functions are mostly
  // malformed-frame and shutdown catch branches that are exercised by e2e.
  'src/server/stdio-agent.ts': 80,
  // The default SSH spawn adapter is covered with a mocked Bun subprocess,
  // but Bun lcov still reports one adapter closure below the global function
  // floor. Keep the file in-scope; do not exclude it.
  'src/server/remote-agent-manager.ts': 89,
};
const PER_FILE_LINE_OVERRIDES: Record<string, number> = {
  'src/server/ws.ts': 91,
  'src/server/tmux-control.ts': 85,
  'scripts/prepare-electrobun-bundle.ts': 80,
  'src/client/auth-fetch.ts': 91,
  'src/desktop/display-workarea.ts': 80,
  'src/desktop/index.ts': 65,
  'src/desktop/server-process.ts': 92,
  'src/desktop/tmux-path.ts': 90,
  'src/desktop/window-host-messages.ts': 92,
  // See PER_FILE_FUNC_OVERRIDES above for the rationale on the
  // bench-compare and clipboard-prompt entries below.
  'scripts/bench-compare.ts': 80,
  'src/client/ui/clipboard-prompt.ts': 80,
  // See PER_FILE_FUNC_OVERRIDES above for the stdio-agent rationale.
  'src/server/stdio-agent.ts': 84,
};

interface FileCov { path: string; lines: { found: number; hit: number }; funcs: { found: number; hit: number } }

function parseLcov(text: string): FileCov[] {
  const out: FileCov[] = [];
  let cur: FileCov | null = null;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('SF:')) cur = { path: line.slice(3), lines: { found: 0, hit: 0 }, funcs: { found: 0, hit: 0 } };
    else if (!cur) continue;
    else if (line.startsWith('LF:')) cur.lines.found = Number(line.slice(3));
    else if (line.startsWith('LH:')) cur.lines.hit = Number(line.slice(3));
    else if (line.startsWith('FNF:')) cur.funcs.found = Number(line.slice(4));
    else if (line.startsWith('FNH:')) cur.funcs.hit = Number(line.slice(4));
    else if (line === 'end_of_record' && cur) { out.push(cur); cur = null; }
  }
  return out;
}

function pct(hit: number, found: number): number {
  return found === 0 ? 100 : (hit / found) * 100;
}

function normalise(p: string): string {
  const i = p.indexOf('/src/');
  return i >= 0 ? p.slice(i + 1) : p;
}

const lcov = readFileSync('coverage/lcov.info', 'utf8');
const files = parseLcov(lcov).map(f => ({ ...f, path: normalise(f.path) }));
if (files.length === 0) {
  console.error('check-coverage: no lcov records found; run `bun test --coverage` first');
  process.exit(2);
}

let totalFound = 0, totalHit = 0;
const failures: string[] = [];

const EXCLUDE_PREFIXES = ['tests/'];

const seenFiles = new Set<string>();

for (const f of files) {
  seenFiles.add(f.path);
  if (EXCLUDES.has(f.path)) continue;
  if (EXCLUDE_PREFIXES.some(p => f.path.startsWith(p))) continue;
  totalFound += f.lines.found;
  totalHit += f.lines.hit;
  const l = pct(f.lines.hit, f.lines.found);
  const fn = pct(f.funcs.hit, f.funcs.found);
  const lineMin = PER_FILE_LINE_OVERRIDES[f.path] ?? PER_FILE_LINE_MIN;
  if (l < lineMin) failures.push(`${f.path}: lines ${l.toFixed(1)}% < ${lineMin}%`);
  const funcMin = PER_FILE_FUNC_OVERRIDES[f.path] ?? PER_FILE_FUNC_MIN;
  if (fn < funcMin) failures.push(`${f.path}: funcs ${fn.toFixed(1)}% < ${funcMin}%`);
}

/** Reconcile lcov's `SF:` set against the actual `src/` tree so files no
 *  test ever imports surface as failures instead of dropping silently off
 *  the gate's radar. Without this, adding a new module without a test was
 *  a 95-percent-clean run (cluster 20 F3). */
const trackedSourcesResult = Bun.spawnSync(['git', 'ls-files', 'src/'], {
  stdout: 'pipe',
  stderr: 'pipe',
});
if (!trackedSourcesResult.success) {
  console.error(trackedSourcesResult.stderr.toString().trim() || 'check-coverage: git ls-files failed');
  process.exit(2);
}
const trackedSources = trackedSourcesResult.stdout.toString()
  .split('\n')
  .filter((p) => p.endsWith('.ts') && !p.endsWith('.d.ts'));
for (const p of trackedSources) {
  if (EXCLUDES.has(p)) continue;
  if (seenFiles.has(p)) continue;
  failures.push(`${p}: not exercised by any test`);
}

const globalPct = pct(totalHit, totalFound);
console.log(`\nGlobal (in-scope) lines: ${globalPct.toFixed(2)}% (${totalHit}/${totalFound})`);
if (globalPct < GLOBAL_LINE_MIN) failures.push(`global: ${globalPct.toFixed(1)}% < ${GLOBAL_LINE_MIN}%`);

if (failures.length > 0) {
  console.error('\nCoverage failures:');
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log('coverage OK');
