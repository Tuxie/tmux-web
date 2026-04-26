import { describe, it, expect, beforeEach } from 'bun:test';
import {
  parseOriginHeader,
  parseAllowOriginFlag,
  isIpLiteral,
  isOriginAllowed,
  logOriginReject,
  canonicaliseAllowedIp,
  _resetRecentOriginRejects,
} from '../../../src/server/origin.js';

describe('parseOriginHeader', () => {
  it('parses http with explicit port', () => {
    expect(parseOriginHeader('http://example.com:8080')).toEqual({
      scheme: 'http', host: 'example.com', port: 8080,
    });
  });
  it('parses https with implicit port 443', () => {
    expect(parseOriginHeader('https://example.com')).toEqual({
      scheme: 'https', host: 'example.com', port: 443,
    });
  });
  it('parses http with implicit port 80', () => {
    expect(parseOriginHeader('http://example.com')).toEqual({
      scheme: 'http', host: 'example.com', port: 80,
    });
  });
  it('lowercases host', () => {
    expect(parseOriginHeader('https://Example.COM')).toEqual({
      scheme: 'https', host: 'example.com', port: 443,
    });
  });
  it('parses IPv4 literal', () => {
    expect(parseOriginHeader('http://127.0.0.1:4022')).toEqual({
      scheme: 'http', host: '127.0.0.1', port: 4022,
    });
  });
  it('parses bracketed IPv6 literal and strips brackets', () => {
    expect(parseOriginHeader('http://[::1]:4022')).toEqual({
      scheme: 'http', host: '::1', port: 4022,
    });
  });
  it('returns null for unsupported scheme', () => {
    expect(parseOriginHeader('ftp://example.com')).toBeNull();
  });
  it('returns null for malformed input', () => {
    expect(parseOriginHeader('not-a-url')).toBeNull();
  });
  it('returns null for "null" literal (sandboxed iframes)', () => {
    expect(parseOriginHeader('null')).toBeNull();
  });
});

describe('parseAllowOriginFlag', () => {
  it('parses a full http origin with port', () => {
    expect(parseAllowOriginFlag('http://myserver.lan:4022')).toEqual({
      scheme: 'http', host: 'myserver.lan', port: 4022,
    });
  });
  it('defaults port to 443 for https when implicit', () => {
    expect(parseAllowOriginFlag('https://tmux.example.com')).toEqual({
      scheme: 'https', host: 'tmux.example.com', port: 443,
    });
  });
  it('defaults port to 80 for http when implicit', () => {
    expect(parseAllowOriginFlag('http://example.com')).toEqual({
      scheme: 'http', host: 'example.com', port: 80,
    });
  });
  it('lowercases host and strips trailing slash', () => {
    expect(parseAllowOriginFlag('https://Example.COM/')).toEqual({
      scheme: 'https', host: 'example.com', port: 443,
    });
  });
  it('recognises the "*" wildcard', () => {
    expect(parseAllowOriginFlag('*')).toBe('*');
  });
  it('throws on malformed input', () => {
    expect(() => parseAllowOriginFlag('myserver.lan')).toThrow();
  });
  it('throws on unsupported scheme', () => {
    expect(() => parseAllowOriginFlag('ws://example.com')).toThrow();
  });
});

describe('isIpLiteral', () => {
  it('recognises IPv4', () => {
    expect(isIpLiteral('127.0.0.1')).toBe(true);
    expect(isIpLiteral('192.168.2.4')).toBe(true);
  });
  it('recognises IPv6 (colons present)', () => {
    expect(isIpLiteral('::1')).toBe(true);
    expect(isIpLiteral('fe80::1')).toBe(true);
  });
  it('rejects hostnames', () => {
    expect(isIpLiteral('myserver.lan')).toBe(false);
    expect(isIpLiteral('tmux.example.com')).toBe(false);
    expect(isIpLiteral('localhost')).toBe(false);
  });
});

