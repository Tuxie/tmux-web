import { describe, it, expect } from 'vitest';
import {
  parseOriginHeader,
  parseAllowOriginFlag,
  isIpLiteral,
  isOriginAllowed,
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
