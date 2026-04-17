import fs from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';
import { parseArgs } from 'util';
import { tmpdir, userInfo } from 'os';
import { createHttpHandler } from './http.js';
import { createWsServer } from './ws.js';
import { generateSelfSignedCert } from './tls.js';
import type { ServerConfig } from '../shared/types.js';
import { DEFAULT_HOST, DEFAULT_PORT } from '../shared/constants.js';
import { embeddedAssets } from './assets-embedded.js';

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
}

export function parseConfig(argv: string[]): ConfigResult {
  const { values: args } = parseArgs({
    args: argv,
    options: {
      listen:       { type: 'string',  short: 'l', default: `${DEFAULT_HOST}:${DEFAULT_PORT}` },
      // Temporary compatibility alias: accept legacy --terminal callers so
      // strict arg parsing does not fail while backend selection is removed.
      terminal:     { type: 'string' },
      'allow-ip':   { type: 'string',  multiple: true, default: [] as string[] },
      username:     { type: 'string' },
      password:     { type: 'string' },
      'no-auth':    { type: 'boolean', default: false },
      tls:          { type: 'boolean', default: true },
      'no-tls':     { type: 'boolean', default: false },
      'tls-cert':   { type: 'string' },
      'tls-key':    { type: 'string' },
      'tmux':       { type: 'string',  default: 'tmux' },
      'tmux-conf':  { type: 'string' },
      'themes-dir': { type: 'string' },
      'theme':      { type: 'string' },
      test:         { type: 'boolean', short: 't', default: false },
      debug:        { type: 'boolean', short: 'd', default: false },
      help:         { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
  });

  if (args.help) return { config: null, host: '', port: 0, help: true };

  const { host, port } = parseListenAddr(args.listen!);

  const authEnabled = !args['no-auth'];
  const username = args.username || process.env.TMUX_WEB_USERNAME || userInfo().username;
  const password = args.password || process.env.TMUX_WEB_PASSWORD;

  const config: ServerConfig = {
    host,
    port,
    allowedIps: new Set(args['allow-ip'] as string[]),
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

async function startServer() {
  const { config, host, port, help } = parseConfig(process.argv.slice(2));

  if (help) {
    console.log(`Usage: tmux-web [options]

Options:
  -l, --listen <host:port>     Address to listen on (default: ${DEFAULT_HOST}:${DEFAULT_PORT})
      --allow-ip <ip>          Allow IP address (repeatable; localhost always allowed)
      --username <name>        HTTP Basic Auth username (default: $TMUX_WEB_USERNAME or current user)
      --password <pass>        HTTP Basic Auth password (default: $TMUX_WEB_PASSWORD, required)
      --no-auth                Disable HTTP Basic Auth
      --tls                    Enable HTTPS with self-signed certificate (default)
      --no-tls                 Disable HTTPS
      --tls-cert <path>        TLS certificate file (use with --tls-key)
      --tls-key <path>         TLS private key file (use with --tls-cert)
      --tmux <path>            Path to tmux executable (default: tmux)
      --tmux-conf <path>       Alternative tmux.conf to load instead of user default
      --themes-dir <path>      User theme-pack directory override
      --theme <name>           Initial theme name
  -t, --test                   Test mode: use cat PTY, bypass IP allowlist
  -d, --debug                  Log debug messages to stderr
  -h, --help                   Show this help`);
    process.exit(0);
  }

  if (!config) {
    process.exit(1);
  }

  if (config.auth.enabled && !config.auth.password) {
    console.error('Error: --password or $TMUX_WEB_PASSWORD is required unless --no-auth is used.');
    process.exit(1);
  }

  const isCompiled = !process.execPath.endsWith('bun') && !process.execPath.endsWith('bun.exe');
  let projectRoot = isCompiled ? path.dirname(process.execPath) : path.resolve(import.meta.dir, '../..');
  const configDir = path.join(process.env.HOME ?? '', '.config/tmux-web');
  const themesUserDir = config.themesDir
    ?? path.join(configDir, 'themes');
  const sessionsStorePath = process.env.TMUX_WEB_SESSIONS_FILE
    ?? path.join(configDir, 'sessions.json');

  const tmuxConfPath = path.join(projectRoot, 'tmux.conf');
  const htmlTemplatePath = path.join(projectRoot, 'src/client/index.html');
  const distDir = path.join(projectRoot, 'dist');
  const themesBundledDir = path.join(projectRoot, 'themes');

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
    const tmpPath = path.join(tmpdir(), `tmux-web-embedded-${Date.now()}.conf`);
    fs.writeFileSync(tmpPath, baseTmuxConfContent);
    effectiveTmuxConfPath = tmpPath;
    process.on('exit', () => { try { fs.unlinkSync(tmpPath); } catch {} });
  } else if (isCompiled && !fs.existsSync(tmuxConfPath)) {
    effectiveTmuxConfPath = path.join(projectRoot, 'tmux.conf');
  }

  const handler = await createHttpHandler({
    config,
    htmlTemplate,
    distDir,
    themesUserDir,
    themesBundledDir,
    projectRoot,
    isCompiled,
    sessionsStorePath,
  });

  let server: http.Server | https.Server;

  if (config.tls) {
    let cert: string;
    let key: string;
    if (config.tlsCert && config.tlsKey) {
      cert = fs.readFileSync(config.tlsCert, 'utf-8');
      key = fs.readFileSync(config.tlsKey, 'utf-8');
    } else {
      const generated = generateSelfSignedCert();
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
