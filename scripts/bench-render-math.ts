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
 */

import { pushLightness } from '../src/client/fg-contrast.ts';
import { adjustSaturation } from '../src/client/tui-saturation.ts';
import { srgbByteToOklab, oklabToSrgbByte } from '../src/client/oklab.ts';

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

function time(label: string, fn: () => void): void {
  // Warm-up pass so the JIT has specialised the closure.
  fn();
  const start = Bun.nanoseconds();
  fn();
  const elapsed = Bun.nanoseconds() - start;
  const nsPerCall = elapsed / N;
  console.log(`${label.padEnd(32)} ${nsPerCall.toFixed(2)} ns/call  (${(elapsed / 1e6).toFixed(2)} ms for ${N})`);
}

const cells = makeCells(N);

time('srgbByteToOklab', () => {
  for (let i = 0; i < N; i++) {
    const o = i * 3;
    srgbByteToOklab(cells[o]!, cells[o + 1]!, cells[o + 2]!);
  }
});

time('oklabToSrgbByte', () => {
  for (let i = 0; i < N; i++) {
    const L = (i % 100) / 100;
    const a = ((i * 7) % 40 - 20) / 100;
    const b = ((i * 11) % 40 - 20) / 100;
    oklabToSrgbByte(L, a, b);
  }
});

time('pushLightness (strength=50 bias=0)', () => {
  for (let i = 0; i < N; i++) {
    const o = i * 3;
    pushLightness(cells[o]!, cells[o + 1]!, cells[o + 2]!, 50, 0, 0.3);
  }
});

time('pushLightness (identity)', () => {
  for (let i = 0; i < N; i++) {
    const o = i * 3;
    pushLightness(cells[o]!, cells[o + 1]!, cells[o + 2]!, 0, 0, 0.3);
  }
});

time('adjustSaturation (pct=50)', () => {
  for (let i = 0; i < N; i++) {
    const o = i * 3;
    adjustSaturation(cells[o]!, cells[o + 1]!, cells[o + 2]!, 50);
  }
});

time('adjustSaturation (identity)', () => {
  for (let i = 0; i < N; i++) {
    const o = i * 3;
    adjustSaturation(cells[o]!, cells[o + 1]!, cells[o + 2]!, 0);
  }
});
