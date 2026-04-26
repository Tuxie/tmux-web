/** Unit tests for `scripts/bench-compare.ts`. The exported helpers
 *  (`parseJsonLines`, `compareBench`, `formatTable`) are pure so they
 *  can be tested without spawning the script. */

import { describe, expect, test } from 'bun:test';
import {
  REGRESSION_THRESHOLD_PCT,
  compareBench,
  formatTable,
  parseJsonLines,
  type BenchRecord,
} from '../../../scripts/bench-compare.ts';

function rec(name: string, ns: number, calls = 100_000): BenchRecord {
  return { name, ns_per_call: ns, calls, ts: '2026-04-26T00:00:00.000Z' };
}

describe('parseJsonLines', () => {
  test('parses one record per non-empty line', () => {
    const text = [
      '{"name":"a","ns_per_call":1,"calls":10,"ts":"t"}',
      '',
      '  {"name":"b","ns_per_call":2,"calls":20,"ts":"t"}  ',
    ].join('\n');
    expect(parseJsonLines(text)).toEqual([
      { name: 'a', ns_per_call: 1, calls: 10, ts: 't' },
      { name: 'b', ns_per_call: 2, calls: 20, ts: 't' },
    ]);
  });

  test('throws on malformed records', () => {
    expect(() => parseJsonLines('{"name":"a"}')).toThrow(/malformed record/);
  });
});

describe('compareBench', () => {
  test('equal baseline + current passes every case', () => {
    const baseline = [rec('a', 100), rec('b', 200)];
    const current = [rec('a', 100), rec('b', 200)];
    const result = compareBench(baseline, current);
    expect(result.failed).toBe(false);
    expect(result.rows.every((r) => r.status === 'pass')).toBe(true);
  });

  test('+25% regression on a single case fails the run', () => {
    const baseline = [rec('a', 100), rec('b', 200)];
    const current = [rec('a', 125), rec('b', 200)];
    const result = compareBench(baseline, current);
    expect(result.failed).toBe(true);
    const aRow = result.rows.find((r) => r.name === 'a')!;
    expect(aRow.status).toBe('fail');
    expect(aRow.delta_pct).toBeCloseTo(25, 5);
    const bRow = result.rows.find((r) => r.name === 'b')!;
    expect(bRow.status).toBe('pass');
  });

  test('-25% improvement on every case passes', () => {
    const baseline = [rec('a', 100), rec('b', 200)];
    const current = [rec('a', 75), rec('b', 150)];
    const result = compareBench(baseline, current);
    expect(result.failed).toBe(false);
    const aRow = result.rows.find((r) => r.name === 'a')!;
    expect(aRow.status).toBe('pass');
    expect(aRow.delta_pct).toBeCloseTo(-25, 5);
  });

  test('regression exactly at threshold passes; above it fails', () => {
    const baseline = [rec('a', 100)];
    const atThreshold = compareBench(baseline, [rec('a', 100 + REGRESSION_THRESHOLD_PCT)]);
    expect(atThreshold.failed).toBe(false);
    const aboveThreshold = compareBench(baseline, [rec('a', 100 + REGRESSION_THRESHOLD_PCT + 0.1)]);
    expect(aboveThreshold.failed).toBe(true);
  });

  test('case present only in current is reported as `new` and does not fail', () => {
    const baseline = [rec('a', 100)];
    const current = [rec('a', 100), rec('z', 50)];
    const result = compareBench(baseline, current);
    expect(result.failed).toBe(false);
    const zRow = result.rows.find((r) => r.name === 'z')!;
    expect(zRow.status).toBe('new');
    expect(zRow.baseline_ns).toBeNull();
    expect(zRow.current_ns).toBe(50);
  });

  test('case present only in baseline is reported as `missing` and fails', () => {
    const baseline = [rec('a', 100), rec('gone', 999)];
    const current = [rec('a', 100)];
    const result = compareBench(baseline, current);
    expect(result.failed).toBe(true);
    const goneRow = result.rows.find((r) => r.name === 'gone')!;
    expect(goneRow.status).toBe('missing');
    expect(goneRow.current_ns).toBeNull();
  });

  test('custom threshold overrides the default', () => {
    const baseline = [rec('a', 100)];
    const current = [rec('a', 110)];
    expect(compareBench(baseline, current, 5).failed).toBe(true);
    expect(compareBench(baseline, current, 50).failed).toBe(false);
  });
});

describe('formatTable', () => {
  test('renders a row per case with summary counts', () => {
    const result = compareBench([rec('a', 100), rec('b', 200)], [rec('a', 100), rec('b', 250)]);
    const table = formatTable(result);
    expect(table).toContain('case');
    expect(table).toContain('a');
    expect(table).toContain('b');
    expect(table).toContain('pass');
    expect(table).toContain('fail');
    expect(table).toMatch(/summary: 1 passed, 1 failed/);
  });

  test('renders em-dash for missing baseline / current values', () => {
    const result = compareBench([rec('gone', 100)], [rec('newcase', 50)]);
    const table = formatTable(result);
    expect(table).toContain('newcase');
    expect(table).toContain('gone');
    expect(table).toContain('—');
  });
});
