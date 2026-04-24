import { describe, expect, test } from 'bun:test';
import {
  buildAuthenticatedUrl,
  generateDesktopCredentials,
} from '../../../src/desktop/auth.js';

describe('desktop auth helpers', () => {
  test('generateDesktopCredentials returns stable prefixes and long random secrets', () => {
    const first = generateDesktopCredentials();
    const second = generateDesktopCredentials();

    expect(first.username.startsWith('tmux-term-')).toBe(true);
    expect(second.username.startsWith('tmux-term-')).toBe(true);
    expect(first.password.length).toBeGreaterThanOrEqual(43);
    expect(second.password.length).toBeGreaterThanOrEqual(43);
    expect(first.clientToken.length).toBeGreaterThanOrEqual(43);
    expect(second.clientToken.length).toBeGreaterThanOrEqual(43);
    expect(first.username).not.toBe(second.username);
    expect(first.password).not.toBe(second.password);
    expect(first.clientToken).not.toBe(second.clientToken);
    expect(first.password).not.toContain(':');
    expect(first.username).not.toContain(':');
  });

  test('generateDesktopCredentials accepts deterministic bytes for tests', () => {
    const creds = generateDesktopCredentials({
      randomBytes: (size) => Buffer.alloc(size, 0xab),
    });

    expect(creds.username).toBe('tmux-term-q6urq6urq6s');
    expect(creds.password).toBe('q6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6s');
    expect(creds.clientToken).toBe('q6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6s');
  });

  test('buildAuthenticatedUrl encodes credentials and uses loopback http', () => {
    const url = buildAuthenticatedUrl({
      host: '127.0.0.1',
      port: 41234,
      credentials: {
        username: 'tmux-term-user',
        password: 'p@ss/w:rd',
        clientToken: 'client-token',
      },
    });

    expect(url).toBe('http://tmux-term-user:p%40ss%2Fw%3Ard@127.0.0.1:41234/');
  });

  test('buildAuthenticatedUrl brackets IPv6 literal hosts', () => {
    const url = buildAuthenticatedUrl({
      host: '::1',
      port: 41234,
      credentials: {
        username: 'tmux-term-user',
        password: 'secret',
        clientToken: 'client-token',
      },
    });

    expect(url).toBe('http://tmux-term-user:secret@[::1]:41234/');
  });
});
