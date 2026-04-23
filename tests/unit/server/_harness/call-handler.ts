import type { HttpHandler } from '../../../../src/server/http.ts';

/** Minimal `Bun.Server`-shape stand-in for unit tests that drive the
 *  HTTP handler directly without a real server. Only `requestIP` is
 *  consulted by the handler today; the rest are stubbed for type
 *  satisfaction. */
function fakeServer(remoteIp: string): any {
  return {
    requestIP: () => ({ address: remoteIp, family: 'IPv4', port: 0 }),
  };
}

export interface CallOpts {
  method: string;
  url: string;
  body?: string | Uint8Array | Buffer;
  headers?: Record<string, string>;
  remoteIp?: string;
}

export interface CallResult {
  status: number;
  body: string;
  headers: Headers;
}

/** Drive the handler with synthetic Request/Server objects and return a
 *  legacy-shape `{ status, body }` so existing tests don't have to adopt
 *  the Fetch API. */
export async function callHandler(handler: HttpHandler, opts: CallOpts): Promise<CallResult> {
  const headers = new Headers({ host: 'x', ...(opts.headers ?? {}) });
  const init: RequestInit = { method: opts.method, headers };
  if (opts.body !== undefined && opts.method !== 'GET' && opts.method !== 'HEAD') {
    init.body = typeof opts.body === 'string' ? opts.body : new Uint8Array(opts.body);
  }
  const req = new Request(`http://x${opts.url}`, init);
  const res = await handler(req, fakeServer(opts.remoteIp ?? '127.0.0.1'));
  const body = await res.text();
  return { status: res.status, body, headers: res.headers };
}
