import { describe, it, expect } from 'bun:test';
import { decodeClipboardBase64, handleClipboard } from '../../../../src/client/ui/clipboard.js';

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
    (globalThis as any).navigator = {
      clipboard: { writeText: async () => { throw new Error('denied'); } },
    };
    handleClipboard(btoa('x'));
    await new Promise((r) => setTimeout(r, 0));
    // No throw = pass
    expect(true).toBe(true);
  });

  it('swallows invalid base64', () => {
    (globalThis as any).navigator = {
      clipboard: { writeText: async () => {} },
    };
    // atob with invalid chars throws
    expect(() => handleClipboard('!!!not-base64!!!')).not.toThrow();
  });
});