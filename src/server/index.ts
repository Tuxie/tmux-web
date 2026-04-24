import fs from 'fs';
import path from 'path';
import { parseArgs } from 'util';
import { tmpdir, userInfo } from 'os';
import { createHttpHandler } from './http.js';
import { createWsHandlers, type WsData } from './ws.js';
import { createTmuxControl, createNullTmuxControl } from './tmux-control.js';
import { defaultDropStorage, cleanupAll as cleanupDrops } from './file-drop.js';
import { generateSelfSignedCert } from './tls.js';
import type { ServerConfig } from '../shared/types.js';
import { DEFAULT_HOST, DEFAULT_PORT, LOCALHOST_IPS } from '../shared/constants.js';
import { parseAllowOriginFlag } from './origin.js';
import { embeddedAssets } from './assets-embedded.js';
import pkg from '../../package.json' with { type: 'json' };

const VERSION: string = (pkg as { version: string }).version;

// Force a UTF-8 locale on the server process so every child (including the
// tmux subcommands fired from ws.ts: display-message, list-windows,
// set-environment, etc.) outputs raw UTF-8 bytes. Otherwise tmux's
// display-message substitutes non-ASCII chars with `_` when the locale is
// C / POSIX — pane titles like "✳ Claude Code" arrived at the client as
// "_ Claude Code".
if (!process.env.LC_ALL || /^(C|POSIX)$/i.test(process.env.LC_ALL)) {
  process.env.LC_ALL = 'C.UTF-8';
}
if (!process.env.LANG || /^(C|POSIX)$/i.test(process.env.LANG)) {
  process.env.LANG = 'C.UTF-8';
}

function parseListenAddr(addr: string): { host: string; port: number } {
  const ipv6 = addr.match(/^\[(.+)\]:(\d+)$/);
  if (ipv6) return { host: ipv6[1]!, port: Number(ipv6[2]!) };
  const i = addr.lastIndexOf(':');
  if (i < 0) return { host: DEFAULT_HOST, port: Number(addr) };
  return { host: addr.slice(0, i), port: Number(addr.slice(i + 1)) };
}

export interface ConfigResult {
  config: ServerConfig | null;
  host: string;
  port: number;
  help?: boolean;
  version?: boolean;
  reset?: boolean;
  resetTls?: boolean;
  resetAuth?: { username: string; password: string | undefined };
}

export function parseConfig(argv: string[]): ConfigResult {
  const { values: args } = parseArgs({
    args: argv,
    options: {
      listen:         { type: 'string',  short: 'l', default: `${DEFAULT_HOST}:${DEFAULT_PORT}` },
      'allow-ip':     { type: 'string',  short: 'i', multiple: true, default: [] as string[] },
      'allow-origin': { type: 'string',  short: 'o', multiple: true, default: [] as string[] },
      username:       { type: 'string',  short: 'u' },
      password:       { type: 'string',  short: 'p' },
      'no-auth':      { type: 'boolean', default: false },
      tls:            { type: 'boolean', default: true },
      'no-tls':       { type: 'boolean', default: false },
      'tls-cert':     { type: 'string' },
      'tls-key':      { type: 'string' },
      'tmux':         { type: 'string',  default: 'tmux' },
      'tmux-conf':    { type: 'string' },
      'themes-dir':   { type: 'string' },
      // Legacy no-op: --theme was never wired. Accepted here so old systemd
      // units / Homebrew installs that pass --theme X don't fail on upgrade.
      // Remove in a future major if the flag is definitely gone from the wild.
      'theme':        { type: 'string' },
      test:           { type: 'boolean', default: false },
      reset:          { type: 'boolean', default: false },
      debug:          { type: 'boolean', short: 'd', default: false },
      help:           { type: 'boolean', short: 'h', default: false },
      version:        { type: 'boolean', short: 'V', default: false },
    },
    strict: true,
  });

  if (args.version) return { config: null, host: '', port: 0, version: true };
  if (args.help) return { config: null, host: '', port: 0, help: true };

  const { host, port } = parseListenAddr(args.listen!);

  if (args.reset) {
    const useTls = !!args.tls && !args['no-tls'];
    const username = args.username || process.env.TMUX_WEB_USERNAME || userInfo().username;
    const password = args.password || process.env.TMUX_WEB_PASSWORD;
    const noAuth = !!args['no-auth'];
    return { config: null, host, port, reset: true, resetTls: useTls, resetAuth: noAuth ? undefined : { username, password } };
  }

  const authEnabled = !args['no-auth'];
  const username = args.username || process.env.TMUX_WEB_USERNAME || userInfo().username;
  const password = args.password || process.env.TMUX_WEB_PASSWORD;

  const rawAllowIps = args['allow-ip'] as string[];
  const allowedIps = new Set<string>(['127.0.0.1', '::1', ...rawAllowIps]);

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
  };

  return { config, host, port };
}

