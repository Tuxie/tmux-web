import fs from 'fs';
import os from 'os';
import path from 'path';
import { timingSafeEqual } from 'crypto';
import type { Server as BunServer } from 'bun';
import { MIME_TYPES } from '../shared/constants.js';
import type { ServerConfig } from '../shared/types.js';
import { isAllowed } from './allowlist.js';
import { isOriginAllowed, logOriginReject } from './origin.js';
import { embeddedAssets } from './assets-embedded.js';
import {
  listColours,
  listFonts,
  listPacks,
  listThemes,
  readPackFile,
  type PackInfo,
} from './themes.js';
import { applyPatch, deleteSession, loadConfig, type SessionsConfigPatch } from './sessions-store.js';
import {
  writeDrop,
  listDrops,
  deleteDrop,
  DropQuotaExceededError,
  type DropStorage,
} from './file-drop.js';
import { getForegroundProcess } from './foreground-process.js';
import { sendBytesToPane } from './tmux-inject.js';
import { formatBracketedPasteForDrop } from './drop-paste.js';
import { sanitizeSession } from './pty.js';
import { type TmuxControl } from './tmux-control.js';
import { listSessionsViaTmux, listWindowsViaTmux } from './tmux-listings.js';
import pkg from '../../package.json' with { type: 'json' };

export interface HttpHandlerOptions {
  config: ServerConfig;
  htmlTemplate: string;
  distDir: string;
  themesUserDir: string;
  themesBundledDir: string;
  projectRoot: string;
  isCompiled?: boolean;
  sessionsStorePath: string;
  dropStorage: DropStorage;
  tmuxControl: TmuxControl;
}

/** Per-session upload cap. 50 MiB — comfortably larger than typical
 *  screenshots and small docs, small enough to not starve memory when
 *  buffered in the HTTP handler before being written to disk. */
const MAX_DROP_BYTES = 50 * 1024 * 1024;

/** Session-settings body cap. 1 MiB is generous for a JSON schema of
 *  per-session UI preferences but still finite. */
const MAX_SESSION_SETTINGS_BYTES = 1 * 1024 * 1024;

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** Detect whether a `PUT /api/session-settings` patch tries to write a
 *  `clipboard` entry on any session. Clipboard grants are consent-only
 *  (recorded via `recordGrant` from `clipboard-policy.ts`); any PUT
 *  that carries one must be rejected.
 *
 *  Kept alongside `validateSessionPatch` (cluster 15 / F7) as a belt-
 *  and-braces check — the validator subsumes the same rule but the
 *  string-walking shape here is a useful regression guard against
 *  future refactors that bypass the validator. */
function hasClipboardField(patch: unknown): boolean {
  if (!patch || typeof patch !== 'object') return false;
  const sessions = (patch as { sessions?: unknown }).sessions;
  if (!sessions || typeof sessions !== 'object') return false;
  for (const sessionPatch of Object.values(sessions)) {
    if (sessionPatch && typeof sessionPatch === 'object'
        && 'clipboard' in (sessionPatch as object)) {
      return true;
    }
  }
  return false;
}

/** Hand-rolled typed validator for the `PUT /api/session-settings`
 *  patch shape. Replaces a previous reliance on `JSON.parse` casting
 *  the body straight into `SessionsConfigPatch` with no runtime
 *  schema gate.
 *
 *  Accepts: `{lastActive?: string, sessions?: {[name]: StoredSessionSettings}}`.
 *  Rejects:
 *    - non-object root,
 *    - non-string `lastActive`,
 *    - non-object `sessions`,
 *    - any session entry that's not a plain object,
 *    - any session entry that carries a `clipboard` field (consent-only,
 *      see `hasClipboardField` above),
 *    - any unknown top-level key — fail closed so a future refactor that
 *      adds another protected field can't be silently bypassed by an
 *      authenticated client sending the field via this PUT.
 *
 *  Returns `{ok: false, reason}` or `{ok: true, patch}`. The patch
 *  returned is the same object the caller passed in (no defensive
 *  copy) — `applyPatch` does its own sanitization via
 *  `sanitizeSessions`. Cluster 15 / F7 — docs/code-analysis/2026-04-26. */
