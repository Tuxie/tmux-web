import fs from 'fs';
import path from 'path';
import { parseArgs } from 'util';
import { homedir, tmpdir, userInfo } from 'os';
import { createHttpHandler } from './http.js';
import { createWsHandlers, type WsData } from './ws.js';
import { createTmuxControl, createNullTmuxControl } from './tmux-control.js';
import { defaultDropStorage, cleanupAll as cleanupDrops } from './file-drop.js';
import { generateSelfSignedCert } from './tls.js';
import type { ServerConfig } from '../shared/types.js';
import { DEFAULT_HOST, DEFAULT_PORT, LOCALHOST_IPS } from '../shared/constants.js';
import { parseAllowOriginFlag, canonicaliseAllowedIp } from './origin.js';
import { embeddedAssets } from './assets-embedded.js';
import { eventInputFromNodeReadable, runStdioAgent } from './stdio-agent.js';
import pkg from '../../package.json' with { type: 'json' };
import type { DropStorage } from './file-drop.js';

const VERSION: string = (pkg as { version: string }).version;
const HOME_DIR = process.env.HOME || homedir();
export const TMUX_SEARCH_DIRS = [
  path.join(HOME_DIR, 'bin'),
  path.join(HOME_DIR, '.local', 'bin'),
  '/opt/homebrew/bin',
  '/home/linuxbrew/.linuxbrew/bin',
  '/opt/local/bin',
  '/usr/local/bin',
  '/snap/bin',
];

export function appendTmuxSearchDirsToPath(existingPath: string | undefined): string {
  const seen = new Set<string>();
  const dirs: string[] = [];
  for (const dir of [
    ...(existingPath ?? '').split(path.delimiter),
    ...TMUX_SEARCH_DIRS,
  ]) {
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    dirs.push(dir);
  }
  return dirs.join(path.delimiter);
}

export interface ServerCleanupResources {
  ws: { close: () => void };
  tmuxControl?: { close: () => Promise<void> } | null;
  dropStorage: DropStorage;
  cleanupDrops?: (storage: DropStorage) => void | Promise<void>;
}

export async function runServerCleanup(resources: ServerCleanupResources): Promise<void> {
  const cleanupDropStorage = resources.cleanupDrops ?? cleanupDrops;
  try { resources.ws.close(); } catch { /* best-effort */ }
  await Promise.allSettled([
    (async () => {
      try { await resources.tmuxControl?.close(); } catch { /* best-effort */ }
    })(),
    (async () => {
      try { await cleanupDropStorage(resources.dropStorage); } catch { /* best-effort */ }
    })(),
  ]);
}

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
  stdioAgent?: boolean;
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
      'stdio-agent':  { type: 'boolean', default: false },
    },
    strict: true,
  });

  if (args.version) return { config: null, host: '', port: 0, version: true };
  if (args.help) return { config: null, host: '', port: 0, help: true };
  if (args['stdio-agent']) return { config: null, host: '', port: 0, stdioAgent: true };

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
  // Canonicalise IPv6 entries so non-canonical forms (`::0001`,
  // `0:0:0:0:0:0:0:1`) match the canonical Origin form
  // `parseOriginHeader` produces (`::1`). IPv4 entries pass through
  // unchanged. Cluster 04, finding F4 — docs/code-analysis/2026-04-26.
  const allowedIps = new Set<string>([
    '127.0.0.1',
    '::1',
    ...rawAllowIps.map(canonicaliseAllowedIp),
  ]);

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
    exposeClientAuth: process.env.TMUX_WEB_EXPOSE_CLIENT_AUTH === '1',
    clientAuthToken: process.env.TMUX_WEB_CLIENT_AUTH_TOKEN || undefined,
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

export interface ResetFetchOptionsInput {
  /** When true, build HTTPS fetch options pinned to the persisted cert.
   *  When false (plain HTTP `--reset`), TLS verification is irrelevant
   *  and we return options without a `tls` block. */
  useTls: boolean;
  /** Path to `<configDir>/tls/selfsigned.crt`. The persisted self-signed
   *  cert generated at first start. Required when `useTls` is true so we
   *  can pin verification against the running instance's certificate
   *  (closes cluster 04 finding F3 — sending Basic Auth credentials with
   *  `rejectUnauthorized: false` over HTTPS lets a stranger holding the
   *  loopback port receive the credential after the original server
   *  died). docs/code-analysis/2026-04-26. */
  certPath: string;
  /** Optional `user:pass` Basic Auth string to encode into the
   *  Authorization header. Omit for `--no-auth` setups. */
  basicAuth?: { username: string; password: string };
  /** Filesystem readers — injectable for tests. */
  existsSync?: (p: string) => boolean;
  readFileSync?: (p: string) => string;
}

