/**
 * Origin-header validation. Closes DNS-rebind and cross-site-WS attacks by
 * verifying the browser-reported Origin against configured allowlists.
 *
 * Two allow paths:
 *   - IP-literal hosts (Origin host is an IP): require scheme+port match
 *     the server's bind, AND the IP is in `allowedIps`.
 *   - Hostname hosts (Origin host is not an IP): require an exact
 *     (scheme, host, port) match against an entry in `allowedOrigins`.
 *
 * The '*' wildcard entry short-circuits to allow-any (explicit opt-in).
 */

import type { IncomingMessage } from 'http';

export interface OriginTuple {
  scheme: 'http' | 'https';
  host: string;
  port: number;
}

export type AllowedOriginEntry = OriginTuple | '*';

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

export function isIpLiteral(host: string): boolean {
  if (IPV4_RE.test(host)) return true;
  // IPv6 literals in Origin headers arrive bracketed (http://[::1]:PORT).
  // parseOriginHeader strips the brackets before this is called, so a bare
  // IPv6 string (contains ':') is also an IP literal.
  if (host.includes(':')) return true;
  return false;
}

export function parseOriginHeader(raw: string): OriginTuple | null {
  if (raw === 'null' || raw === '') return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  const scheme = u.protocol === 'http:' ? 'http'
               : u.protocol === 'https:' ? 'https'
               : null;
  if (!scheme) return null;
  // Strip IPv6 brackets: Bun's URL keeps brackets in u.hostname (e.g. "[::1]"),
  // so we strip them manually to get a bare IPv6 literal.
  const rawHost = u.hostname.toLowerCase();
  const host = rawHost.startsWith('[') && rawHost.endsWith(']')
    ? rawHost.slice(1, -1)
    : rawHost;
  const port = u.port !== '' ? Number(u.port) : (scheme === 'https' ? 443 : 80);
  if (!Number.isFinite(port) || port < 1 || port > 65535) return null;
  return { scheme, host, port };
}

export function parseAllowOriginFlag(raw: string): AllowedOriginEntry {
  if (raw === '*') return '*';
  const parsed = parseOriginHeader(raw.replace(/\/+$/, ''));
  if (!parsed) {
    throw new Error(`--allow-origin: invalid origin "${raw}" (expected scheme://host[:port] or *)`);
  }
  return parsed;
}

export interface OriginAllowContext {
  allowedIps: Set<string>;
  allowedOrigins: AllowedOriginEntry[];
  serverScheme: 'http' | 'https';
  serverPort: number;
}

export function isOriginAllowed(
  req: Pick<IncomingMessage, 'headers'>,
  ctx: OriginAllowContext,
): boolean {
  const raw = req.headers.origin;
  if (typeof raw !== 'string' || raw.length === 0) return true;
  if (ctx.allowedOrigins.some(e => e === '*')) return true;
  const origin = parseOriginHeader(raw);
  if (!origin) return false;

  if (isIpLiteral(origin.host)) {
    if (origin.scheme !== ctx.serverScheme) return false;
    if (origin.port !== ctx.serverPort) return false;
    return ctx.allowedIps.has(origin.host)
        || ctx.allowedIps.has(normaliseIpV4Mapped(origin.host));
  }

  return ctx.allowedOrigins.some(e =>
    e !== '*'
    && e.scheme === origin.scheme
    && e.host === origin.host
    && e.port === origin.port,
  );
}

function normaliseIpV4Mapped(ip: string): string {
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}
