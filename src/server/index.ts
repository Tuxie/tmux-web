import fs from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';
import { parseArgs } from 'util';
import { tmpdir, userInfo } from 'os';
import { createHttpHandler } from './http.js';
import { createWsServer } from './ws.js';
import { defaultDropStorage, cleanupAll as cleanupDrops } from './file-drop.js';
import { generateSelfSignedCert } from './tls.js';
import type { ServerConfig } from '../shared/types.js';
import { DEFAULT_HOST, DEFAULT_PORT } from '../shared/constants.js';
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

async function startServer() {
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
      --tmux <path>            Path to tmux executable (default: tmux)
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
  process.on('exit', () => { cleanupDrops(dropStorage); });

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
  });

  let server: http.Server | https.Server;

  if (config.tls) {
    let cert: string;
    let key: string;
    if (config.tlsCert && config.tlsKey) {
      cert = fs.readFileSync(config.tlsCert, 'utf-8');
      key = fs.readFileSync(config.tlsKey, 'utf-8');
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
      const generated = generateSelfSignedCert(configDir);
      cert = generated.cert;
      key = generated.key;
    }
    server = https.createServer({ cert, key }, handler);
  } else {
    server = http.createServer(handler);
  }

  createWsServer(server, {
    config,
    tmuxConfPath: effectiveTmuxConfPath,
    sessionsStorePath,
  });

  const scheme = config.tls ? 'https' : 'http';
  server.listen(port, host, () => {
    console.log(`tmux-web listening on ${scheme}://${host}:${port}`);
  });
}

if (import.meta.main) {
  startServer().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
