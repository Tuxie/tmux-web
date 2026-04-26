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
  originHeader: string | null | undefined,
  ctx: OriginAllowContext,
): boolean {
  const raw = originHeader;
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

const recentOriginRejects = new Map<string, number>();

/** Test-only: reset the rate-limit map so tests don't inherit state
 *  from sibling cases in the same file. */
export function _resetRecentOriginRejects(): void {
  recentOriginRejects.clear();
}

/**
 * Emit a rate-limited stderr line for a rejected Origin. At most one line
 * per distinct origin per minute; capped at 256 entries to avoid unbounded
 * growth under attack.
 */
export function logOriginReject(origin: string, remoteIp: string): void {
  const now = Date.now();
  const last = recentOriginRejects.get(origin) ?? 0;
  if (now - last < 60_000) return;
  // True LRU: delete-then-set moves the entry to the end of the Map's
  // insertion order, so a repeatedly-seen origin migrates to the front
  // of the iterator and is the last (not first) eviction candidate.
  recentOriginRejects.delete(origin);
  recentOriginRejects.set(origin, now);
  if (recentOriginRejects.size > 256) {
    // Map preserves insertion order; with the delete-then-set above the
    // first key is now the genuinely least-recently-seen entry.
    const oldest = recentOriginRejects.keys().next().value;
    if (oldest !== undefined) recentOriginRejects.delete(oldest);
  }
  console.error(
    `tmux-web: rejected origin ${origin} from ${remoteIp} — add \`--allow-origin ${origin}\` to accept`,
  );
}

/**
 * Canonicalise an `--allow-ip` entry so it matches the form produced by
 * `parseOriginHeader` for IP-literal Origin hosts. IPv4 entries pass
 * through unchanged. IPv6 entries are routed through the URL parser,
 * which collapses zero-runs (`::0001` → `::1`, `0:0:0:0:0:0:0:1` →
 * `::1`) and lower-cases hex digits — the same canonical form
 * `parseOriginHeader` returns when it strips the brackets from
 * `http://[::1]:PORT`. Strings that aren't a recognisable IP literal
 * (hostnames, garbage) are returned untouched so downstream lookup
 * code can decide whether to ignore them.
 *
 * Closes cluster 04, finding F4 (docs/code-analysis/2026-04-26): a user
 * passing `--allow-ip ::0001` would otherwise silently fail-closed
 * against an Origin of `http://[::1]:4022` because the entry is matched
 * char-for-char against the canonical form on the request side.
 */
export function canonicaliseAllowedIp(raw: string): string {
  // IPv4 dotted-decimal — already canonical on the request side too;
  // skip the URL round-trip (it would throw for IPv4 inside `[...]`).
  if (IPV4_RE.test(raw)) return raw;
  // Anything without a `:` is not an IPv6 literal (could be a hostname
  // mistakenly fed to --allow-ip; we leave such strings alone so the
  // failure mode stays "Origin reject" and not "silent rewrite to a
  // different but valid IP").
  if (!raw.includes(':')) return raw;
  try {
    const u = new URL(`http://[${raw}]/`);
    let host = u.hostname.toLowerCase();
    if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
    return host;
  } catch {
    return raw;
  }
}

function normaliseIpV4Mapped(ip: string): string {
  if (!ip.startsWith('::ffff:')) return ip;
  const suffix = ip.slice(7); // everything after '::ffff:'
  // Dotted-decimal form: ::ffff:a.b.c.d  →  a.b.c.d
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(suffix)) return suffix;
  // Hex form: ::ffff:XXXX:YYYY  (URL API normalises dotted to hex)
  // Convert two 16-bit hex groups to dotted-decimal IPv4.
  const hexMatch = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(suffix);
  if (hexMatch) {
    const hi = parseInt(hexMatch[1], 16);
    const lo = parseInt(hexMatch[2], 16);
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  return ip;
}
