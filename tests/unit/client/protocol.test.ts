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
    expect(result.terminalData).toBeDefined();
  });
});
