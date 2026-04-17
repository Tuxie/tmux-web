import { describe, it, expect } from 'bun:test';
import { generateSelfSignedCert } from '../../../src/server/tls.js';

describe('generateSelfSignedCert', () => {
  it('returns cert and key as PEM strings', () => {
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
});
