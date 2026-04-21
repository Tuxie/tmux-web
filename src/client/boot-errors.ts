/**
 * Accumulates user-facing error labels from boot-time fetches
 * (`/api/session-settings`, `/api/colours`, `/api/themes`) so `main()`
 * can surface a single combined toast once all three have settled —
 * instead of three independent toasts or a silent fallback.
 *
 * Each callsite also logs its own `console.warn(…)` so the devtools
 * record is preserved even if the user dismisses the toast.
 */

const errors: string[] = [];

/** Record a boot-time failure under a short label (e.g. 'themes').
 *  The optional `detail` is only used for the console.warn — the
 *  toast path reads the label list via `consumeBootErrors()`. */
export function recordBootError(label: string, detail?: unknown): void {
  errors.push(label);
  if (detail !== undefined) console.warn('boot fetch failed:', label, detail);
  else console.warn('boot fetch failed:', label);
}

/** Read the accumulated labels and clear the buffer. Intended for a
 *  single read at the end of `main()`'s boot sequence. */
export function consumeBootErrors(): string[] {
  const out = errors.slice();
  errors.length = 0;
  return out;
}
