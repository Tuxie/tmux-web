import { describe, expect, test } from 'bun:test';
import { resolveListenPort } from '../../../src/server/listen-port.js';

describe('resolveListenPort', () => {
  test('returns fixed ports unchanged', async () => {
    expect(await resolveListenPort('127.0.0.1', 4022)).toBe(4022);
  });

  test('resolves port 0 to a concrete loopback port', async () => {
    const port = await resolveListenPort('127.0.0.1', 0);
    expect(port).toBeGreaterThan(0);
  });
});
