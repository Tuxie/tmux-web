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
const details: string[] = [];

function formatDetail(detail: unknown): string {
  if (detail instanceof Error) return detail.message;
  if (detail === undefined) return '';
  return String(detail);
}

/** Record a boot-time failure under a short label (e.g. 'themes').
 *  The optional `detail` is used for console.warn and server-side
 *  debug logging via `consumeBootErrorDetails()`. */
export function recordBootError(label: string, detail?: unknown): void {
  errors.push(label);
  details.push(detail === undefined ? label : `${label}: ${formatDetail(detail)}`);
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

/** Read full boot error details and clear that buffer. Intended to
 *  pair with `consumeBootErrors()` at the end of boot. */
export function consumeBootErrorDetails(): string[] {
  const out = details.slice();
  details.length = 0;
  return out;
}

/** Format the boot-error toast text. Pure helper so the truncation
 *  rule (cluster 13 / F3) is unit-testable independently of `main()`.
 *  - `labels` is the deduplicated label set (e.g. ['themes', 'fonts']).
 *  - `firstDetail` is the first entry from `consumeBootErrorDetails()`,
 *    used to give the user a hint at the actual failure mode without
 *    devtools open. Truncated to ~60 chars with an ellipsis. */
export function formatBootErrorToast(
  labels: string[],
  firstDetail: string | undefined,
): string {
  const baseMsg = 'Failed to load some UI data ('
    + labels.join(', ') + ') — settings menu may be incomplete.';
  if (!firstDetail) return baseMsg;
  const truncated = firstDetail.length > 60
    ? firstDetail.slice(0, 60) + '…'
    : firstDetail;
  return `${baseMsg}: ${truncated}`;
}