export type SessionPatchValidationResult =
  | { ok: true; patch: SessionsConfigPatch }
  | { ok: false; reason: string };

const ALLOWED_PATCH_TOP_KEYS = new Set(['lastActive', 'sessions']);

export function validateSessionPatch(value: unknown): SessionPatchValidationResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: 'patch must be a JSON object' };
  }
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!ALLOWED_PATCH_TOP_KEYS.has(key)) {
      return { ok: false, reason: `unknown top-level key: ${key}` };
    }
  }
  if ('lastActive' in obj && obj.lastActive !== undefined) {
    if (typeof obj.lastActive !== 'string') {
      return { ok: false, reason: 'lastActive must be a string' };
    }
  }
  if ('sessions' in obj && obj.sessions !== undefined) {
    if (!obj.sessions || typeof obj.sessions !== 'object' || Array.isArray(obj.sessions)) {
      return { ok: false, reason: 'sessions must be an object' };
    }
    const sessions = obj.sessions as Record<string, unknown>;
    for (const [name, entry] of Object.entries(sessions)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return { ok: false, reason: `session ${name} must be an object` };
      }
      if ('clipboard' in (entry as object)) {
        return {
          ok: false,
          reason: 'clipboard entries are not writable via PUT — use the consent prompt',
        };
      }
    }
  }
  return { ok: true, patch: obj as SessionsConfigPatch };
}

/** Thin wrapper that resolves the foreground process (so we know
 *  whether to shell-quote) and hands off to the pure formatter. */
async function formatDropPasteBytes(
  opts: HttpHandlerOptions,
  session: string,
  absolutePath: string,
): Promise<string> {
  const config = opts.config;
  let exePath: string | null = null;
  if (!config.testMode) {
    try {
      const fg = await getForegroundProcess(opts.tmuxControl.run, session);
      exePath = fg.exePath;
    } catch { /* foreground lookup failed — raw path */ }
  }
  return formatBracketedPasteForDrop(exePath, absolutePath);
}

function debug(config: ServerConfig, ...args: unknown[]): void {
  if (config.debug) process.stderr.write(`[debug] ${args.join(' ')}\n`);
}

function redactClientAuthUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.searchParams.has('tw_auth')) url.searchParams.set('tw_auth', '<redacted>');
    return url.toString();
  } catch {
    return rawUrl.replace(/([?&]tw_auth=)[^&]*/g, '$1<redacted>');
  }
}

function getAssetPath(key: string): string | null {
  return embeddedAssets[key] || null;
}

// Holds the most recently registered exit listener so a re-run of
// `materializeBundledThemes` (e.g. tests re-instantiating
// `createHttpHandler` in-process) replaces it instead of stacking a
// second one on top — without this guard, repeated mounts trip Node's
// >10-listener warning. Cluster 16 / F3 — docs/code-analysis/2026-04-26.
let activeMaterializedExitListener: (() => void) | null = null;

