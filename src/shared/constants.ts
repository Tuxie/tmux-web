/** Prefix for out-of-band server-to-client messages in WebSocket stream. */
export const TT_PREFIX = '\x00TT:';

/** Default listen port. */
export const DEFAULT_PORT = 4022;

/** Default listen host. */
export const DEFAULT_HOST = '0.0.0.0';

/** Keys handled by CSI-u forwarding: key name → CSI code. */
export const CSI_U_KEYS: Record<string, number> = {
  Enter: 13,
  Tab: 9,
  Backspace: 127,
  Escape: 27,
};

/** MIME types by file extension. */
export const MIME_TYPES: Record<string, string> = {
  '.js': 'application/javascript',
  '.cjs': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.html': 'text/html',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/sfnt',
};

/** Localhost addresses that are always allowed. */
export const LOCALHOST_IPS = new Set([
  '127.0.0.1',
  '::1',
  '::ffff:127.0.0.1',
]);
