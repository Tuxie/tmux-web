#!/usr/bin/env bun
/** Compare a fresh bench run against a checked-in baseline.
 *
 *  Usage:
 *
 *      bun run scripts/bench-render-math.ts --json \
 *        | bun run scripts/bench-compare.ts bench/baseline.json -
 *
 *  Reads the baseline from the path argv (one JSON object per line,
 *  matching `scripts/bench-render-math.ts --json` output) and the
 *  current run from stdin (same format). Prints a per-case delta table
 *  and exits non-zero if any case regressed by more than
 *  `REGRESSION_THRESHOLD` (default 20%). Improvements never fail.
 *
 *  Cases present in the current run but missing from the baseline are
 *  reported as `new` (informational). Cases present in the baseline
 *  but missing from the current run are reported as `missing` and
 *  fail the run. */

import { readFileSync } from 'node:fs';

export interface BenchRecord {
  name: string;
  ns_per_call: number;
  calls: number;
  ts: string;
}

export interface CompareRow {
  name: string;
  baseline_ns: number | null;
  current_ns: number | null;
  delta_pct: number | null;
  status: 'pass' | 'fail' | 'new' | 'missing';
}

export interface CompareResult {
  rows: CompareRow[];
  failed: boolean;
}

export const REGRESSION_THRESHOLD_PCT = 20;

export function parseJsonLines(input: string): BenchRecord[] {
  const out: BenchRecord[] = [];
  for (const raw of input.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const parsed = JSON.parse(line) as BenchRecord;
    if (
      typeof parsed.name !== 'string' ||
      typeof parsed.ns_per_call !== 'number' ||
      typeof parsed.calls !== 'number'
    ) {
      throw new Error(`bench-compare: malformed record: ${line}`);
    }
    out.push(parsed);
  }
  return out;
}

export function compareBench(
  baseline: BenchRecord[],
  current: BenchRecord[],
  thresholdPct: number = REGRESSION_THRESHOLD_PCT,
): CompareResult {
  const baseByName = new Map(baseline.map((r) => [r.name, r]));
  const curByName = new Map(current.map((r) => [r.name, r]));
  const rows: CompareRow[] = [];
  let failed = false;

  for (const cur of current) {
    const base = baseByName.get(cur.name);
    if (!base) {
      rows.push({
        name: cur.name,
        baseline_ns: null,
        current_ns: cur.ns_per_call,
        delta_pct: null,
        status: 'new',
      });
      continue;
    }
    const deltaPct = ((cur.ns_per_call - base.ns_per_call) / base.ns_per_call) * 100;
    const status: CompareRow['status'] = deltaPct > thresholdPct ? 'fail' : 'pass';
    if (status === 'fail') failed = true;
    rows.push({
      name: cur.name,
      baseline_ns: base.ns_per_call,
      current_ns: cur.ns_per_call,
      delta_pct: deltaPct,
      status,
    });
  }
  for (const base of baseline) {
    if (!curByName.has(base.name)) {
      rows.push({
        name: base.name,
        baseline_ns: base.ns_per_call,
        current_ns: null,
        delta_pct: null,
        status: 'missing',
      });
      failed = true;
    }
  }
  return { rows, failed };
}

export function formatTable(result: CompareResult, thresholdPct: number = REGRESSION_THRESHOLD_PCT): string {
  const lines: string[] = [];
  lines.push(`bench-compare (regression threshold: +${thresholdPct}%)`);
  lines.push('');
  const header = `${'case'.padEnd(48)}  ${'baseline'.padStart(12)}  ${'current'.padStart(12)}  ${'delta'.padStart(8)}  status`;
  lines.push(header);
  lines.push('-'.repeat(header.length));
  for (const row of result.rows) {
    const base = row.baseline_ns === null ? '—' : `${row.baseline_ns.toFixed(2)}ns`;
    const cur = row.current_ns === null ? '—' : `${row.current_ns.toFixed(2)}ns`;
    const delta = row.delta_pct === null ? '—' : `${row.delta_pct >= 0 ? '+' : ''}${row.delta_pct.toFixed(1)}%`;
    lines.push(`${row.name.padEnd(48)}  ${base.padStart(12)}  ${cur.padStart(12)}  ${delta.padStart(8)}  ${row.status}`);
  }
  lines.push('');
  const passed = result.rows.filter((r) => r.status === 'pass').length;
  const failedCount = result.rows.filter((r) => r.status === 'fail').length;
  const newCount = result.rows.filter((r) => r.status === 'new').length;
  const missingCount = result.rows.filter((r) => r.status === 'missing').length;
  lines.push(`summary: ${passed} passed, ${failedCount} failed, ${newCount} new, ${missingCount} missing`);
  return lines.join('\n');
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<number> {
  const baselinePath = process.argv[2];
  const currentArg = process.argv[3];
  if (!baselinePath || !currentArg) {
    console.error('usage: bench-compare <baseline.json> <current.json|->');
    return 2;
  }
  const baselineText = readFileSync(baselinePath, 'utf8');
  const currentText = currentArg === '-' ? await readStdin() : readFileSync(currentArg, 'utf8');
  const baseline = parseJsonLines(baselineText);
  const current = parseJsonLines(currentText);
  const result = compareBench(baseline, current);
  console.log(formatTable(result));
  return result.failed ? 1 : 0;
}

if (import.meta.main) {
  main().then((code) => process.exit(code));
}
