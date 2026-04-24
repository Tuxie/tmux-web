import { describe, expect, test } from 'bun:test';
import { withClientAuth } from '../../../src/client/auth-url.ts';

describe('withClientAuth', () => {
  const loc = {
    href: 'http://127.0.0.1:4022/main',
    origin: 'http://127.0.0.1:4022',
  } as Location;

  test('adds the desktop client auth token to same-origin relative URLs', () => {
    expect(withClientAuth('/themes/default/default.css', 'token', loc)).toBe(
      '/themes/default/default.css?tw_auth=token',
    );
  });

  test('preserves existing query parameters', () => {
    expect(withClientAuth('/api/themes?x=1', 'token', loc)).toBe('/api/themes?x=1&tw_auth=token');
  });

  test('does not alter cross-origin URLs', () => {
    expect(withClientAuth('https://example.com/theme.css', 'token', loc)).toBe(
      'https://example.com/theme.css',
    );
  });

  test('returns unchanged URL when no token exists', () => {
    expect(withClientAuth('/themes/default/default.css', undefined, loc)).toBe(
      '/themes/default/default.css',
    );
  });
});
