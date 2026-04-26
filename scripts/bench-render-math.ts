#!/usr/bin/env bun
/** Micro-bench for the per-cell WebGL render-math hot path.
 *
 *  `_patchWebglExplicitBackgroundOpacity` in `src/client/adapters/xterm.ts`
 *  calls `pushLightness` and `adjustSaturation` on every cell of every
 *  frame. At 60 fps in a 240x50 terminal that's 720k calls/sec per
 *  transform. This script times both against a synthetic N-cell array
 *  so a regression in the OKLab round-trip constants shows up as a
 *  nanosecond-per-call delta — no WebGL context required.
 *
 *  Run: `bun scripts/bench-render-math.ts` or `make bench`.
 *
 *  Pass `--json` to emit one JSON object per case to stdout (one per
 *  line, no surrounding array) for capture into `bench/baseline.json`
 *  and downstream comparison via `scripts/bench-compare.ts`.
 */

import { pushLightness } from '../src/client/fg-contrast.ts';
import { adjustSaturation } from '../src/client/tui-saturation.ts';
import { srgbByteToOklab, oklabToSrgbByte } from '../src/client/oklab.ts';
import {
  withBlendedEffectiveBackground,
  XTERM_COLOR_MODE_RGB,
  XTERM_FG_FLAG_INVERSE,
  type XtermCellTheme,
  type XtermCellState,
} from '../src/client/adapters/xterm-cell-math.ts';

const JSON_MODE = process.argv.includes('--json');
const N = 100_000;

function makeCells(n: number): Uint8Array {
  const out = new Uint8Array(n * 3);
  let s = 0xdeadbeef >>> 0;
  for (let i = 0; i < out.length; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    out[i] = s & 0xff;
  }
  return out;
}

interface BenchCase {
  name: string;
  ns_per_call: number;
  calls: number;
  ts: string;
}

// Number of timed runs per case. The minimum across runs is reported
// (standard "best-of-N" micro-bench shape) to suppress GC / OS-jitter
// noise on the cheap identity-fast cases. Increase for tighter
// numbers; decrease if total bench wall time grows past a few seconds.
const RUNS_PER_CASE = 5;

function time(label: string, calls: number, fn: () => void): void {
  // Warm-up passes so the JIT has specialised the closure before the
  // first timed run.
  fn();
  fn();
  let bestElapsed = Number.POSITIVE_INFINITY;
  for (let r = 0; r < RUNS_PER_CASE; r++) {
    const start = Bun.nanoseconds();
    fn();
    const elapsed = Bun.nanoseconds() - start;
    if (elapsed < bestElapsed) bestElapsed = elapsed;
  }
  const nsPerCall = bestElapsed / calls;
  if (JSON_MODE) {
    const record: BenchCase = {
      name: label,
      ns_per_call: nsPerCall,
      calls,
      ts: new Date().toISOString(),
    };
    console.log(JSON.stringify(record));
  } else {
    console.log(`${label.padEnd(48)} ${nsPerCall.toFixed(2)} ns/call  (${(bestElapsed / 1e6).toFixed(2)} ms for ${calls}, best of ${RUNS_PER_CASE})`);
  }
}

const cells = makeCells(N);

time('srgbByteToOklab', N, () => {
  for (let i = 0; i < N; i++) {
    const o = i * 3;
    srgbByteToOklab(cells[o]!, cells[o + 1]!, cells[o + 2]!);
  }
});

time('oklabToSrgbByte', N, () => {
  for (let i = 0; i < N; i++) {
    const L = (i % 100) / 100;
    const a = ((i * 7) % 40 - 20) / 100;
    const b = ((i * 11) % 40 - 20) / 100;
    oklabToSrgbByte(L, a, b);
  }
});

time('pushLightness (strength=50 bias=0)', N, () => {
  for (let i = 0; i < N; i++) {
    const o = i * 3;
    pushLightness(cells[o]!, cells[o + 1]!, cells[o + 2]!, 50, 0, 0.3);
  }
});

time('pushLightness (identity)', N, () => {
  for (let i = 0; i < N; i++) {
    const o = i * 3;
    pushLightness(cells[o]!, cells[o + 1]!, cells[o + 2]!, 0, 0, 0.3);
  }
});

