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
  'src/client/adapters/xterm.ts',
  'src/server/assets-embedded.ts',
]);

const PER_FILE_LINE_MIN = 95;
const PER_FILE_FUNC_MIN = 90;
const GLOBAL_LINE_MIN = 95;

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

for (const f of files) {
  if (EXCLUDES.has(f.path)) continue;
  if (EXCLUDE_PREFIXES.some(p => f.path.startsWith(p))) continue;
  totalFound += f.lines.found;
  totalHit += f.lines.hit;
  const l = pct(f.lines.hit, f.lines.found);
  const fn = pct(f.funcs.hit, f.funcs.found);
  if (l < PER_FILE_LINE_MIN) failures.push(`${f.path}: lines ${l.toFixed(1)}% < ${PER_FILE_LINE_MIN}%`);
  if (fn < PER_FILE_FUNC_MIN) failures.push(`${f.path}: funcs ${fn.toFixed(1)}% < ${PER_FILE_FUNC_MIN}%`);
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
