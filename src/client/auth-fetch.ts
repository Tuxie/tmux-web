import { withClientAuth } from './auth-url.js';

function encodeBasicAuth(userinfo: string): string {
  const colon = userinfo.indexOf(':');
  const username = colon >= 0 ? userinfo.slice(0, colon) : userinfo;
  const password = colon >= 0 ? userinfo.slice(colon + 1) : '';
  return btoa(`${decodeURIComponent(username)}:${decodeURIComponent(password)}`);
}

function isRequest(input: RequestInfo | URL): input is Request {
  return typeof Request !== 'undefined' && input instanceof Request;
}

function requestUrl(input: RequestInfo | URL): string {
  if (isRequest(input)) return input.url;
  return String(input);
}

export function makeAuthenticatedFetch(
  baseFetch: typeof fetch,
  basicAuthUserinfo: string | undefined,
  loc: Pick<Location, 'href' | 'origin'>,
  clientAuthToken?: string,
): typeof fetch {
  if (!basicAuthUserinfo && !clientAuthToken) return baseFetch;
  const authHeader = basicAuthUserinfo ? `Basic ${encodeBasicAuth(basicAuthUserinfo)}` : undefined;

  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(requestUrl(input), loc.href);
    if (url.origin !== loc.origin) return baseFetch(input, init);

    const headers = new Headers(init?.headers ?? (isRequest(input) ? input.headers : undefined));
    if (authHeader && !headers.has('Authorization')) headers.set('Authorization', authHeader);
    const nextInput = withClientAuth(requestUrl(input), clientAuthToken, loc);

    return baseFetch(isRequest(input) ? new Request(nextInput, input) : nextInput, { ...init, headers });
  }) as typeof fetch;
}

export function installAuthenticatedFetch(basicAuthUserinfo: string | undefined): void {
  const clientAuthToken = window.__TMUX_WEB_CONFIG.clientAuthToken;
  if (!basicAuthUserinfo && !clientAuthToken) return;
  window.fetch = makeAuthenticatedFetch(window.fetch.bind(window), basicAuthUserinfo, window.location, clientAuthToken);
}