// TODO(cluster-16): The "extract every embedded theme asset to
// $TMPDIR/tmux-web-themes-${pid} on startup, then register a
// `process.on('exit')` cleanup hook" pattern is acknowledged as
// scale-fragile but T2-acceptable for the current 2-pack repo. A
// follow-up should refactor to one-shot extraction on first request
// (keyed by content hash) or always-from-buffer reads inside
// `themes.ts` so no on-disk staging dir is needed at all. Tracked in
// docs/code-analysis/2026-04-26/clusters/16-theme-pack-runtime.md
// (finding F1).
async function materializeBundledThemes(): Promise<string | null> {
  const keys = Object.keys(embeddedAssets).filter(key => key.startsWith('themes/'));
  if (keys.length === 0) return null;

  const root = path.join(os.tmpdir(), `tmux-web-themes-${process.pid}`);
  for (const key of keys) {
    const src = embeddedAssets[key]!;
    const dest = path.join(root, key.slice('themes/'.length));
    fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
    const bytes = new Uint8Array(await Bun.file(src).arrayBuffer());
    fs.writeFileSync(dest, bytes);
  }
  // Drop any prior listener registered by an earlier call in the same
  // process so the listener count stays bounded across re-mounts.
  if (activeMaterializedExitListener) {
    process.removeListener('exit', activeMaterializedExitListener);
  }
  const listener = () => {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {}
  };
  activeMaterializedExitListener = listener;
  process.on('exit', listener);
  return root;
}

async function readFile(filePath: string, assetKey?: string): Promise<{ data: Buffer | Uint8Array; contentType: string } | null> {
  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  // Try embedded asset first
  if (assetKey) {
    const embeddedPath = getAssetPath(assetKey);
    if (embeddedPath) {
      try {
        const file = Bun.file(embeddedPath);
        if (await file.exists()) {
          return { data: new Uint8Array(await file.arrayBuffer()), contentType };
        }
      } catch {}
    }
  }

  // Fallback to filesystem
  try {
    if (fs.existsSync(filePath)) {
      return { data: fs.readFileSync(filePath), contentType };
    }
  } catch {}

  return null;
}

function fileResponse(data: Buffer | Uint8Array, contentType: string): Response {
  return new Response(data, { status: 200, headers: { 'Content-Type': contentType } });
}

function notFound(): Response {
  return new Response('Not Found', { status: 404 });
}

/** Cached terminal version strings for `/api/terminal-versions`.
 *
 *  Reads the `dist/client/xterm-version.json` sidecar emitted by
 *  bun-build.ts (Cluster 16 / F2 — docs/code-analysis/2026-04-26).
 *  Replaces the previous approach of regex-scanning the ~1.5 MB
 *  `xterm.js` bundle on every startup to recover a 7-char SHA the
 *  build step already knows. The build-time sentinel comment in the
 *  bundle is still the source of truth for `verify-vendor-xterm.ts`
 *  — that path is unchanged. */
function getTerminalVersions(projectRoot: string): Record<string, string> {
  const versions: Record<string, string> = {};
  const versionAssetPath = embeddedAssets['dist/client/xterm-version.json']
    ?? path.join(projectRoot, 'dist/client/xterm-version.json');
  try {
    const raw = fs.readFileSync(versionAssetPath, 'utf-8');
    const parsed = JSON.parse(raw) as { rev?: unknown; sha?: unknown };
    if (typeof parsed.rev === 'string' && /^[0-9a-f]{7}$/.test(parsed.rev)) {
      versions['xterm'] = `xterm.js (HEAD, ${parsed.rev})`;
    } else if (typeof parsed.sha === 'string' && /^[0-9a-f]{40}$/.test(parsed.sha)) {
      versions['xterm'] = `xterm.js (HEAD, ${parsed.sha.slice(0, 7)})`;
    } else {
      versions['xterm'] = 'xterm.js (unknown)';
    }
  } catch {
    versions['xterm'] = 'xterm.js (unknown)';
  }
  return versions;
}

/** Constant-time string compare. Pads the shorter buffer to the longer
 *  one's length before `timingSafeEqual` so mismatched lengths don't
 *  short-circuit and leak "your password is the wrong length" via wall
 *  time. Length-mismatch is still reported as `false` via the residual
 *  equality check. */
function safeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');
  const len = Math.max(bufA.length, bufB.length, 1);
  const padA = Buffer.alloc(len);
  const padB = Buffer.alloc(len);
  bufA.copy(padA);
  bufB.copy(padB);
  const eq = timingSafeEqual(padA, padB);
  return eq && bufA.length === bufB.length;
}

