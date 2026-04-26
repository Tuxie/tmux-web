import { describe, it, expect } from 'bun:test';
import { extractTTMessages } from '../../../src/client/protocol.js';

describe('extractTTMessages', () => {
  it('returns data unchanged when no TT messages present', () => {
    const result = extractTTMessages('hello world');
    expect(result.terminalData).toBe('hello world');
    expect(result.messages).toEqual([]);
  });

  it('extracts a single TT message from start of data', () => {
    const json = JSON.stringify({ session: 'dev', windows: [] });
    const data = '\x00TT:' + json;
    const result = extractTTMessages(data);
    expect(result.terminalData).toBe('');
    expect(result.messages).toEqual([{ session: 'dev', windows: [] }]);
  });

  it('extracts TT message and passes through remaining terminal data', () => {
    const json = JSON.stringify({ clipboard: 'SGVsbG8=' });
    const data = '\x00TT:' + json + 'terminal output here';
    const result = extractTTMessages(data);
    expect(result.terminalData).toBe('terminal output here');
    expect(result.messages).toEqual([{ clipboard: 'SGVsbG8=' }]);
  });

  it('handles data that starts with terminal output before TT message', () => {
    const data = 'some output\x00TT:{"session":"main"}more';
    const result = extractTTMessages(data);
    expect(result.terminalData).toBe('some outputmore');
    expect(result.messages).toEqual([{ session: 'main' }]);
  });

  it('handles empty data', () => {
    const result = extractTTMessages('');
    expect(result.terminalData).toBe('');
    expect(result.messages).toEqual([]);
  });

  it('handles malformed JSON after TT prefix gracefully', () => {
    const data = '\x00TT:{bad jsonrest of data';
    const result = extractTTMessages(data);
    // Malformed JSON falls into the prefix re-emit path: the parser
    // re-emits the four-byte `\x00TT:` prefix into the terminal stream
    // and resumes past it, so the entire input surfaces verbatim and
    // no messages are extracted.
    expect(result.terminalData).toBe(data);
    expect(result.messages).toEqual([]);
  });

  describe('input bounds', () => {
    /** Stub `console.warn` for the duration of `fn` so the test
     *  doesn't pollute test-runner output and we can assert on the
     *  abort path. Returns the captured messages. */
    function captureWarns<T>(fn: () => T): { result: T; warns: string[] } {
      const warns: string[] = [];
      const orig = console.warn;
      console.warn = (...args: unknown[]) => {
        warns.push(args.map(String).join(' '));
      };
      try {
        const result = fn();
        return { result, warns };
      } finally {
        console.warn = orig;
      }
    }

    it('aborts and warns when JSON depth exceeds the bound', () => {
      // 65 nested opens — one past the 64-deep cap — followed by
      // matching closes. We expect the parser to bail before the
      // closing braces balance, fall through to the malformed-prefix
      // re-emit, and emit a console.warn about the depth bound.
      const deep = '{'.repeat(65) + '"x":1' + '}'.repeat(65);
      const data = '\x00TT:' + deep + 'tail';
      const { result, warns } = captureWarns(() => extractTTMessages(data));
      // Re-emit the four-byte prefix and resume past it; nothing should
      // be parsed as a message.
      expect(result.messages).toEqual([]);
      // The prefix appears in the terminal stream — including the rest
      // of the would-be JSON characters that follow the prefix advance.
      expect(result.terminalData).toContain('\x00TT:');
      expect(warns.some((w) => w.includes('TT message exceeded depth bound'))).toBe(true);
    });

    it('parses normal-depth nested JSON without aborting', () => {
      // 32 deep is comfortably under the 64 cap.
      const deep = '{"a":'.repeat(32) + '1' + '}'.repeat(32);
      const data = '\x00TT:' + deep;
      const { result, warns } = captureWarns(() => extractTTMessages(data));
      expect(result.messages).toHaveLength(1);
      expect(warns).toEqual([]);
    });

    it('aborts and warns when JSON length exceeds the bound', () => {
      // Build a payload that opens a brace then dumps >1 MiB of
      // string content without ever closing — the length guard must
      // trip before the parser walks to end-of-input.
      const big = '{"k":"' + 'x'.repeat(1024 * 1024 + 16);
      const data = '\x00TT:' + big;
      const { result, warns } = captureWarns(() => extractTTMessages(data));
      expect(result.messages).toEqual([]);
      expect(result.terminalData).toContain('\x00TT:');
      expect(warns.some((w) => w.includes('TT message exceeded length bound'))).toBe(true);
    });
  });
});
