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
    const { recordBootError, consumeBootErrors } = await freshModule();
    // Drain any labels left by prior test runs (Bun ESM cache shares state).
    consumeBootErrors();
    recordBootError('themes', 'HTTP 500');
    const errs = consumeBootErrors();
    expect(errs).toEqual(['themes']);
    expect(warnings.some(w => w.includes('themes'))).toBe(true);
  });

  it('omits the detail argument when none is supplied', async () => {
    const { recordBootError, consumeBootErrors } = await freshModule();
    consumeBootErrors();
    recordBootError('colours');
    consumeBootErrors();
    // Should still have warned; detail arg is optional.
    expect(warnings.some(w => w.includes('colours'))).toBe(true);
  });

  it('consumeBootErrors clears the buffer', async () => {
    const { recordBootError, consumeBootErrors } = await freshModule();
    consumeBootErrors();
    recordBootError('a');
    recordBootError('b');
    expect(consumeBootErrors()).toEqual(['a', 'b']);
    expect(consumeBootErrors()).toEqual([]);
  });
});