export function warnIfDangerousOriginConfig(
  cfg: Pick<ServerConfig, 'allowedIps' | 'allowedOrigins'>,
): void {
  const hasWildcard = cfg.allowedOrigins.some(e => e === '*');
  if (!hasWildcard) return;
  const hasNonLoopback = [...cfg.allowedIps].some(ip => !LOCALHOST_IPS.has(ip));
  if (!hasNonLoopback) return;
  console.error(
    'tmux-web: warning: --allow-origin * with non-loopback --allow-ip re-opens DNS rebinding;\n'
    + '  prefer listing explicit origins.',
  );
}

/** Extract the embedded tmux binary to a stable per-user cache path and
 *  return that path, or null if no binary was bundled.
 *
 *  Bun's `with { type: "file" }` gives us an already-extracted path, but
 *  whether it re-extracts on every invocation is an implementation detail we
 *  can't rely on. We keep our own cached copy and only replace it when the
 *  source differs (checked by size and mtime), so the common path is just two
 *  stat(2) calls with no disk writes. */
function resolveEmbeddedTmux(): string | null {
  const src = embeddedAssets['dist/bin/tmux'];
  if (!src) return null;

  const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
  const dir = process.env.XDG_RUNTIME_DIR && fs.existsSync(process.env.XDG_RUNTIME_DIR)
    ? path.join(process.env.XDG_RUNTIME_DIR, 'tmux-web')
    : path.join(tmpdir(), `tmux-web-${uid}`);
  const dest = path.join(dir, 'tmux');

  try {
    const srcStat = fs.statSync(src);
    let stale = true;
    try {
      const destStat = fs.statSync(dest);
      stale = destStat.size !== srcStat.size || destStat.mtimeMs !== srcStat.mtimeMs;
    } catch { /* dest absent — first run */ }

    if (stale) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      // Bun compiles `with { type: "file" }` imports to paths under
      // `/$bunfs/…` — a virtual FS that is read-only via Bun-aware APIs.
      // `fs.copyFileSync` does NOT understand bunfs and fails with ENOENT,
      // so round-trip through readFileSync + writeFileSync (both bunfs-
      // aware) to get the bytes out.
      fs.writeFileSync(dest, fs.readFileSync(src), { mode: 0o755 });
      // Stamp dest with src's mtime so the comparison is stable on the next run.
      fs.utimesSync(dest, srcStat.atime, srcStat.mtime);
    }
    return dest;
  } catch {
    return null;
  }
}

/** Find the first `tmux` in $PATH that is not our own executable. */
function findTmuxInPath(): string | null {
  let selfReal: string;
  try { selfReal = fs.realpathSync(process.execPath); } catch { selfReal = process.execPath; }
  for (const dir of (process.env.PATH ?? '').split(':')) {
    const candidate = path.join(dir, 'tmux');
    try {
      if (fs.realpathSync(candidate) !== selfReal) return candidate;
    } catch { /* not found or inaccessible */ }
  }
  return null;
}

