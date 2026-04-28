export interface RemoteRoute {
  host: string;
  session: string;
}

const HOST_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function isValidRemoteHostAlias(host: string): boolean {
  return host.length > 0 && host.length <= 255 && HOST_RE.test(host);
}

export function parseRemotePath(pathname: string): RemoteRoute | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== 'r' || parts.length < 3) return null;
  const host = parts[1]!;
  if (!isValidRemoteHostAlias(host)) return null;
  return { host, session: parts.slice(2).join('/') || 'main' };
}

export function buildRemoteWsParams(pathname: string): { remoteHost: string; session: string } | null {
  const parsed = parseRemotePath(pathname);
  return parsed ? { remoteHost: parsed.host, session: parsed.session } : null;
}
