import { describe, expect, test } from 'bun:test';
import {
  buildRemoteWsParams,
  isValidRemoteHostAlias,
  parseRemotePath,
} from '../../../src/server/remote-route.js';

describe('remote route parsing', () => {
  test('recognises /r/<host>/<session>', () => {
    expect(parseRemotePath('/r/prod/main')).toEqual({ host: 'prod', session: 'main' });
    expect(parseRemotePath('/r/laptop/dev%20work')).toEqual({ host: 'laptop', session: 'dev%20work' });
  });

  test('rejects non-remote paths', () => {
    expect(parseRemotePath('/main')).toBeNull();
    expect(parseRemotePath('/ws')).toBeNull();
  });

  test('host aliases are conservative and slash-free', () => {
    expect(isValidRemoteHostAlias('prod')).toBe(true);
    expect(isValidRemoteHostAlias('prod.example.com')).toBe(true);
    expect(isValidRemoteHostAlias('-Jbastion')).toBe(false);
    expect(isValidRemoteHostAlias('user@host')).toBe(false);
    expect(isValidRemoteHostAlias('../host')).toBe(false);
    expect(isValidRemoteHostAlias('host;rm')).toBe(false);
  });

  test('rejects option-looking, dot-only, and overlong host aliases', () => {
    expect(parseRemotePath('/r/-Jbastion/main')).toBeNull();
    expect(isValidRemoteHostAlias('.')).toBe(false);
    expect(isValidRemoteHostAlias('..')).toBe(false);
    expect(isValidRemoteHostAlias('a'.repeat(256))).toBe(false);
  });

  test('buildRemoteWsParams preserves host and sanitized session intent', () => {
    expect(buildRemoteWsParams('/r/prod/main')).toEqual({ remoteHost: 'prod', session: 'main' });
  });
});
