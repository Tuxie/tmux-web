import { describe, it, expect } from 'bun:test';
import { decodeClipboardBase64, handleClipboard } from '../../../../src/client/ui/clipboard.js';
import { consoleCaptured } from '../../_setup/silence-console.ts';

describe('decodeClipboardBase64', () => {
  it('decodes ASCII text', () => {
    expect(decodeClipboardBase64(btoa('hello'))).toBe('hello');
  });

  it('decodes UTF-8 Unicode correctly', () => {
    const text = '⎿ → ← ↑ ↓';
    const encoded = btoa(String.fromCodePoint(...new TextEncoder().encode(text)));
    expect(decodeClipboardBase64(encoded)).toBe(text);
  });

  it('decodes emoji correctly', () => {
    const text = '🎉 äöü ñ';
    const encoded = btoa(String.fromCodePoint(...new TextEncoder().encode(text)));
    expect(decodeClipboardBase64(encoded)).toBe(text);
  });

  it('decodes the box-drawing character ⎿ (U+23BF)', () => {
    const text = '⎿';
    const encoded = btoa(String.fromCodePoint(...new TextEncoder().encode(text)));
    expect(decodeClipboardBase64(encoded)).toBe('⎿');
  });

  it('returns empty string for empty base64', () => {
    expect(decodeClipboardBase64('')).toBe('');
  });
});

describe('handleClipboard', () => {
  it('decodes and writes to navigator.clipboard', async () => {
    const writes: string[] = [];
    (globalThis as any).navigator = {
      clipboard: { writeText: async (s: string) => { writes.push(s); } },
    };
    handleClipboard(btoa('hello world'));
    // Give the microtask queue a tick (writeText is async)
    await new Promise((r) => setTimeout(r, 0));
    expect(writes).toEqual(['hello world']);
  });

  it('swallows writeText rejection', async () => {
    let writeAttempts = 0;
    (globalThis as any).navigator = {
      clipboard: {
        writeText: async () => {
          writeAttempts += 1;
          throw new Error('denied');
        },
      },
    };
    // Capture any unhandled rejection that escapes the production
    // `.catch(() => {})` swallow — if the swallow regresses, this fires.
    const unhandled: unknown[] = [];
    const onUnhandled = (e: PromiseRejectionEvent | { reason?: unknown }): void => {
      unhandled.push((e as { reason?: unknown }).reason ?? e);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      handleClipboard(btoa('x'));
      // Flush microtasks: writeText's rejection fires in the next
      // microtask, the production `.catch` runs the tick after.
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      // The rejection path was actually exercised — guards against a
      // regression that skips the writeText call entirely.
      expect(writeAttempts).toBe(1);
      // The rejection was fully swallowed: no console output, no
      // unhandled rejection on the event loop.
      expect(consoleCaptured('warn')).toEqual([]);
      expect(consoleCaptured('error')).toEqual([]);
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('swallows invalid base64', () => {
    (globalThis as any).navigator = {
      clipboard: { writeText: async () => {} },
    };
    // atob with invalid chars throws
    expect(() => handleClipboard('!!!not-base64!!!')).not.toThrow();
  });
});