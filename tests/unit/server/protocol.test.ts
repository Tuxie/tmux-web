import { describe, it, expect } from 'bun:test';
import { processData, frameTTMessage } from '../../../src/server/protocol.js';

describe('processData', () => {
  it('passes through plain text unchanged', () => {
    const result = processData('hello world', 'main');
    expect(result.output).toBe('hello world');
    expect(result.messages).toEqual([]);
  });

  it('detects OSC 0 title sequence without pushing a session message', () => {
    const data = '\x1b]0;mysession:1:vim - hello\x07rest';
    const result = processData(data, 'main');
    // Session push is now %-event driven (tmux-control.ts). The OSC
    // sniff still exposes titleChanged + detectedSession so ws.ts can
    // update `title` on the connection, but messages[] no longer
    // carries a {session} entry from this path.
    expect(result.titleChanged).toBe(true);
    expect(result.detectedSession).toBe('mysession');
    expect(result.messages.filter(m => m.session !== undefined)).toEqual([]);
    expect(result.output).toContain('\x1b]0;');
  });

  it('detects OSC 2 title sequence without pushing a session message', () => {
    const data = '\x1b]2;dev:0:zsh - test\x1b\\rest';
    const result = processData(data, 'main');
    expect(result.titleChanged).toBe(true);
    expect(result.detectedSession).toBe('dev');
    expect(result.messages.filter(m => m.session !== undefined)).toEqual([]);
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
    // Session push moved off the OSC path; still only OSC 52 clipboard
    // messages are emitted from processData under the new contract.
    expect(result.messages.some(m => m.session === 'work')).toBe(false);
    expect(result.messages.some(m => m.clipboard === 'dGVzdA==')).toBe(true);
  });

  it('strips echoed xterm identity replies from PTY output', () => {
    const data = 'before\x1b[>0;276;0c middle \x1bP>|xterm.js(6.0.0)\x1b\\ echoctl ^[[>0;276;0c ^[P>|xterm.js(6.0.0)^[\\after';
    const result = processData(data, 'main');
    expect(result.output).toBe('before middle  echoctl  after');
    expect(result.messages).toEqual([]);
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

  it('captures the full unicode pane title in detectedTitle (no `_` substitution)', () => {
    // tmux's set-titles emits `#S:#W` by default, so the OSC payload has
    // shape `<session>:<window_name>` — and window_name carries whatever
    // characters the shell / running program set, including unicode like
    // U+2733 ✳ ("EIGHT SPOKED ASTERISK").
    const title = 'main:\u2733 Compact lessons learned documentation';
    const data = `\x1b]2;${title}\x07`;
    const result = processData(data, 'main');
    expect(result.titleChanged).toBe(true);
    expect(result.detectedTitle).toBe(title);
  });

  it('captures multibyte UTF-8 pane title via OSC 0', () => {
    const title = '\u25C7  Ready (Fotona) \u2728';
    const data = `\x1b]0;${title}\x07`;
    const result = processData(data, 'main');
    expect(result.titleChanged).toBe(true);
    expect(result.detectedTitle).toBe(title);
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
