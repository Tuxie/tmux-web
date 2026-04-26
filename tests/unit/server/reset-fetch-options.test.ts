import { describe, expect, test } from 'bun:test';
import { buildResetFetchOptions } from '../../../src/server/index.js';

const FAKE_CERT_PATH = '/fake/configDir/tls/selfsigned.crt';
const FAKE_CERT_PEM = '-----BEGIN CERTIFICATE-----\nfakebytes\n-----END CERTIFICATE-----\n';

/**
 * Cluster 04, finding F3 (docs/code-analysis/2026-04-26).
 *
 * `tmux-web --reset` POSTs to `https://127.0.0.1:<port>/api/exit?action=restart`
 * with the saved Basic Auth credentials. The previous implementation passed
 * `tls: { rejectUnauthorized: false }` and would happily hand the credential
 * to whoever currently owns the loopback port. The fix pins verification to
 * the persisted self-signed cert at `<configDir>/tls/selfsigned.crt` —
 * the same file the running server reads — and refuses to proceed when
 * the cert file is missing rather than silently falling back to insecure
 * verification.
 */
describe('buildResetFetchOptions (F3 — --reset TLS verification)', () => {
  test('TLS path: pins ca to the persisted cert and includes Authorization header', () => {
    const opts = buildResetFetchOptions({
      useTls: true,
      certPath: FAKE_CERT_PATH,
      basicAuth: { username: 'alice', password: 'hunter2' },
      existsSync: (p) => p === FAKE_CERT_PATH,
      readFileSync: (p) => {
        if (p !== FAKE_CERT_PATH) throw new Error(`unexpected read ${p}`);
        return FAKE_CERT_PEM;
      },
    });
    expect(opts.method).toBe('POST');
    expect(opts.tls).toEqual({ ca: FAKE_CERT_PEM });
    expect(opts.headers['Authorization']).toBe('Basic ' + btoa('alice:hunter2'));
    // Critically: NO rejectUnauthorized: false anywhere in the options.
    expect(JSON.stringify(opts).includes('rejectUnauthorized')).toBe(false);
  });

  test('TLS path with --no-auth: ca is pinned, no Authorization header', () => {
    const opts = buildResetFetchOptions({
      useTls: true,
      certPath: FAKE_CERT_PATH,
      basicAuth: undefined,
      existsSync: () => true,
      readFileSync: () => FAKE_CERT_PEM,
    });
    expect(opts.tls).toEqual({ ca: FAKE_CERT_PEM });
    expect(opts.headers['Authorization']).toBeUndefined();
  });

  test('TLS path with missing cert file: throws a clear error mentioning systemctl', () => {
    expect(() => buildResetFetchOptions({
      useTls: true,
      certPath: FAKE_CERT_PATH,
      basicAuth: { username: 'alice', password: 'hunter2' },
      existsSync: () => false,
      readFileSync: () => { throw new Error('should not be called'); },
    })).toThrow(/cannot verify/);
  });

  test('TLS path with missing cert: error message names the cert path and a safe alternative', () => {
    let captured: Error | undefined;
    try {
      buildResetFetchOptions({
        useTls: true,
        certPath: FAKE_CERT_PATH,
        basicAuth: undefined,
        existsSync: () => false,
        readFileSync: () => '',
      });
    } catch (err) {
      captured = err as Error;
    }
    expect(captured).toBeDefined();
    expect(captured!.message).toContain(FAKE_CERT_PATH);
    // Must point the user at a safe alternative, not silently fall back.
    expect(captured!.message).toMatch(/systemctl|SIGTERM|kill/);
  });

  test('TLS path: explicitly does NOT carry rejectUnauthorized: false', () => {
    // The pre-fix code passed { rejectUnauthorized: false } which means a
    // stranger owning 127.0.0.1:<port> after the original server died would
    // receive the credential. Even with a valid `ca`, an accidental
    // re-introduction of that field would re-open the hole. Lock it out
    // structurally.
    const opts = buildResetFetchOptions({
      useTls: true,
      certPath: FAKE_CERT_PATH,
      basicAuth: { username: 'u', password: 'p' },
      existsSync: () => true,
      readFileSync: () => FAKE_CERT_PEM,
    });
    expect(opts.tls).toBeDefined();
    // No `rejectUnauthorized` key on the tls block.
    expect(Object.keys(opts.tls!)).toEqual(['ca']);
  });

  test('plain HTTP path: returns options without any tls block (verification N/A)', () => {
    const opts = buildResetFetchOptions({
      useTls: false,
      certPath: FAKE_CERT_PATH,  // ignored
      basicAuth: { username: 'alice', password: 'hunter2' },
      existsSync: () => false,    // would throw if we cared
      readFileSync: () => '',
    });
    expect(opts.method).toBe('POST');
    expect(opts.tls).toBeUndefined();
    expect(opts.headers['Authorization']).toBe('Basic ' + btoa('alice:hunter2'));
  });
});
