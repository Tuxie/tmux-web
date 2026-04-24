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