export interface ResetFetchOptions {
  method: 'POST';
  headers: Record<string, string>;
  tls?: { ca: string };
}

/**
 * Build the fetch() options for `--reset`. When `useTls` is true, pins
 * verification to the persisted self-signed cert at `certPath`; throws
 * a clear error when that file is missing rather than silently falling
 * back to `rejectUnauthorized: false`. Use systemctl/SIGTERM in that
 * case — see the cluster 04 / F3 decision (docs/code-analysis/2026-04-26).
 */
export function buildResetFetchOptions(input: ResetFetchOptionsInput): ResetFetchOptions {
  const exists = input.existsSync ?? fs.existsSync;
  const readFile = input.readFileSync ?? ((p: string) => fs.readFileSync(p, 'utf-8'));

  const headers: Record<string, string> = {};
  if (input.basicAuth?.password) {
    headers['Authorization'] = 'Basic ' + btoa(`${input.basicAuth.username}:${input.basicAuth.password}`);
  }

  if (!input.useTls) {
    return { method: 'POST', headers };
  }

  if (!exists(input.certPath)) {
    throw new Error(
      `--reset cannot verify HTTPS without the persisted certificate at ${input.certPath}. `
      + `Use \`systemctl --user restart tmux-web\` or \`kill -TERM <pid>\` instead.`,
    );
  }

  const ca = readFile(input.certPath);
  return { method: 'POST', headers, tls: { ca } };
}

export interface RuntimeBaseDirOptions {
  xdgRuntimeDir?: string;
  tmpDir?: string;
  uid?: number;
  isUsableDir?: (dir: string) => boolean;
}

