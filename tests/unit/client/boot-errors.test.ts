import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

const origWarn = console.warn;
afterEach(() => { console.warn = origWarn; });

async function freshModule() {
  return await import('../../../src/client/boot-errors.ts');
}

describe('boot-errors', () => {
  let warnings: unknown[][];
  beforeEach(() => {
    warnings = [];
    console.warn = (...args: unknown[]) => { warnings.push(args); };
  });

  it('records a label and writes a console.warn with the detail', async () => {
    const { recordBootError, consumeBootErrorDetails, consumeBootErrors } = await freshModule();
    // Drain any labels left by prior test runs (Bun ESM cache shares state).
    consumeBootErrors();
    consumeBootErrorDetails();
    recordBootError('themes', 'HTTP 500');
    const errs = consumeBootErrors();
    expect(errs).toEqual(['themes']);
    expect(warnings.some(w => w.includes('themes'))).toBe(true);
  });

  it('records details for server-side boot diagnostics', async () => {
    const { recordBootError, consumeBootErrorDetails, consumeBootErrors } = await freshModule();
    consumeBootErrors();
    consumeBootErrorDetails();

    recordBootError('settings', new Error('fetch failed'));
    recordBootError('themes', 'HTTP 500');
    recordBootError('colours');

    expect(consumeBootErrorDetails()).toEqual([
      'settings: fetch failed',
      'themes: HTTP 500',
      'colours',
    ]);
    expect(consumeBootErrorDetails()).toEqual([]);
  });

  it('omits the detail argument when none is supplied', async () => {
    const { recordBootError, consumeBootErrorDetails, consumeBootErrors } = await freshModule();
    consumeBootErrors();
    consumeBootErrorDetails();
    recordBootError('colours');
    consumeBootErrors();
    consumeBootErrorDetails();
    // Should still have warned; detail arg is optional.
    expect(warnings.some(w => w.includes('colours'))).toBe(true);
  });

  it('consumeBootErrors clears the buffer', async () => {
    const { recordBootError, consumeBootErrorDetails, consumeBootErrors } = await freshModule();
    consumeBootErrors();
    consumeBootErrorDetails();
    recordBootError('a');
    recordBootError('b');
    expect(consumeBootErrors()).toEqual(['a', 'b']);
    expect(consumeBootErrors()).toEqual([]);
  });
});

// Cluster 13 / F3: the boot-error toast must include a truncated
// detail snippet so end-users without devtools can guess the failure
// mode. The formatting is in a pure helper so it's testable in
// isolation from main()'s boot pipeline.
describe('formatBootErrorToast', () => {
  it('returns the base message verbatim when no detail is provided', async () => {
    const { formatBootErrorToast } = await freshModule();
    const text = formatBootErrorToast(['themes'], undefined);
    expect(text).toBe(
      'Failed to load some UI data (themes) — settings menu may be incomplete.',
    );
  });

  it('appends the detail when present and short', async () => {
    const { formatBootErrorToast } = await freshModule();
    const text = formatBootErrorToast(['themes'], 'themes: HTTP 500');
    expect(text).toBe(
      'Failed to load some UI data (themes) — settings menu may be incomplete.: themes: HTTP 500',
    );
  });

  it('truncates a detail longer than 60 chars with an ellipsis', async () => {
    const { formatBootErrorToast } = await freshModule();
    const long = 'themes: '
      + 'this is a really long error message that exceeds the cap and should be truncated';
    const text = formatBootErrorToast(['themes'], long);
    // Last 61 chars are the truncated detail (60 + ellipsis).
    expect(text.endsWith('…')).toBe(true);
    expect(text.endsWith(long.slice(0, 60) + '…')).toBe(true);
    // Short detail should not be truncated.
    const short = 'themes: short';
    const noTrunc = formatBootErrorToast(['themes'], short);
    expect(noTrunc.endsWith(short)).toBe(true);
    expect(noTrunc.endsWith('…')).toBe(false);
  });

  it('joins multiple labels with comma in the base message', async () => {
    const { formatBootErrorToast } = await freshModule();
    const text = formatBootErrorToast(['themes', 'fonts'], 'themes: failed');
    expect(text).toContain('(themes, fonts)');
  });

  it('treats an empty-string detail as no detail', async () => {
    const { formatBootErrorToast } = await freshModule();
    const text = formatBootErrorToast(['themes'], '');
    expect(text).toBe(
      'Failed to load some UI data (themes) — settings menu may be incomplete.',
    );
  });
});
