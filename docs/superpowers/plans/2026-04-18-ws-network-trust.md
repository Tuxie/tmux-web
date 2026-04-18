# ws-network-trust Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the DNS-rebind / cross-site-WebSocket vector against tmux-web by validating the browser `Origin` header on HTTP and WS upgrades, layered under the existing `--allow-ip` and Basic Auth.

**Architecture:** Pure helper module (`src/server/origin.ts`) computes `isOriginAllowed(req, config)`; the HTTP handler and WS upgrade listener call it right after the existing IP allowlist check and before Basic Auth. Two new CLI flags: `-i/--allow-ip` (short alias added) and `-o/--allow-origin` (new). Defaults: `--allow-ip` populated with `127.0.0.1` and `::1`; `--allow-origin` empty. Origins whose host is a literal IP are auto-allowed when that IP is in `--allow-ip` **and** scheme+port match the server's bind; hostnames must match an `--allow-origin` entry exactly (scheme, host, port). `-o *` is an explicit wildcard with a startup warning when combined with non-loopback `-i`.

**Tech Stack:** TypeScript, Bun runtime, `bun test` + Playwright for tests, `parseArgs` from `node:util` for CLI parsing.

**Spec:** `docs/superpowers/specs/2026-04-18-ws-network-trust-design.md`

---

## File structure

- **Create:** `src/server/origin.ts` — pure: `parseOriginHeader`, `parseAllowOriginFlag`, `isIpLiteral`, `isOriginAllowed`, `AllowedOriginEntry` type.
- **Create:** `tests/unit/server/origin.test.ts` — unit tests for every helper and every decision branch.
- **Create:** `tests/e2e/origin-check.test.ts` — one regression test: server on loopback, `Origin: https://evil.com` → 403.
- **Modify:** `src/shared/types.ts` — add `allowedOrigins` to `ServerConfig`.
- **Modify:** `src/server/index.ts` — add `-o`, add `-i` short alias, default `--allow-ip`, parse + canonicalise, startup warning, help text.
- **Modify:** `src/server/http.ts` — call `isOriginAllowed` between IP check and auth check.
- **Modify:** `src/server/ws.ts` — same, in the upgrade handler.
- **Modify:** `CLAUDE.md` — CLI Options table adds the two flags; short security note added to the architecture section.
- **Modify:** `README.md` — CLI Options section mirrors the new flags; short Origin-validation subsection.
- **Modify:** `CHANGELOG.md` — new entry.

---

## Task 1: origin.ts — `parseOriginHeader` and `parseAllowOriginFlag`

**Files:**
- Create: `src/server/origin.ts`
- Create: `tests/unit/server/origin.test.ts`

- [ ] **Step 1: Write failing tests for `parseOriginHeader`**

Create `tests/unit/server/origin.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  parseOriginHeader,
  parseAllowOriginFlag,
  isIpLiteral,
  isOriginAllowed,
} from '../../../src/server/origin.js';

describe('parseOriginHeader', () => {
  it('parses http with explicit port', () => {
    expect(parseOriginHeader('http://example.com:8080')).toEqual({
      scheme: 'http', host: 'example.com', port: 8080,
    });
  });
  it('parses https with implicit port 443', () => {
    expect(parseOriginHeader('https://example.com')).toEqual({
      scheme: 'https', host: 'example.com', port: 443,
    });
  });
  it('parses http with implicit port 80', () => {
    expect(parseOriginHeader('http://example.com')).toEqual({
      scheme: 'http', host: 'example.com', port: 80,
    });
  });
  it('lowercases host', () => {
    expect(parseOriginHeader('https://Example.COM')).toEqual({
      scheme: 'https', host: 'example.com', port: 443,
    });
  });
  it('parses IPv4 literal', () => {
    expect(parseOriginHeader('http://127.0.0.1:4022')).toEqual({
      scheme: 'http', host: '127.0.0.1', port: 4022,
    });
  });
  it('parses bracketed IPv6 literal and strips brackets', () => {
    expect(parseOriginHeader('http://[::1]:4022')).toEqual({
      scheme: 'http', host: '::1', port: 4022,
    });
  });
  it('returns null for unsupported scheme', () => {
    expect(parseOriginHeader('ftp://example.com')).toBeNull();
  });
  it('returns null for malformed input', () => {
    expect(parseOriginHeader('not-a-url')).toBeNull();
  });
  it('returns null for "null" literal (sandboxed iframes)', () => {
    expect(parseOriginHeader('null')).toBeNull();
  });
});

describe('parseAllowOriginFlag', () => {
  it('parses a full http origin with port', () => {
    expect(parseAllowOriginFlag('http://myserver.lan:4022')).toEqual({
      scheme: 'http', host: 'myserver.lan', port: 4022,
    });
  });
  it('defaults port to 443 for https when implicit', () => {
    expect(parseAllowOriginFlag('https://tmux.example.com')).toEqual({
      scheme: 'https', host: 'tmux.example.com', port: 443,
    });
  });
  it('defaults port to 80 for http when implicit', () => {
    expect(parseAllowOriginFlag('http://example.com')).toEqual({
      scheme: 'http', host: 'example.com', port: 80,
    });
  });
  it('lowercases host and strips trailing slash', () => {
    expect(parseAllowOriginFlag('https://Example.COM/')).toEqual({
      scheme: 'https', host: 'example.com', port: 443,
    });
  });
  it('recognises the "*" wildcard', () => {
    expect(parseAllowOriginFlag('*')).toBe('*');
  });
  it('throws on malformed input', () => {
    expect(() => parseAllowOriginFlag('myserver.lan')).toThrow();
  });
  it('throws on unsupported scheme', () => {
    expect(() => parseAllowOriginFlag('ws://example.com')).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/server/origin.test.ts`
