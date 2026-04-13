import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

export interface TlsCert {
  cert: string;
  key: string;
}

export function generateSelfSignedCert(): TlsCert {
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