time('adjustSaturation (pct=50)', N, () => {
  for (let i = 0; i < N; i++) {
    const o = i * 3;
    adjustSaturation(cells[o]!, cells[o + 1]!, cells[o + 2]!, 50);
  }
});

time('adjustSaturation (identity)', N, () => {
  for (let i = 0; i < N; i++) {
    const o = i * 3;
    adjustSaturation(cells[o]!, cells[o + 1]!, cells[o + 2]!, 0);
  }
});

// Per-cell hot-path bench. `withBlendedEffectiveBackground` is the
// function actually invoked from `_patchWebglExplicitBackgroundOpacity`
// (`src/client/adapters/xterm.ts:_patchWebglExplicitBackgroundOpacity`)
// on every rendered cell. As of cluster 10-bench-baseline-and-hot-path
// F1/F2, the adapter hoists the `theme` / `state` snapshots out of
// the per-cell path and caches them at adapter level — so the bench
// cases below allocate the bags ONCE outside the loop to mirror the
// real cost shape. (The pre-hoist baseline at commit 4ea6999 allocated
// fresh bags per call, which produced ~1280 ns/call active. After the
// hoist the active path is dominated by the cell-math itself, not the
// snapshot allocation.)
function buildTheme(): XtermCellTheme {
  return {
    bgDefaultRgba: 0x202020ff,
    fgDefaultRgba: 0xd0d0d0ff,
    ansi: undefined,
  };
}
function buildState(): XtermCellState {
  return {
    tuiFgAlpha: 0.85,
    tuiBgAlpha: 0.7,
    fgContrastStrength: 30,
    fgContrastBias: 5,
    bgOklabL: 0.25,
    tuiSaturation: 20,
  };
}

// Mix of attribute words: roughly half plain RGB cells, a quarter
// inverse cells, a quarter default-bg/fg cells. The shape mirrors the
// distribution xterm hands the patcher in normal terminal use.
const fgAttrs = new Int32Array(N);
const bgAttrs = new Int32Array(N);
{
  let s = 0xc0ffee01 >>> 0;
  for (let i = 0; i < N; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const bucket = s & 3;
    const rgb = s & 0xffffff;
    if (bucket === 0) {
      fgAttrs[i] = 0;
      bgAttrs[i] = 0;
    } else if (bucket === 1) {
      fgAttrs[i] = XTERM_FG_FLAG_INVERSE | XTERM_COLOR_MODE_RGB | rgb;
      bgAttrs[i] = 0;
    } else {
      fgAttrs[i] = XTERM_COLOR_MODE_RGB | (rgb ^ 0x55aa55);
      bgAttrs[i] = XTERM_COLOR_MODE_RGB | rgb;
    }
  }
}

time('withBlendedEffectiveBackground (identity state)', N, () => {
  // Identity: tuiBgAlpha=1, tuiFgAlpha=1, contrast=0, sat=0 — every
  // transform short-circuits. Theme/state hoisted out of the loop to
  // mirror the adapter's cached-snapshot per-cell call shape (cluster
  // 10 F1/F2). Measures the cell-math branch overhead with no
  // transforms running.
  const theme: XtermCellTheme = {
    bgDefaultRgba: 0x202020ff,
    fgDefaultRgba: 0xd0d0d0ff,
    ansi: undefined,
  };
  const state: XtermCellState = {
    tuiFgAlpha: 1,
    tuiBgAlpha: 1,
    fgContrastStrength: 0,
    fgContrastBias: 0,
    bgOklabL: 0.25,
    tuiSaturation: 0,
  };
  for (let i = 0; i < N; i++) {
    withBlendedEffectiveBackground(fgAttrs[i]!, bgAttrs[i]!, theme, state);
  }
});

time('withBlendedEffectiveBackground (active state)', N, () => {
  // Realistic active sliders: every transform runs, both alpha lerps
  // and contrast/saturation paths are exercised. Theme/state hoisted
  // out of the loop to mirror the adapter's cached-snapshot per-cell
  // call shape (cluster 10 F1/F2). Mirrors the cost during a "drag
  // the slider" frame after the F1/F2 fix.
  const theme = buildTheme();
  const state = buildState();
  for (let i = 0; i < N; i++) {
    withBlendedEffectiveBackground(fgAttrs[i]!, bgAttrs[i]!, theme, state);
  }
});