Expected: FAIL with `Cannot find module '../../../src/server/origin.js'` (file not yet created).

- [ ] **Step 3: Implement the helpers**

Create `src/server/origin.ts`:

```ts
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
  // u.hostname is already lowercased and IPv6-bracket-stripped by the WHATWG parser.
  const host = u.hostname;
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/server/origin.test.ts`
Expected: PASS for all `parseOriginHeader` and `parseAllowOriginFlag` tests. `isIpLiteral` and `isOriginAllowed` tests are added in Task 2.

- [ ] **Step 5: Commit**

```bash
git add src/server/origin.ts tests/unit/server/origin.test.ts
git commit -m "feat(server): add origin header parser and allowlist entry parser"
```

---

## Task 2: origin.ts — `isIpLiteral` and `isOriginAllowed`

**Files:**
- Modify: `tests/unit/server/origin.test.ts`
- Already implemented in Task 1: `src/server/origin.ts` has both functions; this task adds the tests that exercise them.

- [ ] **Step 1: Append failing tests for `isIpLiteral` and `isOriginAllowed`**

Add to `tests/unit/server/origin.test.ts`:

```ts
describe('isIpLiteral', () => {
  it('recognises IPv4', () => {
    expect(isIpLiteral('127.0.0.1')).toBe(true);
    expect(isIpLiteral('192.168.2.4')).toBe(true);
  });
  it('recognises IPv6 (colons present)', () => {
    expect(isIpLiteral('::1')).toBe(true);
    expect(isIpLiteral('fe80::1')).toBe(true);
  });
  it('rejects hostnames', () => {
    expect(isIpLiteral('myserver.lan')).toBe(false);
    expect(isIpLiteral('tmux.example.com')).toBe(false);
    expect(isIpLiteral('localhost')).toBe(false);
  });
});

describe('isOriginAllowed', () => {
  const mkCtx = (overrides: Partial<Parameters<typeof isOriginAllowed>[1]> = {}) => ({
    allowedIps: new Set(['127.0.0.1', '::1']),
    allowedOrigins: [] as ReturnType<typeof parseAllowOriginFlag>[],
    serverScheme: 'http' as const,
    serverPort: 4022,
    ...overrides,
  });
  const mkReq = (origin: string | undefined) =>
    ({ headers: origin === undefined ? {} : { origin } }) as any;

  it('allows requests with no Origin header', () => {
    expect(isOriginAllowed(mkReq(undefined), mkCtx())).toBe(true);
  });
  it('allows loopback IPv4 Origin on default config', () => {
    expect(isOriginAllowed(mkReq('http://127.0.0.1:4022'), mkCtx())).toBe(true);
  });
  it('allows loopback IPv6 Origin on default config', () => {
    expect(isOriginAllowed(mkReq('http://[::1]:4022'), mkCtx())).toBe(true);
  });
  it('allows LAN IP Origin when IP is in allowedIps', () => {
    const ctx = mkCtx({ allowedIps: new Set(['127.0.0.1', '::1', '192.168.2.4']) });
    expect(isOriginAllowed(mkReq('http://192.168.2.4:4022'), ctx)).toBe(true);
  });
  it('rejects LAN IP Origin when IP is not in allowedIps', () => {
    expect(isOriginAllowed(mkReq('http://192.168.2.4:4022'), mkCtx())).toBe(false);
  });
  it('rejects IP Origin on scheme mismatch', () => {
    const ctx = mkCtx({ serverScheme: 'https' });
    expect(isOriginAllowed(mkReq('http://127.0.0.1:4022'), ctx)).toBe(false);
  });
  it('rejects IP Origin on port mismatch', () => {
    expect(isOriginAllowed(mkReq('http://127.0.0.1:9999'), mkCtx())).toBe(false);
  });
  it('rejects DNS-rebind-shape hostname (evil.com → 127.0.0.1)', () => {
    expect(isOriginAllowed(mkReq('https://evil.com'), mkCtx())).toBe(false);
  });
  it('allows hostname matching an --allow-origin entry (exact triple)', () => {
    const ctx = mkCtx({
      allowedOrigins: [parseAllowOriginFlag('https://tmux.example.com')],
    });
    expect(isOriginAllowed(mkReq('https://tmux.example.com'), ctx)).toBe(true);
  });
  it('rejects hostname on scheme mismatch with --allow-origin', () => {
    const ctx = mkCtx({
      allowedOrigins: [parseAllowOriginFlag('https://tmux.example.com')],
    });
    expect(isOriginAllowed(mkReq('http://tmux.example.com'), ctx)).toBe(false);
  });
  it('rejects hostname on port mismatch with --allow-origin', () => {
    const ctx = mkCtx({
      allowedOrigins: [parseAllowOriginFlag('https://tmux.example.com:4443')],
    });
    expect(isOriginAllowed(mkReq('https://tmux.example.com'), ctx)).toBe(false);
  });
  it('matches hostname case-insensitively', () => {
    const ctx = mkCtx({
      allowedOrigins: [parseAllowOriginFlag('https://tmux.example.com')],
    });
    expect(isOriginAllowed(mkReq('https://Tmux.Example.COM'), ctx)).toBe(true);
  });
  it('allows any origin when "*" is present', () => {
    const ctx = mkCtx({ allowedOrigins: ['*'] });
    expect(isOriginAllowed(mkReq('https://evil.com'), ctx)).toBe(true);
  });
  it('rejects malformed Origin header', () => {
    expect(isOriginAllowed(mkReq('not-a-url'), mkCtx())).toBe(false);
  });
  it('rejects Origin: null (sandboxed iframe)', () => {
    expect(isOriginAllowed(mkReq('null'), mkCtx())).toBe(false);
  });
  it('treats ::ffff:-mapped IPv4 Origin as its unmapped form', () => {
    const ctx = mkCtx({ allowedIps: new Set(['127.0.0.1', '::1']) });
    // Origin arrives as bracketed IPv6 literal form
    expect(isOriginAllowed(mkReq('http://[::ffff:127.0.0.1]:4022'), ctx)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `bun test tests/unit/server/origin.test.ts`
Expected: PASS (Task 1 already implemented the helpers).

If any test fails, fix `src/server/origin.ts` — likely candidates: `isIpLiteral` classifying `localhost` wrong (contains no colon/dots), or the `::ffff:127.0.0.1` path (`normaliseIpV4Mapped` must run before the `allowedIps.has` check).

- [ ] **Step 3: Commit**

```bash
git add tests/unit/server/origin.test.ts
git commit -m "test(server): cover origin allow/reject decision branches"
```

---

## Task 3: Extend `ServerConfig` with `allowedOrigins`

**Files:**
- Modify: `src/shared/types.ts:83-101`

- [ ] **Step 1: Add the field to `ServerConfig`**

In `src/shared/types.ts`, update the `ServerConfig` interface:

```ts
export interface ServerConfig {
  host: string;
  port: number;
  allowedIps: Set<string>;
  allowedOrigins: Array<{ scheme: 'http' | 'https'; host: string; port: number } | '*'>;
  tls: boolean;
  tlsCert?: string;
  tlsKey?: string;
  testMode: boolean;
  debug: boolean;
  tmuxBin: string;
  tmuxConf?: string;
  themesDir?: string;
  theme?: string;
  auth: {
    enabled: boolean;
    username?: string;
    password?: string;
  };
}
```

The structural type intentionally mirrors `AllowedOriginEntry` from `src/server/origin.ts` without importing it (keeps `shared/types.ts` free of server-only imports).

- [ ] **Step 2: Run typecheck to confirm consumers still compile**

Run: `bun x tsc --noEmit -p tsconfig.json`
Expected: Errors only in `src/server/index.ts` (does not yet populate the new field). That's expected and is fixed in Task 4. Other consumers (`http.ts`, `ws.ts`, `allowlist.ts`) should compile clean at this point.

If any other file fails typecheck, stop and fix before proceeding.

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "refactor(types): add allowedOrigins to ServerConfig"
```

