import { randomBytes as nodeRandomBytes } from 'node:crypto';

export interface DesktopCredentials {
  username: string;
  password: string;
}

export interface GenerateDesktopCredentialsOptions {
  randomBytes?: (size: number) => Uint8Array;
}

export interface AuthenticatedUrlOptions {
  host: string;
  port: number;
  credentials: DesktopCredentials;
}

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

export function generateDesktopCredentials(
  opts: GenerateDesktopCredentialsOptions = {},
): DesktopCredentials {
  const randomBytes = opts.randomBytes ?? nodeRandomBytes;
  return {
    username: `tmux-term-${base64Url(randomBytes(8))}`,
    password: base64Url(randomBytes(32)),
  };
}

export function buildAuthenticatedUrl(opts: AuthenticatedUrlOptions): string {
  const user = encodeURIComponent(opts.credentials.username);
  const pass = encodeURIComponent(opts.credentials.password);
  return `http://${user}:${pass}@${opts.host}:${opts.port}/`;
}
