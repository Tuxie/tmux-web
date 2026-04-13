import { describe, it, expect } from 'vitest';
import { decodeClipboardBase64 } from '../../../../src/client/ui/clipboard.js';

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