---

## Task 4: `parseConfig` — add `-o/--allow-origin`, short `-i`, default `--allow-ip`

**Files:**
- Modify: `src/server/index.ts:47-105`

- [ ] **Step 1: Update `parseConfig` options and config assembly**

Replace the `parseArgs` call and config object in `parseConfig` (`src/server/index.ts:47-105`):

```ts
export function parseConfig(argv: string[]): ConfigResult {
  const { values: args } = parseArgs({
    args: argv,
    options: {
      listen:        { type: 'string',  short: 'l', default: `${DEFAULT_HOST}:${DEFAULT_PORT}` },
      terminal:      { type: 'string' },
      'allow-ip':    { type: 'string',  short: 'i', multiple: true, default: [] as string[] },
      'allow-origin':{ type: 'string',  short: 'o', multiple: true, default: [] as string[] },
      username:      { type: 'string',  short: 'u' },
      password:      { type: 'string',  short: 'p' },
      'no-auth':     { type: 'boolean', default: false },
      tls:           { type: 'boolean', default: true },
      'no-tls':      { type: 'boolean', default: false },
      'tls-cert':    { type: 'string' },
      'tls-key':     { type: 'string' },
      'tmux':        { type: 'string',  default: 'tmux' },
      'tmux-conf':   { type: 'string' },
      'themes-dir':  { type: 'string' },
      'theme':       { type: 'string',  short: 't' },
      test:          { type: 'boolean', default: false },
      debug:         { type: 'boolean', short: 'd', default: false },
      help:          { type: 'boolean', short: 'h', default: false },
      version:       { type: 'boolean', short: 'V', default: false },
    },
    strict: true,
  });

  if (args.version) return { config: null, host: '', port: 0, version: true };
  if (args.help) return { config: null, host: '', port: 0, help: true };

  const { host, port } = parseListenAddr(args.listen!);

  const authEnabled = !args['no-auth'];
  const username = args.username || process.env.TMUX_WEB_USERNAME || userInfo().username;
  const password = args.password || process.env.TMUX_WEB_PASSWORD;

  // Default --allow-ip covers loopback; explicit --allow-ip adds to it.
  const rawAllowIps = args['allow-ip'] as string[];
  const allowedIps = new Set<string>(['127.0.0.1', '::1', ...rawAllowIps]);

  // Parse --allow-origin. Throws on malformed input; let it propagate so the
  // user sees the exact bad argument.
  const rawAllowOrigins = args['allow-origin'] as string[];
  const allowedOrigins = rawAllowOrigins.map(parseAllowOriginFlag);

  const config: ServerConfig = {
    host,
    port,
    allowedIps,
    allowedOrigins,
    tls: !!args.tls && !args['no-tls'],
    tlsCert: args['tls-cert'] as string | undefined,
    tlsKey: args['tls-key'] as string | undefined,
    tmuxBin: args.tmux as string,
    tmuxConf: args['tmux-conf'] as string | undefined,
    testMode: !!args.test,
    debug: !!args.debug,
    auth: {
      enabled: authEnabled,
      username,
      password,
    },
    themesDir: args['themes-dir'] as string | undefined,
    theme: args.theme as string | undefined,
  };

  return { config, host, port };
}
```

