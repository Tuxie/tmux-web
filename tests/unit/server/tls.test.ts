import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { generateSelfSignedCert } from '../../../src/server/tls.js';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-tls-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('generateSelfSignedCert', () => {
  it('returns cert and key as PEM strings (ephemeral, no configDir)', () => {
    const { cert, key } = generateSelfSignedCert();
    expect(cert).toContain('-----BEGIN CERTIFICATE-----');
    expect(cert).toContain('-----END CERTIFICATE-----');
    expect(key).toContain('-----BEGIN PRIVATE KEY-----');
    expect(key).toContain('-----END PRIVATE KEY-----');
  });

  it('generates a valid certificate parseable by crypto', async () => {
    const { cert } = generateSelfSignedCert();
    const { X509Certificate } = await import('crypto');
    const x509 = new X509Certificate(cert);
    expect(x509.subject).toContain('CN=localhost');
  });

  it('persists cert under <configDir>/tls/ and reuses on second call', () => {
    const first = generateSelfSignedCert(tmp);
    expect(first.cert).toContain('-----BEGIN CERTIFICATE-----');

    const certPath = path.join(tmp, 'tls', 'selfsigned.crt');
    const keyPath = path.join(tmp, 'tls', 'selfsigned.key');
    expect(fs.existsSync(certPath)).toBe(true);
    expect(fs.existsSync(keyPath)).toBe(true);

    // Second call should return the same cert without regenerating.
    const second = generateSelfSignedCert(tmp);
    expect(second.cert).toBe(first.cert);
    expect(second.key).toBe(first.key);
  });

  it('writes cert files with mode 0o600', () => {
    generateSelfSignedCert(tmp);
    const certPath = path.join(tmp, 'tls', 'selfsigned.crt');
    const keyPath = path.join(tmp, 'tls', 'selfsigned.key');
    const certMode = fs.statSync(certPath).mode & 0o777;
    const keyMode = fs.statSync(keyPath).mode & 0o777;
    expect(certMode).toBe(0o600);
    expect(keyMode).toBe(0o600);
  });

  it('regenerates cert when files are older than 365 days', () => {
    const first = generateSelfSignedCert(tmp);
    const certPath = path.join(tmp, 'tls', 'selfsigned.crt');

    // Back-date the cert file by 366 days.
    const old = new Date(Date.now() - 366 * 24 * 60 * 60 * 1000);
    fs.utimesSync(certPath, old, old);

    const second = generateSelfSignedCert(tmp);
    // The cert should have been regenerated.
    expect(second.cert).not.toBe(first.cert);
  });
});
