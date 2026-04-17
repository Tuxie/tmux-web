import { describe, it, expect } from 'bun:test';
import type { IncomingMessage } from 'http';
import type { ServerConfig } from '../../../src/shared/types.js';
import { isAuthorized } from '../../../src/server/http.js';

function makeReq(authHeader?: string): IncomingMessage {
  return {
    headers: authHeader ? { authorization: authHeader } : {},
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as IncomingMessage;
}

function makeConfig(overrides: Partial<ServerConfig['auth']> = {}): ServerConfig {
  return {
    host: '127.0.0.1',
    port: 4022,
    allowedIps: new Set(['127.0.0.1']),
    allowedOrigins: [],
    tls: false,
    tmuxBin: 'tmux',
    testMode: false,
    debug: false,
    auth: {
      enabled: true,
      username: 'user',
      password: 'secret',
      ...overrides,
    },
  } as ServerConfig;
}

function basicHeader(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

describe('isAuthorized (timing-safe)', () => {
  it('returns true when auth disabled regardless of header', () => {
    const cfg = makeConfig();
    (cfg.auth as { enabled: boolean }).enabled = false;
    expect(isAuthorized(makeReq(), cfg)).toBe(true);
    expect(isAuthorized(makeReq(basicHeader('wrong', 'wrong')), cfg)).toBe(true);
  });

  it('returns true when both username and password match', () => {
    const cfg = makeConfig();
    expect(isAuthorized(makeReq(basicHeader('user', 'secret')), cfg)).toBe(true);
  });

  it('returns false when username mismatches but password matches', () => {
    const cfg = makeConfig();
    expect(isAuthorized(makeReq(basicHeader('bad', 'secret')), cfg)).toBe(false);
  });

  it('returns false when both mismatch', () => {
    const cfg = makeConfig();
    expect(isAuthorized(makeReq(basicHeader('bad', 'bad')), cfg)).toBe(false);
  });

  it('returns false when username matches but password mismatches', () => {
    const cfg = makeConfig();
    expect(isAuthorized(makeReq(basicHeader('user', 'wrong')), cfg)).toBe(false);
  });

  it('returns false when no Authorization header', () => {
    const cfg = makeConfig();
    expect(isAuthorized(makeReq(), cfg)).toBe(false);
  });

  it('does not crash when config credentials are empty strings', () => {
    const cfg = makeConfig({ username: '', password: '' });
    // Empty-string credentials: a colon-only header would match
    expect(isAuthorized(makeReq(basicHeader('', '')), cfg)).toBe(true);
    expect(isAuthorized(makeReq(basicHeader('x', '')), cfg)).toBe(false);
  });
});