And add the import at the top of `src/server/index.ts` (next to the existing server imports around line 7-12):

```ts
import { parseAllowOriginFlag } from './origin.js';
```

- [ ] **Step 2: Add a failing test for the default allow-ip set**

Create `tests/unit/server/config.test.ts` (new file):

```ts
import { describe, it, expect } from 'vitest';
import { parseConfig } from '../../../src/server/index.js';

describe('parseConfig', () => {
  it('defaults allowedIps to loopback (127.0.0.1 and ::1)', () => {
    const { config } = parseConfig(['--no-auth']);
    expect(config?.allowedIps.has('127.0.0.1')).toBe(true);
    expect(config?.allowedIps.has('::1')).toBe(true);
  });
  it('defaults allowedOrigins to empty', () => {
    const { config } = parseConfig(['--no-auth']);
    expect(config?.allowedOrigins).toEqual([]);
  });
  it('accepts -i as short alias for --allow-ip', () => {
    const { config } = parseConfig(['--no-auth', '-i', '10.0.0.5']);
    expect(config?.allowedIps.has('10.0.0.5')).toBe(true);
  });
  it('accepts -o as short alias for --allow-origin', () => {
    const { config } = parseConfig(['--no-auth', '-o', 'https://tmux.example.com']);
    expect(config?.allowedOrigins).toEqual([
      { scheme: 'https', host: 'tmux.example.com', port: 443 },
    ]);
  });
  it('accepts "-o *" wildcard', () => {
    const { config } = parseConfig(['--no-auth', '-o', '*']);
    expect(config?.allowedOrigins).toEqual(['*']);
  });
  it('throws on malformed --allow-origin', () => {
    expect(() => parseConfig(['--no-auth', '-o', 'not-a-url'])).toThrow();
  });
});
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `bun test tests/unit/server/config.test.ts`
Expected: PASS.

- [ ] **Step 4: Typecheck**

Run: `bun x tsc --noEmit -p tsconfig.json`
Expected: clean (Task 3's gap is now filled).

- [ ] **Step 5: Commit**

```bash
git add src/server/index.ts tests/unit/server/config.test.ts
git commit -m "feat(cli): add -o/--allow-origin and short -i, default allow-ip to loopback"
```

---

## Task 5: Startup warning for `-o *` + non-loopback `-i`

**Files:**
- Modify: `src/server/index.ts:107-145` (`startServer`)

- [ ] **Step 1: Add a failing test**

Append to `tests/unit/server/config.test.ts`:

```ts
import { warnIfDangerousOriginConfig } from '../../../src/server/index.js';

