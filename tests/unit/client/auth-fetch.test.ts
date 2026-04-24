import { describe, expect, test } from 'bun:test';
import { makeAuthenticatedFetch } from '../../../src/client/auth-fetch.ts';

function decodeAuth(header: string | null): string {
  expect(header).toStartWith('Basic ');
  return Buffer.from(header!.slice('Basic '.length), 'base64').toString('utf8');
}

describe('makeAuthenticatedFetch', () => {
  test('adds Basic Auth to same-origin relative requests', async () => {
    let seenUrl = '';
    let seenHeaders: Headers | null = null;
    const fetch = makeAuthenticatedFetch(
      ((url, init) => {
        seenUrl = String(url);
        seenHeaders = new Headers(init?.headers);
        return Promise.resolve(new Response('ok'));
      }) as typeof globalThis.fetch,
      'tmux-term-user:p%40ss%2Fw%3Ard',
      { href: 'http://127.0.0.1:4022/', origin: 'http://127.0.0.1:4022' },
      'client-token',
    );

    await fetch('/api/themes');

    expect(seenUrl).toBe('/api/themes?tw_auth=client-token');
    expect(decodeAuth(seenHeaders!.get('Authorization'))).toBe('tmux-term-user:p@ss/w:rd');
  });

  test('does not add Basic Auth to cross-origin requests', async () => {
    let seenUrl = '';
    let seenHeaders: Headers | null = null;
    const fetch = makeAuthenticatedFetch(
      ((url, init) => {
        seenUrl = String(url);
        seenHeaders = new Headers(init?.headers);
        return Promise.resolve(new Response('ok'));
      }) as typeof globalThis.fetch,
      'tmux-term-user:secret',
      { href: 'http://127.0.0.1:4022/', origin: 'http://127.0.0.1:4022' },
      'client-token',
    );

    await fetch('https://example.com/api/themes');

    expect(seenUrl).toBe('https://example.com/api/themes');
    expect(seenHeaders!.has('Authorization')).toBe(false);
  });

  test('preserves an explicit Authorization header', async () => {
    let seenHeaders: Headers | null = null;
    const fetch = makeAuthenticatedFetch(
      ((_, init) => {
        seenHeaders = new Headers(init?.headers);
        return Promise.resolve(new Response('ok'));
      }) as typeof globalThis.fetch,
      'tmux-term-user:secret',
      { href: 'http://127.0.0.1:4022/', origin: 'http://127.0.0.1:4022' },
    );

    await fetch('/api/themes', { headers: { Authorization: 'Bearer token' } });

    expect(seenHeaders!.get('Authorization')).toBe('Bearer token');
  });

  test('can authorize same-origin fetches with only the desktop client token', async () => {
    let seenUrl = '';
    let seenHeaders: Headers | null = null;
    const fetch = makeAuthenticatedFetch(
      ((url, init) => {
        seenUrl = String(url);
        seenHeaders = new Headers(init?.headers);
        return Promise.resolve(new Response('ok'));
      }) as typeof globalThis.fetch,
      undefined,
      { href: 'http://127.0.0.1:4022/', origin: 'http://127.0.0.1:4022' },
      'client-token',
    );

    await fetch('/api/session-settings');

    expect(seenUrl).toBe('/api/session-settings?tw_auth=client-token');
    expect(seenHeaders!.has('Authorization')).toBe(false);
  });

  test('does not throw in webviews without a global Request constructor', async () => {
    const originalRequest = globalThis.Request;
    try {
      (globalThis as any).Request = undefined;
      let seenUrl = '';
      const fetch = makeAuthenticatedFetch(
        ((url) => {
          seenUrl = String(url);
          return Promise.resolve(new Response('ok'));
        }) as typeof globalThis.fetch,
        undefined,
        { href: 'http://127.0.0.1:4022/', origin: 'http://127.0.0.1:4022' },
        'client-token',
      );

      await fetch('/api/themes');

      expect(seenUrl).toBe('/api/themes?tw_auth=client-token');
    } finally {
      globalThis.Request = originalRequest;
    }
  });
});