function isUsableRuntimeDir(dir: string): boolean {
  try {
    if (!fs.statSync(dir).isDirectory()) return false;
    fs.accessSync(dir, fs.constants.W_OK | fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveRuntimeBaseDir(opts: RuntimeBaseDirOptions = {}): string {
  const uid = opts.uid ?? (typeof process.getuid === 'function' ? process.getuid() : 0);
  const tmpBase = opts.tmpDir ?? tmpdir();
  const isUsableDir = opts.isUsableDir ?? isUsableRuntimeDir;
  const xdgRuntimeDir = opts.xdgRuntimeDir ?? process.env.XDG_RUNTIME_DIR;

  return xdgRuntimeDir && isUsableDir(xdgRuntimeDir)
    ? path.join(xdgRuntimeDir, 'tmux-web')
    : path.join(tmpBase, `tmux-web-${uid}`);
}

export interface StdioAgentLaunchOptions {
  tmuxBin: string;
  tmuxConfPath: string;
}

export interface MaterializeStdioAgentTmuxConfOptions {
  runtimeBaseDir: string;
  projectRoot: string;
  embeddedAssets?: Record<string, string>;
  existsSync?: (p: string) => boolean;
  readFileSync?: (p: string) => string;
  mkdirSync?: (p: string) => unknown;
  writeFileSync?: (p: string, content: string) => unknown;
}

export function materializeStdioAgentTmuxConf(opts: MaterializeStdioAgentTmuxConfOptions): string {
  const exists = opts.existsSync ?? fs.existsSync;
  const readFile = opts.readFileSync ?? ((p: string) => fs.readFileSync(p, 'utf-8'));
  const mkdir = opts.mkdirSync ?? ((p: string) => fs.mkdirSync(p, { recursive: true, mode: 0o700 }));
  const writeFile = opts.writeFileSync ?? ((p: string, content: string) => fs.writeFileSync(p, content));
  const runtimeConfPath = path.join(opts.runtimeBaseDir, 'tmux.conf');

  const embeddedTmuxConfPath = opts.embeddedAssets?.['tmux.conf'];
  const projectTmuxConfPath = path.join(opts.projectRoot, 'tmux.conf');
  const fallbackTmuxConfPaths = [
    '/usr/local/share/tmux-web/tmux.conf',
    '/usr/share/tmux-web/tmux.conf',
    path.join(path.dirname(opts.projectRoot), 'share/tmux-web/tmux.conf'),
  ];

  let content = '';
  if (embeddedTmuxConfPath) {
    content = readFile(embeddedTmuxConfPath);
  } else if (exists(projectTmuxConfPath)) {
    content = readFile(projectTmuxConfPath);
  } else {
    const fallback = fallbackTmuxConfPaths.find(exists);
    if (fallback) content = readFile(fallback);
  }

  mkdir(opts.runtimeBaseDir);
  writeFile(runtimeConfPath, content);
  return runtimeConfPath;
}

export function buildStdioAgentLaunchOptions(
  parsed: Pick<ConfigResult, 'stdioAgent'>,
  opts: {
    runtimeBaseDir?: string;
    projectRoot?: string;
    embeddedAssets?: Record<string, string>;
    existsSync?: (p: string) => boolean;
    readFileSync?: (p: string) => string;
    mkdirSync?: (p: string) => unknown;
    writeFileSync?: (p: string, content: string) => unknown;
  } = {},
): StdioAgentLaunchOptions | null {
  if (!parsed.stdioAgent) return null;
  const runtimeBaseDir = opts.runtimeBaseDir ?? resolveRuntimeBaseDir();
  const projectRoot = opts.projectRoot ?? path.resolve(import.meta.dir, '../..');
  return {
    tmuxBin: 'tmux',
    tmuxConfPath: materializeStdioAgentTmuxConf({
      runtimeBaseDir,
      projectRoot,
      embeddedAssets: opts.embeddedAssets ?? embeddedAssets,
      existsSync: opts.existsSync,
      readFileSync: opts.readFileSync,
      mkdirSync: opts.mkdirSync,
      writeFileSync: opts.writeFileSync,
    }),
  };
}

async function startServer() {
  process.env.PATH = appendTmuxSearchDirsToPath(process.env.PATH);

  // Check before parseConfig so we can detect CLI password usage before it's
  // merged into config (env var vs CLI flag indistinguishable afterwards).
  const argvHasPassword = process.argv.some(
    a => a === '--password' || a === '-p' || a.startsWith('--password=') || a.startsWith('-p='),
  );

  const parsedConfig = parseConfig(process.argv.slice(2));
  const { config, host, port, help, version, stdioAgent, reset, resetTls, resetAuth } = parsedConfig;

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
      --tmux <path>            Path to tmux executable (default: tmux)
      --tmux-conf <path>       Alternative tmux.conf to load instead of user default
      --themes-dir <path>      User theme-pack directory override
      --test                   Test mode: use cat PTY, bypass IP/Origin allowlists
      --stdio-agent             Run stdio remote-agent mode instead of HTTP server
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
    const certPath = path.join(xdgConfigHome, 'tmux-web', 'tls', 'selfsigned.crt');
    let fetchOptions: ResetFetchOptions;
    try {
      fetchOptions = buildResetFetchOptions({
        useTls: !!resetTls,
        certPath,
        basicAuth: resetAuth?.password
          ? { username: resetAuth.username, password: resetAuth.password }
          : undefined,
      });
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
    try {
      await fetch(url, fetchOptions as any);
      console.log(`Sent exit to ${url} — process manager will restart it.`);
    } catch {
      console.log(`No running instance at ${connectHost}:${port} (or not reachable).`);
    }
    process.exit(0);
  }

  if (stdioAgent) {
    const isCompiled = !process.execPath.endsWith('bun') && !process.execPath.endsWith('bun.exe');
    const projectRoot = isCompiled ? path.dirname(process.execPath) : path.resolve(import.meta.dir, '../..');
    const launch = buildStdioAgentLaunchOptions(parsedConfig, {
      projectRoot,
      embeddedAssets,
    });
    if (!launch) {
      process.exit(1);
    }

    const tmuxControl = createTmuxControl({
      tmuxBin: launch.tmuxBin,
      tmuxConfPath: launch.tmuxConfPath,
    });
    const agent = runStdioAgent({
      input: eventInputFromNodeReadable(process.stdin),
      write: (buf) => process.stdout.write(buf),
      tmuxControl,
      version: VERSION,
      tmuxBin: launch.tmuxBin,
      tmuxConfPath: launch.tmuxConfPath,
    });

    let cleanupRan = false;
    const cleanup = async (): Promise<void> => {
      if (cleanupRan) return;
      cleanupRan = true;
      agent.close();
      await tmuxControl.close();
    };
    for (const sig of ['SIGINT', 'SIGTERM'] as const) {
      process.on(sig, () => {
        void cleanup().finally(() => process.exit(0));
      });
    }
    process.on('exit', () => { void cleanup(); });
    return;
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
    const runtimeBase = resolveRuntimeBaseDir();
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
    : createTmuxControl({
      tmuxBin: config.tmuxBin,
      tmuxConfPath: effectiveTmuxConfPath,
      log: config.debug ? (line) => process.stderr.write(`[debug] ${line}\n`) : undefined,
    });

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
  const runCleanup = (): Promise<void> => {
    if (cleanupRan) return Promise.resolve();
    cleanupRan = true;
    return runServerCleanup({ ws, tmuxControl, dropStorage });
  };
  process.on('exit', () => { void runCleanup(); });
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(sig, () => {
      void runCleanup().finally(() => process.exit(0));
    });
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
  startServer().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