describe('warnIfDangerousOriginConfig', () => {
  it('warns when -o * combines with a non-loopback --allow-ip', () => {
    const messages: string[] = [];
    const origErr = console.error;
    console.error = (m: unknown) => { messages.push(String(m)); };
    try {
      warnIfDangerousOriginConfig({
        allowedIps: new Set(['127.0.0.1', '::1', '192.168.2.4']),
        allowedOrigins: ['*'],
      });
    } finally {
      console.error = origErr;
    }
    expect(messages.some(m => m.includes('--allow-origin *'))).toBe(true);
  });
  it('does not warn when -o * combines only with loopback', () => {
    const messages: string[] = [];
    const origErr = console.error;
    console.error = (m: unknown) => { messages.push(String(m)); };
    try {
      warnIfDangerousOriginConfig({
        allowedIps: new Set(['127.0.0.1', '::1']),
        allowedOrigins: ['*'],
      });
    } finally {
      console.error = origErr;
    }
    expect(messages).toEqual([]);
  });
  it('does not warn when -o is not wildcard', () => {
    const messages: string[] = [];
    const origErr = console.error;
    console.error = (m: unknown) => { messages.push(String(m)); };
    try {
      warnIfDangerousOriginConfig({
        allowedIps: new Set(['127.0.0.1', '192.168.2.4']),
        allowedOrigins: [{ scheme: 'https', host: 'tmux.example.com', port: 443 }],
      });
    } finally {
      console.error = origErr;
    }
    expect(messages).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/server/config.test.ts`
Expected: FAIL with `warnIfDangerousOriginConfig is not a function`.

- [ ] **Step 3: Implement the helper in `src/server/index.ts`**

Add below `parseConfig` (before `startServer`):

```ts
const LOOPBACK_IPS = new Set(['127.0.0.1', '::1']);

export function warnIfDangerousOriginConfig(
  cfg: Pick<ServerConfig, 'allowedIps' | 'allowedOrigins'>,
): void {
  const hasWildcard = cfg.allowedOrigins.some(e => e === '*');
  if (!hasWildcard) return;
  const hasNonLoopback = [...cfg.allowedIps].some(ip => !LOOPBACK_IPS.has(ip));
  if (!hasNonLoopback) return;
  console.error(
    'tmux-web: warning: --allow-origin * with non-loopback --allow-ip re-opens DNS rebinding;\n'
    + '  prefer listing explicit origins.',
  );
}
```

Then call it from `startServer` after the config password check. Insert after `src/server/index.ts:146`:

```ts
  warnIfDangerousOriginConfig(config);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/server/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/index.ts tests/unit/server/config.test.ts
git commit -m "feat(cli): warn when --allow-origin * combines with non-loopback --allow-ip"
```

---

## Task 6: Update `--help` text

**Files:**
- Modify: `src/server/index.ts:115-136` (`startServer` help block)

- [ ] **Step 1: Edit the help string**

In `src/server/index.ts`, replace the existing help block:

```ts
  if (help) {
    console.log(`Usage: tmux-web [options]

Options:
  -l, --listen <host:port>     Address to listen on (default: ${DEFAULT_HOST}:${DEFAULT_PORT})
  -i, --allow-ip <ip>          Allow an IP address to connect (repeatable; default: 127.0.0.1 and ::1)
  -o, --allow-origin <origin>  Allow a browser Origin (repeatable; full scheme://host[:port], or '*')
  -u, --username <name>        HTTP Basic Auth username (default: $TMUX_WEB_USERNAME or current user)
  -p, --password <pass>        HTTP Basic Auth password (default: $TMUX_WEB_PASSWORD, required)
      --no-auth                Disable HTTP Basic Auth
      --tls                    Enable HTTPS with self-signed certificate (default)
      --no-tls                 Disable HTTPS
      --tls-cert <path>        TLS certificate file (use with --tls-key)
      --tls-key <path>         TLS private key file (use with --tls-cert)
      --tmux <path>            Path to tmux executable (default: tmux)
      --tmux-conf <path>       Alternative tmux.conf to load instead of user default
      --themes-dir <path>      User theme-pack directory override
  -t, --theme <name>           Initial theme name
      --test                   Test mode: use cat PTY, bypass IP/Origin allowlists
  -d, --debug                  Log debug messages to stderr
  -V, --version                Print version and exit
  -h, --help                   Show this help`);
    process.exit(0);
  }
```

Changes relative to current:
- `-a` → `-i` on the allow-ip row, default updated.
- New `-o, --allow-origin` row.
- `--test` description now mentions "IP/Origin allowlists" (both are bypassed in test mode; see Tasks 7 & 8).

- [ ] **Step 2: Spot-check**

Run: `bun src/server/index.ts --help | head -25`
Expected: The two updated lines and the new `-o` line appear.

- [ ] **Step 3: Commit**

```bash
git add src/server/index.ts
git commit -m "docs(cli): document -i/-o and updated --test behaviour in --help"
```

---

## Task 7: Wire `isOriginAllowed` into the HTTP handler

**Files:**
- Modify: `src/server/http.ts:180-194` (request handler prelude)

- [ ] **Step 1: Add a failing test**

Append to `tests/unit/server/config.test.ts` (or create a new `tests/unit/server/http-origin.test.ts`; the existing file is fine):

```ts
import { isOriginAllowed } from '../../../src/server/origin.js';

describe('HTTP Origin check integration (pure shape)', () => {
  it('default config rejects cross-origin from evil.com', () => {
    const { config } = parseConfig(['--no-auth']);
    expect(isOriginAllowed(
      { headers: { origin: 'https://evil.com' } } as any,
      {
        allowedIps: config!.allowedIps,
        allowedOrigins: config!.allowedOrigins,
        serverScheme: config!.tls ? 'https' : 'http',
        serverPort: config!.port,
      },
    )).toBe(false);
  });
});
```

- [ ] **Step 2: Run it; it should already pass (pure helper test)**

Run: `bun test tests/unit/server/config.test.ts`
Expected: PASS. This confirms the contract before wiring to the handler.

- [ ] **Step 3: Modify the request handler**

In `src/server/http.ts`, inside the function returned by `createHttpHandler`, extend the prelude at lines `180-194`:

```ts
  return async (req: IncomingMessage, res: ServerResponse) => {
    const remoteIp = req.socket.remoteAddress || '';
    if (!config.testMode && !isAllowed(remoteIp, config.allowedIps)) {
      debug(config, `HTTP ${req.method} ${req.url} from ${remoteIp} - rejected (IP)`);
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    if (!config.testMode && !isOriginAllowed(req, {
      allowedIps: config.allowedIps,
      allowedOrigins: config.allowedOrigins,
      serverScheme: config.tls ? 'https' : 'http',
      serverPort: config.port,
    })) {
      const origin = req.headers.origin ?? '<none>';
      debug(config, `HTTP ${req.method} ${req.url} from ${remoteIp} - rejected (Origin: ${origin})`);
      logOriginReject(origin, remoteIp);
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    if (!isAuthorized(req, config)) {
      // ... unchanged
    }
    // ... rest unchanged
```

Add the import at the top of `src/server/http.ts`:

```ts
import { isOriginAllowed } from './origin.js';
```

And add a rate-limited stderr logger (one line per distinct origin per minute), placed at module scope near the other module-level helpers in `src/server/http.ts`:

```ts
const recentOriginRejects = new Map<string, number>();
function logOriginReject(origin: string, remoteIp: string): void {
  const now = Date.now();
  const last = recentOriginRejects.get(origin) ?? 0;
  if (now - last < 60_000) return;
  recentOriginRejects.set(origin, now);
  // Cap memory: keep at most 256 distinct origins in the rate-limit table.
  if (recentOriginRejects.size > 256) {
    const oldest = [...recentOriginRejects.entries()].sort((a, b) => a[1] - b[1])[0];
    if (oldest) recentOriginRejects.delete(oldest[0]);
  }
  console.error(
    `tmux-web: rejected origin ${origin} from ${remoteIp} — add \`--allow-origin ${origin}\` to accept`,
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `bun x tsc --noEmit -p tsconfig.json`
Expected: clean.

- [ ] **Step 5: Unit tests still green**

Run: `bun test tests/unit/server/`
Expected: PASS (no existing unit test exercises the HTTP handler's Origin path; the regression is covered by Task 9's E2E).

- [ ] **Step 6: Commit**

```bash
git add src/server/http.ts tests/unit/server/config.test.ts
git commit -m "feat(http): reject cross-origin requests between IP and auth checks"
```

---

## Task 8: Wire `isOriginAllowed` into the WS upgrade

**Files:**
- Modify: `src/server/ws.ts:39-62`

- [ ] **Step 1: Modify the upgrade handler**

Replace the upgrade listener body in `src/server/ws.ts:39-62`:

```ts
  httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const remoteIp = (socket as any).remoteAddress || '';
    debug(config, `WS upgrade from ${remoteIp}`);
    if (!config.testMode && !isAllowed(remoteIp, config.allowedIps)) {
      debug(config, `WS upgrade from ${remoteIp} - rejected (IP)`);
      socket.destroy();
      return;
    }

    if (!config.testMode && !isOriginAllowed(req, {
      allowedIps: config.allowedIps,
      allowedOrigins: config.allowedOrigins,
      serverScheme: config.tls ? 'https' : 'http',
      serverPort: config.port,
    })) {
      const origin = req.headers.origin ?? '<none>';
      debug(config, `WS upgrade from ${remoteIp} - rejected (Origin: ${origin})`);
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    if (!isAuthorized(req, config)) {
      debug(config, `WS upgrade from ${remoteIp} - unauthorized`);
      socket.write('HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm="tmux-web"\r\n\r\n');
      socket.destroy();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/ws')) {
      debug(config, `WS upgrade from ${remoteIp} - allowed`);
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    } else {
      socket.destroy();
    }
  });
```

Add the import at the top of `src/server/ws.ts`:

```ts
import { isOriginAllowed } from './origin.js';
```

Note: we deliberately do **not** call the rate-limited stderr logger here — WS upgrades from browsers are infrequent enough that per-upgrade debug logging is sufficient. If both HTTP and WS start logging the same rejection flood, the user sees duplicates.

- [ ] **Step 2: Typecheck**

Run: `bun x tsc --noEmit -p tsconfig.json`
Expected: clean.

- [ ] **Step 3: Unit tests still green**

Run: `bun test tests/unit/server/`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/server/ws.ts
git commit -m "feat(ws): reject cross-origin upgrades between IP and auth checks"
```

---

## Task 9: E2E regression — DNS-rebind shape gets a 403

**Files:**
- Create: `tests/e2e/origin-check.test.ts`

- [ ] **Step 1: Inspect an existing E2E suite to match the pattern**

Read `tests/e2e/tls.test.ts` first — it already spawns its own server on a fixed port with a custom flag set. The new test uses the same spawn-helper pattern.

Specifically note:
- How the suite picks its port (hardcoded; use `4111` for this new file, outside the existing registry).
- How it reaches the server (`http://127.0.0.1:<port>/`).
- How it kills the server in `afterAll`.

- [ ] **Step 2: Write the test**

Create `tests/e2e/origin-check.test.ts`:

```ts
import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';

const PORT = 4111;
let server: ChildProcess;

test.beforeAll(async () => {
  server = spawn(
    'bun',
    [
      'src/server/index.ts',
      '--listen', `127.0.0.1:${PORT}`,
      '--no-auth',
      '--no-tls',
      '--test',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  // Wait for the server to print its listen line.
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start in 5s')), 5000);
    server.stdout?.on('data', (buf: Buffer) => {
      if (buf.toString().includes(`listening on http://127.0.0.1:${PORT}`)) {
        clearTimeout(t);
        resolve();
      }
    });
  });
});

test.afterAll(async () => {
  server.kill('SIGTERM');
  await new Promise(r => server.on('exit', r));
});

test.describe('Origin check (non-test mode would reject; test mode bypasses)', () => {
  test('DNS-rebind shape is rejected when --test is off', async ({ request }) => {
    // Spawn a separate server WITHOUT --test so origin check applies.
    const realPort = 4112;
    const real = spawn(
      'bun',
      [
        'src/server/index.ts',
        '--listen', `127.0.0.1:${realPort}`,
        '--no-auth',
        '--no-tls',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    try {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('server did not start')), 5000);
        real.stdout?.on('data', (b: Buffer) => {
          if (b.toString().includes(`listening on http://127.0.0.1:${realPort}`)) {
            clearTimeout(t); resolve();
          }
        });
      });
      const res = await request.get(`http://127.0.0.1:${realPort}/`, {
        headers: { origin: 'https://evil.com' },
        failOnStatusCode: false,
      });
      expect(res.status()).toBe(403);
    } finally {
      real.kill('SIGTERM');
      await new Promise(r => real.on('exit', r));
    }
  });

  test('same-origin loopback request succeeds', async ({ request }) => {
    const res = await request.get(`http://127.0.0.1:${PORT}/`, {
      headers: { origin: `http://127.0.0.1:${PORT}` },
      failOnStatusCode: false,
    });
    // --test mode bypasses origin, but this also verifies the loopback case
    // passes when enabled.
    expect([200, 304]).toContain(res.status());
  });

  test('request with no Origin header succeeds', async ({ request }) => {
    const res = await request.get(`http://127.0.0.1:${PORT}/`, {
      failOnStatusCode: false,
    });
    expect([200, 304]).toContain(res.status());
  });
});
```

Note: the rebind-shape test deliberately spawns its own non-test-mode server so the Origin check is live (the top-level `--test` server has both checks bypassed per Task 6's help-text update).

- [ ] **Step 3: Run the test**

Run: `bun x playwright test tests/e2e/origin-check.test.ts --reporter=line`
Expected: 3 tests pass.

If the first test fails with a 200 (origin accepted), re-check that Task 7's non-`testMode` guard is correct. If the third test fails because the server requires Basic Auth despite `--no-auth`, re-check CLI parsing in Task 4.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/origin-check.test.ts
git commit -m "test(e2e): verify DNS-rebind-shape Origin is rejected with 403"
```