export function isAuthorized(authHeader: string | null | undefined, config: ServerConfig): boolean {
  if (!config.auth.enabled) return true;

  if (!authHeader) return false;

  const match = authHeader.match(/^Basic (.+)$/i);
  if (!match) return false;

  const credentials = Buffer.from(match[1]!, 'base64').toString('utf8');
  const index = credentials.indexOf(':');
  if (index < 0) return false;

  const user = credentials.slice(0, index);
  const pass = credentials.slice(index + 1);

  // Compute both comparisons independently before ANDing so we don't
  // short-circuit on the username side and reveal timing information.
  const userMatch = safeStringEqual(user, config.auth.username || '');
  const passMatch = safeStringEqual(pass, config.auth.password || '');
  return userMatch && passMatch;
}

export type HttpHandler = (req: Request, server: BunServer<unknown>) => Response | Promise<Response>;

/** Read the request body into a Buffer, enforcing a byte cap mid-stream
 *  so a malicious client can't OOM the process. Returns `null` when the
 *  cap is exceeded.
 *
 *  When the cap is exceeded we call `reader.cancel()` to signal the
 *  underlying source to abort. The WHATWG Streams spec describes cancel
 *  as "may signal the underlying source to abort" — Bun's Request body
 *  reader has been observed to hang when the upstream connection is
 *  alive but slow-feeding bytes. We race the cancel against a 500 ms
 *  timeout so a slow / wedged upstream cannot hold this handler up.
 *  Cluster 15 / F3 — docs/code-analysis/2026-04-26. */
export async function readBodyCapped(req: Request, max: number): Promise<Buffer | null> {
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        try {
          await Promise.race([
            reader.cancel(),
            new Promise((_, reject) => setTimeout(
              () => reject(new Error('cancel timeout')),
              500,
            )),
          ]);
        } catch { /* swallow cancel errors and timeout — the body is past
                     the cap regardless and we want to release the lock */ }
        return null;
      }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  return Buffer.concat(chunks);
}