// Options that consume the next token as their value (no = form).
const STRING_OPTS = new Set([
  '--listen', '-l', '--allow-ip', '-i', '--allow-origin', '-o',
  '--username', '-u', '--password', '-p',
  '--tls-cert', '--tls-key', '--tmux', '--tmux-conf', '--themes-dir', '--theme',
]);

/** Return the index of a bare `tmux` positional in args (skipping option values). */
function findTmuxSubcommandIndex(args: string[]): number {
  let skipNext = false;
  for (let i = 0; i < args.length; i++) {
    if (skipNext) { skipNext = false; continue; }
    const arg = args[i]!;
    if (arg === 'tmux') return i;
    if (arg.startsWith('-') && !arg.includes('=') && STRING_OPTS.has(arg)) skipNext = true;
  }
  return -1;
}

/** Extract the value of --tmux / --tmux=<path> from a slice of args. */
function extractTmuxBinArg(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--tmux' && i + 1 < args.length) return args[i + 1];
    if (args[i]?.startsWith('--tmux=')) return args[i]!.slice('--tmux='.length);
  }
}

async function startServer() {
  // "tmux" passthrough subcommand: `tmux-web [--tmux /alt/bin] tmux [tmux-args…]`
  // Everything after the bare `tmux` word is forwarded to the tmux binary.
  // --tmux before the subcommand selects which binary; otherwise bundled → PATH.
  const rawArgs = process.argv.slice(2);
  const tmuxSubIdx = findTmuxSubcommandIndex(rawArgs);
  if (tmuxSubIdx !== -1) {
    const forwardArgs = rawArgs.slice(tmuxSubIdx + 1);
    const explicitBin = extractTmuxBinArg(rawArgs.slice(0, tmuxSubIdx));
    const tmuxBin = explicitBin ?? resolveEmbeddedTmux() ?? findTmuxInPath();
    if (!tmuxBin) {
      console.error('tmux-web: cannot find a tmux binary to proxy to');
      process.exit(1);
    }
    const result = Bun.spawnSync([tmuxBin, ...forwardArgs], { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' });
    process.exit(result.exitCode ?? 1);
  }

  // Check before parseConfig so we can detect CLI password usage before it's
  // merged into config (env var vs CLI flag indistinguishable afterwards).
  const argvHasPassword = process.argv.some(
    a => a === '--password' || a === '-p' || a.startsWith('--password=') || a.startsWith('-p='),
  );

  const { config, host, port, help, version, reset, resetTls, resetAuth } = parseConfig(process.argv.slice(2));

  if (version) {
    console.log(`tmux-web ${VERSION}`);
    process.exit(0);
  }

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
      --tmux <path>            Path to tmux executable (default: bundled binary, or 'tmux' in PATH)
      --tmux-conf <path>       Alternative tmux.conf to load instead of user default
      --themes-dir <path>      User theme-pack directory override
      --test                   Test mode: use cat PTY, bypass IP/Origin allowlists
      --reset                  Delete saved settings and restart running instances
  -d, --debug                  Log debug messages to stderr
  -V, --version                Print version and exit
  -h, --help                   Show this help`);
    process.exit(0);
  }

  if (reset) {
    const xdgConfigHome = process.env.XDG_CONFIG_HOME || path.join(process.env.HOME ?? '', '.config');
    const sessionsPath = process.env.TMUX_WEB_SESSIONS_FILE
      ?? path.join(xdgConfigHome, 'tmux-web', 'sessions.json');
    try {
      fs.unlinkSync(sessionsPath);
      console.log(`Deleted ${sessionsPath}`);
    } catch (err: any) {
      if (err?.code === 'ENOENT') console.log('No saved settings to reset.');
      else throw err;
    }
    const scheme = resetTls ? 'https' : 'http';
    const connectHost = (host === '0.0.0.0' || host === '::') ? '127.0.0.1' : host;
    const url = `${scheme}://${connectHost}:${port}/api/exit?action=restart`;
    const headers: Record<string, string> = {};
    if (resetAuth?.password) {
      headers['Authorization'] = 'Basic ' + btoa(`${resetAuth.username}:${resetAuth.password}`);
    }
    try {
      await fetch(url, { method: 'POST', headers, tls: { rejectUnauthorized: false } } as any);
      console.log(`Sent exit to ${url} — process manager will restart it.`);
    } catch {
      console.log(`No running instance at ${connectHost}:${port} (or not reachable).`);
    }
    process.exit(0);
  }

  if (!config) {
    process.exit(1);
  }

  if (config.auth.enabled && !config.auth.password) {
    console.error('Error: --password or $TMUX_WEB_PASSWORD is required unless --no-auth is used.');
    process.exit(1);
  }

  if (config.auth.enabled && argvHasPassword) {
    console.error(
      'tmux-web: warning: --password is visible in ps/proc/cmdline; prefer $TMUX_WEB_PASSWORD.',
    );
    // Best-effort scrub of argv. Does not change /proc/<pid>/cmdline but limits
    // in-process inspection after startup.
    for (let i = 0; i < process.argv.length; i++) {
      if (process.argv[i] === '--password' || process.argv[i] === '-p') {
        if (i + 1 < process.argv.length) process.argv[i + 1] = '***';
      } else if (process.argv[i]?.startsWith('--password=')) {
        process.argv[i] = '--password=***';
      } else if (process.argv[i]?.startsWith('-p=')) {
        process.argv[i] = '-p=***';
      }
    }
  }

  warnIfDangerousOriginConfig(config);

  // If --tmux was not given explicitly, prefer the bundled static binary
  // embedded at compile time over whatever 'tmux' resolves to in PATH.
  const explicitTmux = process.argv.slice(2).some(
    a => a === '--tmux' || a.startsWith('--tmux='),
  );
  if (!explicitTmux) {
    const resolved = resolveEmbeddedTmux();
    if (resolved) config.tmuxBin = resolved;
  }

  // Fail early if the configured tmux binary isn't runnable. Otherwise
  // the first WebSocket connection tries to spawn it and the user just
  // sees a dead terminal. Test mode uses a `cat` PTY and never touches
  // tmux, so we skip the check there (and the release-workflow
  // vendor-xterm verification relies on that).
  if (!config.testMode) {
    try {
      const r = Bun.spawnSync([config.tmuxBin, '-V'], { stdout: 'pipe', stderr: 'pipe' });
      if (!r.success) {
        console.error(`Error: tmux command '${config.tmuxBin}' exited with status ${r.exitCode}.`);
        process.exit(1);
      }
    } catch (err) {
      console.error(`Error: tmux command '${config.tmuxBin}' not found in $PATH (${(err as Error).message}).`);
      console.error(`Install tmux or pass --tmux <path> to point at a specific binary.`);
      process.exit(1);
    }
  }

  const isCompiled = !process.execPath.endsWith('bun') && !process.execPath.endsWith('bun.exe');
  let projectRoot = isCompiled ? path.dirname(process.execPath) : path.resolve(import.meta.dir, '../..');
  const xdgConfigHome = process.env.XDG_CONFIG_HOME || path.join(process.env.HOME ?? '', '.config');
  const configDir = path.join(xdgConfigHome, 'tmux-web');
  const themesUserDir = config.themesDir
    ?? path.join(configDir, 'themes');
  const sessionsStorePath = process.env.TMUX_WEB_SESSIONS_FILE
    ?? path.join(configDir, 'sessions.json');

  const tmuxConfPath = path.join(projectRoot, 'tmux.conf');
  const htmlTemplatePath = path.join(projectRoot, 'src/client/index.html');
  const distDir = path.join(projectRoot, 'dist');
  // Hard override for tests: TMUX_WEB_BUNDLED_THEMES_DIR lets the e2e
  // suite swap the real bundled themes for a stable fixture pack so
  // renaming a real theme doesn't cascade failures through every test
  // that happened to mention "Default" / "Gruvbox Dark" / "Nord" etc.
  const themesBundledDir = process.env.TMUX_WEB_BUNDLED_THEMES_DIR
    ?? path.join(projectRoot, 'themes');

  let htmlTemplate: string;
  const embeddedHtmlPath = embeddedAssets['src/client/index.html'];
  if (embeddedHtmlPath) {
    htmlTemplate = await Bun.file(embeddedHtmlPath).text();
  } else {
    htmlTemplate = fs.readFileSync(htmlTemplatePath, 'utf-8');
  }

  let effectiveTmuxConfPath = tmuxConfPath;
  const embeddedTmuxConfPath = embeddedAssets['tmux.conf'];
  let baseTmuxConfContent = '';

  if (embeddedTmuxConfPath) {
    baseTmuxConfContent = await Bun.file(embeddedTmuxConfPath).text();
  } else if (fs.existsSync(tmuxConfPath)) {
    baseTmuxConfContent = fs.readFileSync(tmuxConfPath, 'utf-8');
  } else if (isCompiled) {
    const fallbacks = [
      '/usr/local/share/tmux-web',
      '/usr/share/tmux-web',
      path.join(path.dirname(projectRoot), 'share/tmux-web'),
    ];
    for (const fallback of fallbacks) {
      const p = path.join(fallback, 'tmux.conf');
      if (fs.existsSync(p)) {
        baseTmuxConfContent = fs.readFileSync(p, 'utf-8');
        projectRoot = fallback;
        break;
      }
    }
  }

  if (embeddedTmuxConfPath || config.tmuxConf) {
    if (config.tmuxConf) {
      baseTmuxConfContent = baseTmuxConfContent.replace(/^source-file -q .*$/gm, '');
      baseTmuxConfContent += `\nsource-file -q ${config.tmuxConf}\n`;
    }
    // Stable materialised location so we don't litter /tmp with per-start
    // timestamped copies. One tmux-web process per user is the normal
    // case; two racing writes of the same content are fine (deterministic
    // output + rename would require more plumbing than it's worth).
    const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
    const runtimeBase = process.env.XDG_RUNTIME_DIR && fs.existsSync(process.env.XDG_RUNTIME_DIR)
      ? path.join(process.env.XDG_RUNTIME_DIR, 'tmux-web')
      : path.join(tmpdir(), `tmux-web-${uid}`);
    fs.mkdirSync(runtimeBase, { recursive: true, mode: 0o700 });
    const confPath = path.join(runtimeBase, 'tmux.conf');
    fs.writeFileSync(confPath, baseTmuxConfContent);
    effectiveTmuxConfPath = confPath;

    // If a tmux server is already running (we survived a tmux-web
    // restart), push the freshly-materialised config into it so users
    // see config edits without having to kill their sessions. No-op
    // when no server is up — the subsequent `tmux new-session -A` in
    // ws.ts will boot the server and read the config at that point.
    try {
      const probe = Bun.spawnSync([config.tmuxBin, 'list-sessions', '-F', ''], {
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      if (probe.exitCode === 0) {
        Bun.spawnSync([config.tmuxBin, 'source-file', confPath], {
          stdio: ['ignore', 'ignore', 'ignore'],
        });
      }
    } catch { /* best-effort */ }
  } else if (isCompiled && !fs.existsSync(tmuxConfPath)) {
    effectiveTmuxConfPath = path.join(projectRoot, 'tmux.conf');
  }

  const dropStorage = defaultDropStorage();

  const tmuxControl = config.testMode
    ? null
    : createTmuxControl({ tmuxBin: config.tmuxBin, tmuxConfPath: effectiveTmuxConfPath });

  const handler = await createHttpHandler({
    config,
    htmlTemplate,
    distDir,
    themesUserDir,
    themesBundledDir,
    projectRoot,
    isCompiled,
    sessionsStorePath,
    dropStorage,
    tmuxControl: tmuxControl ?? createNullTmuxControl(),
  });

  let tlsOpts: { cert: string; key: string } | undefined;
  if (config.tls) {
    if (config.tlsCert && config.tlsKey) {
      tlsOpts = {
        cert: fs.readFileSync(config.tlsCert, 'utf-8'),
        key: fs.readFileSync(config.tlsKey, 'utf-8'),
      };
    } else {
      // Self-signed path: we shell out to `openssl req`. Fail early
      // with a clear message instead of a cryptic ENOENT trace.
      try {
        const r = Bun.spawnSync(['openssl', 'version'], { stdout: 'pipe', stderr: 'pipe' });
        if (!r.success) throw new Error(`exited with status ${r.exitCode}`);
      } catch (err) {
        console.error(`Error: openssl not found in $PATH (${(err as Error).message}).`);
        console.error(`Install openssl, pass --tls-cert / --tls-key to use your own certificate, or disable TLS with --no-tls.`);
        process.exit(1);
      }
      tlsOpts = generateSelfSignedCert(configDir);
    }
  }

  const ws = createWsHandlers({
    config,
    tmuxConfPath: effectiveTmuxConfPath,
    sessionsStorePath,
    tmuxControl: tmuxControl ?? createNullTmuxControl(),
  });

  // Cleanup on every termination path. Without SIGTERM/SIGINT handlers,
  // a Ctrl-C of the dev server (or `systemctl restart`) leaves every
  // `tmux -C attach-session` child alive (re-parented to systemd / pid 1).
  // Each surviving control client stays attached to its tmux session, and
  // tmux serialises broadcasts across all attached clients — accumulated
  // orphans turn each subsequent session attach into a multi-second
  // operation that the user sees as a slow session switch.
  let cleanupRan = false;
  const runCleanup = (): void => {
    if (cleanupRan) return;
    cleanupRan = true;
    try { ws.close(); } catch { /* best-effort */ }
    try { void tmuxControl?.close(); } catch { /* best-effort */ }
    try { cleanupDrops(dropStorage); } catch { /* best-effort */ }
  };
  process.on('exit', runCleanup);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(sig, () => { runCleanup(); process.exit(0); });
  }

  const server = Bun.serve<WsData, never>({
    hostname: host,
    port,
    tls: tlsOpts,
    fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname.startsWith('/ws') || req.headers.get('upgrade')?.toLowerCase() === 'websocket') {
        const rejected = ws.upgrade(req, srv);
        if (rejected) return rejected;
        return undefined;
      }
      return handler(req, srv);
    },
    error(err) {
      console.error('[http-error]', err);
      return new Response('Internal Server Error', { status: 500 });
    },
    websocket: ws.websocket,
  });

  const scheme = config.tls ? 'https' : 'http';
  console.log(`tmux-web listening on ${scheme}://${server.hostname}:${server.port}`);
}

if (import.meta.main) {
  // When invoked as plain "tmux" (symlink/rename), proxy to the bundled tmux
  // binary unless the first argument is "web", which means run tmux-web.
  const isCompiled = !process.execPath.endsWith('bun') && !process.execPath.endsWith('bun.exe');
  const selfName = path.basename(isCompiled ? process.execPath : (process.argv[1] ?? process.execPath));
  if (selfName === 'tmux') {
    const args = process.argv.slice(2);
    if (args[0] !== 'web') {
      const tmuxBin = resolveEmbeddedTmux() ?? findTmuxInPath();
      if (!tmuxBin) {
        console.error('tmux-web: cannot find a tmux binary to proxy to');
        process.exit(1);
      }
      const result = Bun.spawnSync([tmuxBin, ...args], { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' });
      process.exit(result.exitCode ?? 1);
    }
    // Strip the "web" subcommand so the rest of argv looks like tmux-web was called directly.
    process.argv.splice(2, 1);
  }

  startServer().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
