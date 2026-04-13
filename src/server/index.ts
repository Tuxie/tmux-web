import fs from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';
import { parseArgs } from 'util';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { createHttpHandler } from './http.js';
import { createWsServer } from './ws.js';
import { generateSelfSignedCert } from './tls.js';
import type { ServerConfig, TerminalBackend } from '../shared/types.js';
import { DEFAULT_HOST, DEFAULT_PORT, DEFAULT_TERMINAL } from '../shared/constants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const { values: args } = parseArgs({
  options: {
    listen:       { type: 'string',  short: 'l', default: `${DEFAULT_HOST}:${DEFAULT_PORT}` },
    terminal:     { type: 'string',  default: DEFAULT_TERMINAL },
    'allow-ip':   { type: 'string',  multiple: true, default: [] as string[] },
    tls:          { type: 'boolean', default: false },
    'tls-cert':   { type: 'string' },
    'tls-key':    { type: 'string' },
    test:         { type: 'boolean', short: 't', default: false },
    debug:        { type: 'boolean', short: 'd', default: false },
    help:         { type: 'boolean', short: 'h', default: false },
  },
  strict: true,
});

if (args.help) {
  console.log(`Usage: tmux-web [options]

Options:
  -l, --listen <host:port>     Address to listen on (default: ${DEFAULT_HOST}:${DEFAULT_PORT})
      --terminal <backend>     Terminal backend: ghostty, xterm, xterm-dev (default: ghostty)
      --allow-ip <ip>          Allow IP address (repeatable; localhost always allowed)
      --tls                    Enable HTTPS with self-signed certificate
      --tls-cert <path>        TLS certificate file (use with --tls-key)
      --tls-key <path>         TLS private key file (use with --tls-cert)
  -t, --test                   Test mode: use cat PTY, bypass IP allowlist
  -d, --debug                  Log debug messages to stderr
  -h, --help                   Show this help`);
  process.exit(0);
}

function parseListenAddr(addr: string): { host: string; port: number } {
  const ipv6 = addr.match(/^\[(.+)\]:(\d+)$/);
  if (ipv6) return { host: ipv6[1]!, port: Number(ipv6[2]!) };
  const i = addr.lastIndexOf(':');
  if (i < 0) return { host: DEFAULT_HOST, port: Number(addr) };
  return { host: addr.slice(0, i), port: Number(addr.slice(i + 1)) };
}

const { host, port } = parseListenAddr(args.listen!);

const config: ServerConfig = {
  host,
  port,
  terminal: (args.terminal as TerminalBackend) || DEFAULT_TERMINAL,
  allowedIps: new Set(args['allow-ip'] as string[]),
  tls: !!args.tls,
  tlsCert: args['tls-cert'] as string | undefined,
  tlsKey: args['tls-key'] as string | undefined,
  testMode: !!args.test,
  debug: !!args.debug,
};

// Resolve paths — detect compiled Bun binary vs dev mode
const isCompiled = !process.execPath.endsWith('bun') && !process.execPath.endsWith('bun.exe');
// In dev: import.meta.dir = /src/tmux-web/src/server → projectRoot = /src/tmux-web
// In compiled binary: look for assets next to the binary, fallback to /usr/local/share/tmux-web
let projectRoot = isCompiled ? path.dirname(process.execPath) : path.resolve(import.meta.dir, '../..');

if (isCompiled && !fs.existsSync(path.join(projectRoot, 'tmux.conf'))) {
  const fallbacks = [
    '/usr/local/share/tmux-web',
    '/usr/share/tmux-web',
    path.join(path.dirname(projectRoot), 'share/tmux-web'),
  ];
  for (const fallback of fallbacks) {
    if (fs.existsSync(path.join(fallback, 'tmux.conf'))) {
      projectRoot = fallback;
      break;
    }
  }
}

const tmuxConfPath = path.join(projectRoot, 'tmux.conf');
const htmlTemplatePath = path.join(projectRoot, 'src/client/index.html');
const distDir = path.join(projectRoot, 'dist');
const fontsDir = path.join(projectRoot, 'fonts');

let ghosttyWasmPath: string | undefined;
let ghosttyDistDir: string | undefined;
// Always try to set up ghostty-web support, since clients can dynamically switch to ghostty
// via the ?terminal=ghostty query parameter, regardless of the server's default terminal.
try {
  const ghosttyRoot = path.dirname(require.resolve('ghostty-web'));
  ghosttyDistDir = ghosttyRoot; // ghostty-web/dist/
  ghosttyWasmPath = path.join(path.dirname(ghosttyRoot), 'ghostty-vt.wasm');
} catch { /* ghostty-web not installed */ }

const htmlTemplate = fs.readFileSync(htmlTemplatePath, 'utf-8');

const handler = createHttpHandler({
  config,
  htmlTemplate,
  distDir,
  fontsDir,
  projectRoot,
  ghosttyDistDir,
  ghosttyWasmPath,
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

createWsServer(server, { config, tmuxConfPath });

const scheme = config.tls ? 'https' : 'http';
server.listen(port, host, () => {
  console.log(`tmux-web listening on ${scheme}://${host}:${port} (terminal: ${config.terminal})`);
});
