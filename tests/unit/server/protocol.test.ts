import { describe, it, expect } from 'vitest';
import { processData, frameTTMessage } from '../../../src/server/protocol.js';

describe('processData', () => {
  it('passes through plain text unchanged', () => {
    const result = processData('hello world', 'main');
    expect(result.output).toBe('hello world');
    expect(result.messages).toEqual([]);
  });

  it('detects OSC 0 title sequence (BEL terminated)', () => {
    const data = '\x1b]0;mysession:1:vim - hello\x07rest';
    const result = processData(data, 'main');
    expect(result.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ session: 'mysession' }),
      ])
    );
    expect(result.output).toContain('\x1b]0;');
  });

  it('detects OSC 2 title sequence (ST terminated)', () => {
    const data = '\x1b]2;dev:0:zsh - test\x1b\\rest';
    const result = processData(data, 'main');
    expect(result.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ session: 'dev' }),
      ])
    );
  });

  it('detects OSC 52 clipboard and strips from output', () => {
    const data = 'before\x1b]52;c;SGVsbG8=\x07after';
    const result = processData(data, 'main');
    expect(result.output).toBe('beforeafter');
    expect(result.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ clipboard: 'SGVsbG8=' }),
      ])
    );
  });

  it('handles OSC 52 with ST terminator', () => {
    const data = '\x1b]52;c;d29ybGQ=\x1b\\';
    const result = processData(data, 'main');
    expect(result.output).toBe('');
    expect(result.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ clipboard: 'd29ybGQ=' }),
      ])
    );
  });

  it('ignores OSC 52 query (payload is "?")', () => {
    const data = '\x1b]52;c;?\x07';
    const result = processData(data, 'main');
    expect(result.messages.filter(m => m.clipboard)).toEqual([]);
  });

  it('handles mixed OSC title + OSC 52 in same data', () => {
    const data = '\x1b]0;work:0:zsh\x07some output\x1b]52;c;dGVzdA==\x07more';
    const result = processData(data, 'main');
    expect(result.output).toBe('\x1b]0;work:0:zsh\x07some outputmore');
    expect(result.messages.some(m => m.session === 'work')).toBe(true);
    expect(result.messages.some(m => m.clipboard === 'dGVzdA==')).toBe(true);
  });

  it('returns empty messages for data with no OSC sequences', () => {
    const result = processData('ls -la\r\nfoo bar\r\n', 'main');
    expect(result.messages).toEqual([]);
    expect(result.output).toBe('ls -la\r\nfoo bar\r\n');
  });

  it('detects title change via titleChanged flag', () => {
    const data = '\x1b]0;main:1:vim\x07';
    const result = processData(data, 'main');
    expect(result.titleChanged).toBe(true);
    expect(result.detectedSession).toBe('main');
  });

  it('handles empty data', () => {
    const result = processData('', 'main');
    expect(result.output).toBe('');
    expect(result.messages).toEqual([]);
  });

  it('preserves base64 of UTF-8 clipboard content (Unicode)', () => {
    const text = '⎿ → ←';
    const b64 = btoa(String.fromCodePoint(...new TextEncoder().encode(text)));
    const data = `\x1b]52;c;${b64}\x07`;
    const result = processData(data, 'main');
    expect(result.output).toBe('');
    expect(result.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ clipboard: b64 }),
      ])
    );
  });
});

describe('frameTTMessage', () => {
  it('frames a message with TT prefix', () => {
    const msg = { session: 'dev', windows: [{ index: '0', name: 'zsh', active: true }] };
    const framed = frameTTMessage(msg);
    expect(framed).toBe('\x00TT:' + JSON.stringify(msg));
  });

  it('frames clipboard message', () => {
    const msg = { clipboard: 'SGVsbG8=' };
    expect(frameTTMessage(msg)).toBe('\x00TT:{"clipboard":"SGVsbG8="}');
  });
});
