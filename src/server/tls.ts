import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync, renameSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

export interface TlsCert {
  cert: string;
  key: string;
}

/** Maximum age (in days) before the persisted self-signed cert is regenerated. */
const MAX_CERT_AGE_DAYS = 365;

function generateRaw(): TlsCert {
  const tmp = mkdtempSync(join(tmpdir(), 'tmux-web-tls-'));
  const keyPath = join(tmp, 'key.pem');
  const certPath = join(tmp, 'cert.pem');

  try {
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', keyPath, '-out', certPath,
      '-days', '365', '-subj', '/CN=localhost',
      '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
    ], { stdio: 'pipe' });

    return {
      cert: readFileSync(certPath, 'utf-8'),
      key: readFileSync(keyPath, 'utf-8'),
    };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Return a self-signed TLS cert+key pair.
 *
 * If `configDir` is provided the cert is persisted at
 * `<configDir>/tls/selfsigned.{crt,key}` with mode 0o600 so the same
 * fingerprint survives restarts. The cert is regenerated when the files are
 * missing or older than 365 days. If no `configDir` is given (e.g. in tests
 * that don't want filesystem side-effects) a fresh ephemeral cert is returned.
 */
export function generateSelfSignedCert(configDir?: string): TlsCert {
  if (!configDir) {
    return generateRaw();
  }

  const tlsDir = join(configDir, 'tls');
  const certPath = join(tlsDir, 'selfsigned.crt');
  const keyPath = join(tlsDir, 'selfsigned.key');

  // Reuse existing cert if both files are present and < 365 days old.
  if (existsSync(certPath) && existsSync(keyPath)) {
    try {
      const stat = statSync(certPath);
      const ageMs = Date.now() - stat.mtimeMs;
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      if (ageDays < MAX_CERT_AGE_DAYS) {
        return {
          cert: readFileSync(certPath, 'utf-8'),
          key: readFileSync(keyPath, 'utf-8'),
        };
      }
    } catch {
      // Fall through to regenerate.
    }
  }

  // Generate a fresh cert and persist it atomically.
  const fresh = generateRaw();
  mkdirSync(tlsDir, { recursive: true, mode: 0o700 });
  const certTmp = certPath + '.part';
  const keyTmp = keyPath + '.part';
  writeFileSync(certTmp, fresh.cert, { mode: 0o600 });
  writeFileSync(keyTmp, fresh.key, { mode: 0o600 });
  renameSync(certTmp, certPath);
  renameSync(keyTmp, keyPath);

  return fresh;
}