describe('isOriginAllowed', () => {
  const mkCtx = (overrides: Partial<Parameters<typeof isOriginAllowed>[1]> = {}) => ({
    allowedIps: new Set(['127.0.0.1', '::1']),
    allowedOrigins: [] as ReturnType<typeof parseAllowOriginFlag>[],
    serverScheme: 'http' as const,
    serverPort: 4022,
    ...overrides,
  });
  const mkReq = (origin: string | undefined): string | undefined => origin;

  it('allows requests with no Origin header', () => {
    expect(isOriginAllowed(mkReq(undefined), mkCtx())).toBe(true);
  });
  it('allows loopback IPv4 Origin on default config', () => {
    expect(isOriginAllowed(mkReq('http://127.0.0.1:4022'), mkCtx())).toBe(true);
  });
  it('allows loopback IPv6 Origin on default config', () => {
    expect(isOriginAllowed(mkReq('http://[::1]:4022'), mkCtx())).toBe(true);
  });
  it('allows LAN IP Origin when IP is in allowedIps', () => {
    const ctx = mkCtx({ allowedIps: new Set(['127.0.0.1', '::1', '192.168.2.4']) });
    expect(isOriginAllowed(mkReq('http://192.168.2.4:4022'), ctx)).toBe(true);
  });
  it('rejects LAN IP Origin when IP is not in allowedIps', () => {
    expect(isOriginAllowed(mkReq('http://192.168.2.4:4022'), mkCtx())).toBe(false);
  });
  it('rejects IP Origin on scheme mismatch', () => {
    const ctx = mkCtx({ serverScheme: 'https' });
    expect(isOriginAllowed(mkReq('http://127.0.0.1:4022'), ctx)).toBe(false);
  });
  it('rejects IP Origin on port mismatch', () => {
    expect(isOriginAllowed(mkReq('http://127.0.0.1:9999'), mkCtx())).toBe(false);
  });
  it('rejects DNS-rebind-shape hostname (evil.com → 127.0.0.1)', () => {
    expect(isOriginAllowed(mkReq('https://evil.com'), mkCtx())).toBe(false);
  });
  it('allows hostname matching an --allow-origin entry (exact triple)', () => {
    const ctx = mkCtx({
      allowedOrigins: [parseAllowOriginFlag('https://tmux.example.com')],
    });
    expect(isOriginAllowed(mkReq('https://tmux.example.com'), ctx)).toBe(true);
  });
  it('rejects hostname on scheme mismatch with --allow-origin', () => {
    const ctx = mkCtx({
      allowedOrigins: [parseAllowOriginFlag('https://tmux.example.com')],
    });
    expect(isOriginAllowed(mkReq('http://tmux.example.com'), ctx)).toBe(false);
  });
  it('rejects hostname on port mismatch with --allow-origin', () => {
    const ctx = mkCtx({
      allowedOrigins: [parseAllowOriginFlag('https://tmux.example.com:4443')],
    });
    expect(isOriginAllowed(mkReq('https://tmux.example.com'), ctx)).toBe(false);
  });
  it('matches hostname case-insensitively', () => {
    const ctx = mkCtx({
      allowedOrigins: [parseAllowOriginFlag('https://tmux.example.com')],
    });
    expect(isOriginAllowed(mkReq('https://Tmux.Example.COM'), ctx)).toBe(true);
  });
  it('allows any origin when "*" is present', () => {
    const ctx = mkCtx({ allowedOrigins: ['*'] });
    expect(isOriginAllowed(mkReq('https://evil.com'), ctx)).toBe(true);
  });
  it('rejects malformed Origin header', () => {
    expect(isOriginAllowed(mkReq('not-a-url'), mkCtx())).toBe(false);
  });
  it('rejects Origin: null (sandboxed iframe)', () => {
    expect(isOriginAllowed(mkReq('null'), mkCtx())).toBe(false);
  });
  it('treats ::ffff:-mapped IPv4 Origin as its unmapped form', () => {
    const ctx = mkCtx({ allowedIps: new Set(['127.0.0.1', '::1']) });
    expect(isOriginAllowed(mkReq('http://[::ffff:127.0.0.1]:4022'), ctx)).toBe(true);
  });
  it('rejects ::ffff: address with unrecognised suffix (fallback branch)', () => {
    // Three hex groups after ::ffff: — neither dotted-decimal nor the
    // two-hex-group form parseable as IPv4-mapped. Hits the final
    // "return ip" fallback in normaliseIpV4Mapped.
    const ctx = mkCtx({ allowedIps: new Set(['127.0.0.1', '::1']) });
    expect(isOriginAllowed(mkReq('http://[::ffff:1:2:3]:4022'), ctx)).toBe(false);
  });
});