export async function createHttpHandler(opts: HttpHandlerOptions): Promise<HttpHandler> {
  const { config, distDir } = opts;
  let bundledDir: string | null = opts.themesBundledDir;
  if (opts.isCompiled) {
    bundledDir = await materializeBundledThemes();
  }
  const packs: PackInfo[] = listPacks(opts.themesUserDir, bundledDir);
  const colourInfos = listColours(packs);
  // Themes / fonts / terminal-versions are frozen at startup — `packs` is
  // immutable for the process lifetime and the xterm bundle can't change
  // without a rebuild. Cache once so the handlers don't re-run the
  // multi-pass theme resolver + localeCompare sort + fs.readFileSync on
  // every GET.
  const themesCache = listThemes(packs);
  const fontsCache = listFonts(packs);
  const terminalVersionsCache = getTerminalVersions(opts.projectRoot);

  const makeHtml = () => {
    const wsBasicAuth = config.exposeClientAuth && config.auth.username && config.auth.password
      ? `${encodeURIComponent(config.auth.username)}:${encodeURIComponent(config.auth.password)}`
      : undefined;
    const clientAuthToken = config.exposeClientAuth ? config.clientAuthToken : undefined;
    const clientUrl = (path: string): string => {
      if (!clientAuthToken) return path;
      const sep = path.includes('?') ? '&' : '?';
      return `${path}${sep}tw_auth=${encodeURIComponent(clientAuthToken)}`;
    };
    const clientConfig = {
      version: pkg.version,
      ...(config.testMode ? { testMode: true } : {}),
      ...(wsBasicAuth ? { wsBasicAuth } : {}),
      ...(clientAuthToken ? { clientAuthToken } : {}),
      ...(config.exposeClientAuth ? { themes: themesCache } : {}),
      ...(config.exposeClientAuth ? { fonts: fontsCache } : {}),
      ...(config.exposeClientAuth ? {
        colours: colourInfos.map(c => ({
          name: c.name,
          variant: c.variant,
          theme: c.theme,
        })),
      } : {}),
    };
    return opts.htmlTemplate
      .replace('<!-- __CONFIG__ -->', `<script>window.__TMUX_WEB_CONFIG = ${JSON.stringify(clientConfig)}</script>`)
      .replace('__XTERM_CSS__', clientUrl('/dist/client/xterm.css'))
      .replace('__BASE_CSS__', clientUrl('/dist/client/base.css'))
      .replace('__DEFAULT_THEME_CSS__', clientUrl('/themes/default/default.css'))
      .replace('__BUNDLE__', clientUrl('/dist/client/xterm.js'));
  };

  return async (req, server) => {
    const remoteIp = server.requestIP(req)?.address || '';
    const method = req.method;
    const url = new URL(req.url);
    const pathname = url.pathname;
    const debugUrl = redactClientAuthUrl(req.url);

    const handle = async (): Promise<Response> => {
    if (!config.testMode && !isAllowed(remoteIp, config.allowedIps)) {
      debug(config, `HTTP ${method} ${debugUrl} from ${remoteIp} - rejected (IP)`);
      return new Response('Forbidden', { status: 403 });
    }

    const originHeader = req.headers.get('origin') ?? undefined;
    if (!config.testMode && !isOriginAllowed(originHeader, {
      allowedIps: config.allowedIps,
      allowedOrigins: config.allowedOrigins,
      serverScheme: config.tls ? 'https' : 'http',
      serverPort: config.port || server.port || config.port,
    })) {
      const origin = originHeader ?? '<none>';
      debug(config, `HTTP ${method} ${debugUrl} from ${remoteIp} - rejected (Origin: ${origin})`);
      logOriginReject(origin, remoteIp);
      return new Response('Forbidden', { status: 403 });
    }

    const authHeader = req.headers.get('authorization') ?? undefined;
    const clientAuthToken = url.searchParams.get('tw_auth') ?? undefined;
    const isClientAuthorized = !!config.clientAuthToken && clientAuthToken === config.clientAuthToken;
    if (!isClientAuthorized && !isAuthorized(authHeader, config)) {
      debug(config, `HTTP ${method} ${debugUrl} from ${remoteIp} - unauthorized`);
      return new Response('Unauthorized', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Basic realm="tmux-web"' },
      });
    }

    debug(config, `HTTP ${method} ${debugUrl} from ${remoteIp}`);

    if (pathname === '/api/fonts') {
      if (method !== 'GET') return new Response(null, { status: 405 });
      return new Response(JSON.stringify(fontsCache), { headers: JSON_HEADERS });
    }

    if (pathname === '/api/themes') {
      if (method !== 'GET') return new Response(null, { status: 405 });
      return new Response(JSON.stringify(themesCache), { headers: JSON_HEADERS });
    }

    if (pathname === '/api/colours') {
      if (method !== 'GET') return new Response(null, { status: 405 });
      const body = JSON.stringify(colourInfos.map(c => ({
        name: c.name, variant: c.variant, theme: c.theme,
      })));
      return new Response(body, { headers: JSON_HEADERS });
    }

    if (pathname === '/api/client-log') {
      if (method !== 'GET') return new Response(null, { status: 405 });
      debug(config, `client-log: ${url.searchParams.get('message') ?? ''}`);
      return new Response(null, { status: 204 });
    }

    if (pathname.startsWith('/themes/')) {
      const rest = pathname.slice('/themes/'.length);
      const slash = rest.indexOf('/');
      if (slash < 0) return new Response(null, { status: 404 });
      let packDir: string;
      let fileName: string;
      try {
        packDir = decodeURIComponent(rest.slice(0, slash));
        fileName = decodeURIComponent(rest.slice(slash + 1));
      } catch {
        return new Response(null, { status: 400 });
      }
      const found = readPackFile(packDir, fileName, packs);
      if (!found) return new Response(null, { status: 404 });
      const ext = path.extname(fileName);
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const data = new Uint8Array(await Bun.file(found.fullPath).arrayBuffer());
      return fileResponse(data, contentType);
    }

    if (pathname.startsWith('/dist/')) {
      const relative = pathname.slice(6);
      const filePath = path.join(distDir, relative);
      const asset = await readFile(filePath, `dist/${relative}`);
      if (asset) return fileResponse(asset.data, asset.contentType);
      return notFound();
    }

    if (pathname === '/api/sessions') {
      if (method !== 'GET') return new Response(null, { status: 405 });
      // tmux's #{session_id} is the `$N` internal id — monotonic across
      // the tmux server's lifetime, not 1-indexed per list. The shared
      // helper strips the `$` so the client can render it like window
      // ids. Tab-separated session_id/session_name (instead of `:`)
      // mirrors the v1.7.0 windows decision and tolerates session names
      // containing colons (an external tmux client can create them
      // even though the WS path rejects `:`). Falls back to
      // execFileAsync if the control client is unavailable / stuck.
      const sessions = await listSessionsViaTmux({
        tmuxControl: opts.tmuxControl,
        tmuxBin: config.tmuxBin,
        preferControl: true,
      });
      return new Response(JSON.stringify(sessions ?? []), { headers: JSON_HEADERS });
    }

    if (pathname === '/api/windows') {
      if (method !== 'GET') return new Response(null, { status: 405 });
      const sess = url.searchParams.get('session') || 'main';
      // Tab-separated — see matching comment in ws.ts sendWindowState.
      // The shared helper handles the control-client-first / fallback
      // flow uniformly.
      const windows = await listWindowsViaTmux(sess, {
        tmuxControl: opts.tmuxControl,
        tmuxBin: config.tmuxBin,
        preferControl: true,
      });
      return new Response(JSON.stringify(windows ?? []), { headers: JSON_HEADERS });
    }

    if (pathname === '/api/drops/paste') {
      if (method !== 'POST') return new Response(null, { status: 405 });
      // The `session` query param is accepted as-is (only sanitized, not
      // cross-checked against an open WS for the requesting auth
      // context). Drops are a per-user pool, not session-scoped, and
      // cross-session paste is intentional behaviour — see cluster 03
      // (docs/code-analysis/2026-04-26) for the explicit decision and
      // the rejected "scope to live-WS sessions" alternative.
      const session = sanitizeSession(url.searchParams.get('session') || 'main');
      const id = url.searchParams.get('id');
      if (!id) return new Response('Missing id', { status: 400 });
      // Re-resolve the drop from the store rather than trusting any path
      // on the query — guarantees we only paste paths that still exist
      // and are inside the drop store root.
      const drops = listDrops(opts.dropStorage);
      const hit = drops.find(d => d.dropId === id);
      if (!hit) {
        return new Response(JSON.stringify({ pasted: false, id }), { status: 404, headers: JSON_HEADERS });
      }
      if (!config.testMode) {
        try {
          await sendBytesToPane({
            run: opts.tmuxControl.run,
            target: session,
            bytes: await formatDropPasteBytes(opts, session, hit.absolutePath),
          });
        } catch (err) {
          debug(config, `drop re-paste send-keys failed: ${err}`);
          return new Response('Inject failed', { status: 500 });
        }
      }
      return new Response(JSON.stringify({ pasted: true, id, path: hit.absolutePath, filename: hit.filename }),
        { headers: JSON_HEADERS });
    }

    if (pathname === '/api/drops') {
      if (method === 'GET') {
        // Strip `absolutePath` from the public response — it leaks the
        // runtime uid + `$XDG_RUNTIME_DIR` layout (/run/user/<uid>/…).
        // The re-paste flow resolves paths server-side from `dropId`
        // (see the /api/drops/paste handler), so the client doesn't
        // need them.
        const drops = listDrops(opts.dropStorage).map(d => ({
          dropId: d.dropId,
          filename: d.filename,
          size: d.size,
          mtime: d.mtime,
        }));
        return new Response(JSON.stringify({ drops }), { headers: JSON_HEADERS });
      }
      if (method === 'DELETE') {
        const id = url.searchParams.get('id');
        if (id) {
          // Single-drop revoke. deleteDrop rejects anything with path
          // separators or that resolves outside the storage root.
          const ok = deleteDrop(opts.dropStorage, id);
          return new Response(JSON.stringify({ deleted: ok, id }),
            { status: ok ? 200 : 404, headers: JSON_HEADERS });
        }
        // Purge-all: list first, then remove by id so the watcher map
        // stays consistent.
        const before = listDrops(opts.dropStorage);
        let count = 0;
        for (const d of before) {
          if (deleteDrop(opts.dropStorage, d.dropId)) count++;
        }
        return new Response(JSON.stringify({ purged: count }), { headers: JSON_HEADERS });
      }
      return new Response(null, { status: 405 });
    }

    if (pathname === '/api/drop') {
      if (method !== 'POST') return new Response(null, { status: 405 });
      // Same per-user-pool semantics as `/api/drops/paste` above —
      // cross-session paste is intentional, not a bug. Cluster 03
      // (docs/code-analysis/2026-04-26) records the decision.
      const session = sanitizeSession(url.searchParams.get('session') || 'main');
      // Browser encodes the original filename so arbitrary UTF-8 / special
      // chars survive HTTP headers (which are latin-1 by default).
      const rawNameHeader = req.headers.get('x-filename');
      let rawName = 'file';
      if (typeof rawNameHeader === 'string' && rawNameHeader) {
        try { rawName = decodeURIComponent(rawNameHeader); } catch { rawName = rawNameHeader; }
      }

      let data: Buffer;
      try {
        const buf = await readBodyCapped(req, MAX_DROP_BYTES);
        if (buf === null) return new Response('Too large', { status: 413 });
        data = buf;
      } catch {
        return new Response('Read error', { status: 400 });
      }

      let absolutePath: string;
      let filename: string;
      try {
        const wrote = writeDrop(opts.dropStorage, rawName, data);
        absolutePath = wrote.absolutePath;
        filename = wrote.filename;
      } catch (err) {
        if (err instanceof DropQuotaExceededError) {
          // Match the per-upload-cap rejection shape so the client's
          // "too large" branch handles both. The message includes the
          // bytes-vs-cap math for the debug log only.
          debug(config, `drop write rejected: ${err.message}`);
          return new Response('Drop quota exceeded', { status: 413 });
        }
        debug(config, `drop write failed: ${err}`);
        return new Response('Write failed', { status: 500 });
      }

      if (!config.testMode) {
        try {
          await sendBytesToPane({
            run: opts.tmuxControl.run,
            target: session,
            bytes: await formatDropPasteBytes(opts, session, absolutePath),
          });
        } catch (err) {
          debug(config, `drop send-keys failed: ${err}`);
          // File is already on disk; surface a 500 so the client can warn
          // the user. The orphaned file will be TTL-swept.
          return new Response('Inject failed', { status: 500 });
        }
      }

      return new Response(JSON.stringify({ path: absolutePath, filename, size: data.length }),
        { headers: JSON_HEADERS });
    }

    if (pathname === '/api/session-settings') {
      if (method === 'GET') {
        const cfg = loadConfig(opts.sessionsStorePath);
        return new Response(JSON.stringify(cfg), { headers: JSON_HEADERS });
      }
      if (method === 'PUT') {
        const contentLength = Number(req.headers.get('content-length') ?? 0);
        if (contentLength > MAX_SESSION_SETTINGS_BYTES) {
          return new Response('Payload Too Large', { status: 413 });
        }
        let body: string;
        try {
          const buf = await readBodyCapped(req, MAX_SESSION_SETTINGS_BYTES);
          if (buf === null) return new Response('Payload Too Large', { status: 413 });
          body = buf.toString('utf-8');
        } catch (err) {
          debug(config, `session-settings PUT error: ${(err as Error).message}`);
          return new Response('Bad Request', { status: 400 });
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(body);
        } catch {
          return new Response('Bad JSON', { status: 400 });
        }
        // Central typed schema gate — rejects unknown top-level keys,
        // unfit shapes, and (notably) any session patch carrying a
        // `clipboard` field. Cluster 15 / F7 — docs/code-analysis/2026-04-26.
        const validation = validateSessionPatch(parsed);
        if (!validation.ok) {
          return new Response(validation.reason, { status: 400 });
        }
        const patch: SessionsConfigPatch = validation.patch;
        // Belt-and-braces: hasClipboardField walks the tree once more
        // looking for the literal 'clipboard' key. Defensive against a
        // future refactor that loosens the validator. Both must agree.
        if (hasClipboardField(patch)) {
          return new Response('clipboard entries are not writable via PUT — use the consent prompt',
            { status: 400 });
        }
        try {
          const next = await applyPatch(opts.sessionsStorePath, patch);
          return new Response(JSON.stringify(next), { headers: JSON_HEADERS });
        } catch (err) {
          return new Response('Save failed', { status: 500 });
        }
      }
      if (method === 'DELETE') {
        const name = url.searchParams.get('name');
        if (!name) return new Response('Missing name', { status: 400 });
        try {
          const next = await deleteSession(opts.sessionsStorePath, name);
          return new Response(JSON.stringify(next), { headers: JSON_HEADERS });
        } catch {
          return new Response('Delete failed', { status: 500 });
        }
      }
      return new Response(null, { status: 405 });
    }

    if (pathname === '/api/terminal-versions') {
      if (method !== 'GET') return new Response(null, { status: 405 });
      return new Response(JSON.stringify(terminalVersionsCache), { headers: JSON_HEADERS });
    }

    if (pathname === '/api/exit' && method === 'POST') {
      // Intentionally not gated beyond Basic Auth (and the IP / Origin
      // checks above). Deployment doc says non-credentialed kill paths
      // should use the systemd unit + SIGTERM; the API exists as a
      // convenience for the desktop wrapper that already holds the
      // password. Kept as a maintainer decision — see cluster 03
      // (docs/code-analysis/2026-04-26) for the rejected alternatives
      // (re-prompt password, loopback-only, --allow-exit-api opt-in).
      const action = url.searchParams.get('action') ?? 'quit';
      const code = action === 'restart' ? 2 : 0;
      const response = new Response(action === 'restart' ? 'restarting' : 'quitting',
        { headers: { 'Content-Type': 'text/plain' } });
      // Server-aware shutdown. Replaces a 100ms `setTimeout(process.exit)`
      // that guessed at "long enough for Bun to flush the response and
      // close the socket" — under load the response could still be
      // in-flight when `process.exit` ran, dropping the body.
      // `server.stop({ closeActiveConnections: false })` waits for
      // in-flight responses (this one!) before resolving; only then do we
      // exit. Used by `--reset` and the desktop wrapper's quit path; both
      // continue to observe the response. Cluster 15 / F1 —
      // docs/code-analysis/2026-04-26.
      queueMicrotask(() => {
        void (async () => {
          try { await server.stop(false); }
          catch { /* best-effort — fall through to process.exit anyway */ }
          process.exit(code);
        })();
      });
      return response;
    }

    return new Response(makeHtml(), { headers: { 'Content-Type': 'text/html' } });
    };

    const response = await handle();
    if (pathname.startsWith('/api/')) {
      debug(config, `API ${method} ${pathname} from ${remoteIp} -> ${response.status}`);
    }
    return response;
  };
}
