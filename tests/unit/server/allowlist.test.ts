import { describe, it, expect } from 'vitest';
import { isAllowed, normalizeIp } from '../../../src/server/allowlist.js';

describe('normalizeIp', () => {
  it('strips ::ffff: prefix from IPv4-mapped IPv6', () => {
    expect(normalizeIp('::ffff:192.168.0.1')).toBe('192.168.0.1');
  });
  it('leaves plain IPv4 unchanged', () => {
    expect(normalizeIp('10.0.0.1')).toBe('10.0.0.1');
  });
  it('leaves plain IPv6 unchanged', () => {
    expect(normalizeIp('::1')).toBe('::1');
  });
});

describe('isAllowed', () => {
  it('always allows 127.0.0.1', () => {
    expect(isAllowed('127.0.0.1', new Set())).toBe(true);
  });
  it('always allows ::1', () => {
    expect(isAllowed('::1', new Set())).toBe(true);
  });
  it('always allows ::ffff:127.0.0.1', () => {
    expect(isAllowed('::ffff:127.0.0.1', new Set())).toBe(true);
  });
  it('allows an IP in the allowlist', () => {
    expect(isAllowed('192.168.0.100', new Set(['192.168.0.100']))).toBe(true);
  });
  it('allows ::ffff: mapped version of an allowlisted IPv4', () => {
    expect(isAllowed('::ffff:192.168.0.100', new Set(['192.168.0.100']))).toBe(true);
  });
  it('rejects an IP not in the allowlist', () => {
    expect(isAllowed('10.0.0.5', new Set(['192.168.0.100']))).toBe(false);
  });
  it('rejects unknown IP with empty allowlist', () => {
    expect(isAllowed('8.8.8.8', new Set())).toBe(false);
  });
});