describe('canonicaliseAllowedIp (F4 — IPv6 allowlist canonicalisation)', () => {
  // Cluster 04, finding F4 (docs/code-analysis/2026-04-26): a user passing
  // a non-canonical IPv6 form to `--allow-ip` would silently fail-closed
  // against the canonical form `parseOriginHeader` returns. The fix runs
  // every `--allow-ip` entry through this normaliser at parse time so
  // `--allow-ip ::0001` matches an Origin of `http://[::1]:4022`.

  it('passes IPv4 entries through unchanged', () => {
    expect(canonicaliseAllowedIp('127.0.0.1')).toBe('127.0.0.1');
    expect(canonicaliseAllowedIp('192.168.2.4')).toBe('192.168.2.4');
    expect(canonicaliseAllowedIp('10.0.0.1')).toBe('10.0.0.1');
  });

  it('canonicalises ::0001 to ::1 (zero-padded → compressed)', () => {
    expect(canonicaliseAllowedIp('::0001')).toBe('::1');
  });

  it('canonicalises full-form 0:0:0:0:0:0:0:1 to ::1 (zero-run compression)', () => {
    expect(canonicaliseAllowedIp('0:0:0:0:0:0:0:1')).toBe('::1');
  });

  it('leaves already-canonical IPv6 entries unchanged', () => {
    expect(canonicaliseAllowedIp('::1')).toBe('::1');
    expect(canonicaliseAllowedIp('::')).toBe('::');
    expect(canonicaliseAllowedIp('2001:db8::1')).toBe('2001:db8::1');
    expect(canonicaliseAllowedIp('fe80::1')).toBe('fe80::1');
  });

  it('lower-cases mixed-case IPv6 hex digits', () => {
    expect(canonicaliseAllowedIp('FE80::1')).toBe('fe80::1');
    expect(canonicaliseAllowedIp('2001:DB8::ABCD')).toBe('2001:db8::abcd');
  });

  it('returns hostnames untouched (operator typo: don\'t silently rewrite)', () => {
    // A hostname slipped to --allow-ip should fail to match later, not
    // be rewritten to something that accidentally matches.
    expect(canonicaliseAllowedIp('myserver.lan')).toBe('myserver.lan');
    expect(canonicaliseAllowedIp('localhost')).toBe('localhost');
  });

  it('returns garbage IPv6-shaped input untouched (URL parse fails)', () => {
    // Contains a colon but is not a valid IPv6 literal; the URL constructor
    // throws and we return the input as-is so the operator can debug it.
    expect(canonicaliseAllowedIp('not:a:valid:ipv6:zzz')).toBe('not:a:valid:ipv6:zzz');
  });

  it('canonicalises ::ffff:127.0.0.1 to its hex-group form (URL behaviour)', () => {
    // The browser URL parser rewrites the IPv4-mapped dotted suffix to
    // hex groups: ::ffff:127.0.0.1 → ::ffff:7f00:1. The matching path
    // in isOriginAllowed already understands both forms via
    // normaliseIpV4Mapped, so canonicalising here keeps both sides on
    // the same wire format.
    expect(canonicaliseAllowedIp('::ffff:127.0.0.1')).toBe('::ffff:7f00:1');
  });

  it('non-canonical --allow-ip matches a canonical Origin via isOriginAllowed', () => {
    // The end-to-end invariant: an operator who configures `--allow-ip ::0001`
    // (non-canonical) MUST end up with an allowlist entry that matches an
    // Origin of `http://[::1]:4022` (canonical, the form
    // parseOriginHeader produces).
    const allowedIps = new Set<string>(['127.0.0.1', '::1', canonicaliseAllowedIp('::0001')]);
    const ctx = {
      allowedIps,
      allowedOrigins: [],
      serverScheme: 'http' as const,
      serverPort: 4022,
    };
    expect(isOriginAllowed('http://[::1]:4022', ctx)).toBe(true);
  });

  it('full-form --allow-ip matches a canonical Origin (the regression case)', () => {
    const allowedIps = new Set<string>(['127.0.0.1', '::1', canonicaliseAllowedIp('0:0:0:0:0:0:0:1')]);
    const ctx = {
      allowedIps,
      allowedOrigins: [],
      serverScheme: 'http' as const,
      serverPort: 4022,
    };
    expect(isOriginAllowed('http://[::1]:4022', ctx)).toBe(true);
  });
});

describe('logOriginReject', () => {
  beforeEach(() => {
    _resetRecentOriginRejects();
  });

  it('evicts the oldest entry once the 256-cap is exceeded', () => {
    const origErr = console.error;
    console.error = () => {};
    try {
      // Fill well past 256 distinct origins — the first ~44 are evicted
      // as the map tops out at 256 (Map preserves insertion order; oldest
      // key goes first).
      for (let i = 0; i < 300; i++) {
        logOriginReject(`https://h${i}.example.com`, '1.2.3.4');
      }
    } finally {
      console.error = origErr;
    }
    // h0 is now gone from the rate-limit map. Calling again must log
    // (no 60 s suppression since the prior timestamp was evicted).
    let called = 0;
    const err2 = console.error;
    console.error = () => { called++; };
    try {
      logOriginReject('https://h0.example.com', '1.2.3.4');
    } finally {
      console.error = err2;
    }
    expect(called).toBe(1);
  });

  it('rate-limits duplicate logs within 60 seconds', () => {
    let called = 0;
    const origErr = console.error;
    console.error = () => { called++; };
    try {
      logOriginReject('https://same.example.com', '1.2.3.4');
      logOriginReject('https://same.example.com', '1.2.3.4');
      logOriginReject('https://same.example.com', '1.2.3.4');
    } finally {
      console.error = origErr;
    }
    expect(called).toBe(1);
  });
});