---

## Task 10: Docs — CLAUDE.md, README.md, CHANGELOG.md

**Files:**
- Modify: `CLAUDE.md:98-108` (CLI Options table — this also begins to address cluster-04 doc-drift; the rest of that cluster is a separate plan).
- Modify: `README.md` (CLI Options + new Security subsection).
- Modify: `CHANGELOG.md` (new version entry at top).

- [ ] **Step 1: Update `CLAUDE.md` CLI Options table**

Replace the table block at `CLAUDE.md:98-108` (current block — lines 99-108):

```markdown
```
-l, --listen <host:port>       Bind address (default: 0.0.0.0:4022)
-i, --allow-ip <ip>            Allow IP (repeatable; default: 127.0.0.1 and ::1)
-o, --allow-origin <origin>    Allow browser Origin (repeatable; full scheme://host[:port] or '*')
-u, --username <name>          Basic Auth user (default: $TMUX_WEB_USERNAME or current user)
-p, --password <pass>          Basic Auth pass (default: $TMUX_WEB_PASSWORD, required)
    --no-auth                  Disable HTTP Basic Auth
    --tls                      Enable HTTPS with self-signed cert (default)
    --no-tls                   Disable HTTPS and fallback to HTTP
    --tls-cert <path>          Custom TLS certificate file (use with --tls-key)
    --tls-key <path>           Custom TLS private key file (use with --tls-cert)
    --tmux <path>              Path to tmux executable (default: tmux)
    --tmux-conf <path>         Alternative tmux.conf
    --themes-dir <path>        User theme-pack directory override
-t, --theme <name>             Initial theme name
    --test                     Test mode: cat PTY, bypass IP/Origin allowlists
-d, --debug                    Log debug messages to stderr
-V, --version                  Print version and exit
-h, --help                     Show this help
```
```

- [ ] **Step 2: Add a short Origin-validation subsection to `README.md`**

Under the CLI Options / Security section of `README.md`, add:

```markdown
### Origin validation

tmux-web validates the browser `Origin` header on HTTP and WebSocket requests to close DNS-rebinding and cross-site-WebSocket attacks. Requests without an `Origin` header (curl, scripts) are not affected.

Default behaviour:

- Origins whose host is a literal IP listed in `--allow-ip` are auto-allowed (so `http://127.0.0.1:4022` and `http://<your-LAN-IP>:4022` work without extra config).
- Origins whose host is a hostname must appear in `--allow-origin`.

Examples:

```
# Direct LAN access
tmux-web --listen 0.0.0.0:4022 -i 192.168.2.0/24

# Behind nginx-proxy-manager at https://tmux.example.com
tmux-web --listen 127.0.0.1:4022 -i 10.0.0.5 \
  -o https://tmux.example.com
```

`-o *` disables the hostname check entirely. It is an explicit opt-in; the server warns at startup if it's combined with any non-loopback `--allow-ip`.
```

(The `192.168.2.0/24` example implies CIDR support. If the existing `isAllowed` implementation doesn't support CIDR — it doesn't, as of `src/server/allowlist.ts` — change the example to `-i 192.168.2.4` or a single-IP form. CIDR support is out of scope for this plan.)

**Correction:** use the single-IP form in the README example:

```
tmux-web --listen 0.0.0.0:4022 -i 192.168.2.4
```

- [ ] **Step 3: Add a CHANGELOG entry**

At the top of `CHANGELOG.md`, insert a new section (above the current `1.4.3` entry). Check `package.json` for the next version — if current is `1.4.3`, this is `1.5.0` (new feature + breaking-ish behaviour change for cross-origin access):

```markdown
## 1.5.0 — 2026-04-18

### Added
- `-i` short flag for `--allow-ip`.
- `-o` / `--allow-origin` flag to whitelist browser Origins for HTTP and WebSocket access. Repeatable. Values are full origins (`scheme://host[:port]`) or `*`.

### Security
- HTTP requests and WebSocket upgrades now validate the browser `Origin` header. Origins whose host is an IP literal in `--allow-ip` are auto-allowed; hostnames must appear in `--allow-origin`. Requests without an `Origin` header (curl, scripts) are unaffected. This closes a DNS-rebinding and cross-site-WebSocket vector identified in the 2026-04-17 code review.

### Changed
- Default `--allow-ip` now explicitly lists `127.0.0.1` and `::1` rather than relying only on the inline loopback guard.
```

Bump `package.json#version` to `1.5.0`.

- [ ] **Step 4: Sanity-check the bump with the existing release workflow**

Per CLAUDE.md's release policy, run `act -j build --matrix name:linux-x64 -P ubuntu-latest=catthehacker/ubuntu:act-latest` before tagging. This task does **not** push a tag — that's a manual release step handled by the maintainer.

Run: `act -j build --matrix name:linux-x64 -P ubuntu-latest=catthehacker/ubuntu:act-latest 2>&1 | tail -50`
Expected: unit-test and `verify-vendor-xterm.ts` steps pass. `upload-artifact` may fail — expected per CLAUDE.md.

If unit tests fail, stop and fix before committing. Do not ship a tag.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md README.md CHANGELOG.md package.json
git commit -m "docs(release): document -i/-o, origin validation, changelog for 1.5.0"
```

---

## Post-task verification

- [ ] **All unit tests pass:** `bun test`
- [ ] **E2E tests pass:** `bun x playwright test`
- [ ] **Typecheck clean:** `bun x tsc --noEmit -p tsconfig.json`
- [ ] **`act` build passes** (per CLAUDE.md release protocol).
- [ ] **Manual smoke test:**
  ```bash
  bun src/server/index.ts --listen 127.0.0.1:4022 --no-auth --no-tls &
  SERVER_PID=$!
  # Loopback should work
  curl -s -o /dev/null -w '%{http_code}\n' \
    -H 'Origin: http://127.0.0.1:4022' http://127.0.0.1:4022/   # expect 200
  # DNS-rebind shape should be rejected
  curl -s -o /dev/null -w '%{http_code}\n' \
    -H 'Origin: https://evil.com' http://127.0.0.1:4022/         # expect 403
  # No Origin should work (curl/scripts)
  curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4022/ # expect 200
  kill $SERVER_PID
  ```

Update the cluster file to mark resolved:

```bash
# After confirming all of the above, strike-through the 01-ws-network-trust link
# in docs/code-analysis/2026-04-17/README.md to record the cluster closed.
```

---

## Self-review notes

- **Spec coverage:** Every spec section (CLI, allow rule, rejection behaviour, startup warning, config shape, file layout, unit tests, E2E, CHANGELOG, docs) maps to a task. ✓
- **Type consistency:** `OriginTuple` / `AllowedOriginEntry` shape declared in Task 1, used verbatim in Task 3's `ServerConfig` (via structural equivalence), and consumed in Tasks 4/7/8. ✓
- **Ambiguity:** One caveat flagged in Task 10 Step 2 — the README example initially used a CIDR that `src/server/allowlist.ts` doesn't support; corrected inline to a single-IP form.
- **Scope:** Single cluster, single subsystem (network trust). Not bundled with cluster 04 doc-drift — Task 10 only touches the CLI Options table row that this cluster materially changes; the other drift items remain for their own session.
