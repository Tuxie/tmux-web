function encodeBasicAuth(userinfo: string): string {
  const colon = userinfo.indexOf(':');
  const username = colon >= 0 ? userinfo.slice(0, colon) : userinfo;
  const password = colon >= 0 ? userinfo.slice(colon + 1) : '';
  return btoa(`${decodeURIComponent(username)}:${decodeURIComponent(password)}`);
}

function requestUrl(input: RequestInfo | URL): string {
  if (input instanceof Request) return input.url;
  return String(input);
}

export function makeAuthenticatedFetch(
  baseFetch: typeof fetch,
  basicAuthUserinfo: string | undefined,
  loc: Pick<Location, 'href' | 'origin'>,
): typeof fetch {
  if (!basicAuthUserinfo) return baseFetch;
  const authHeader = `Basic ${encodeBasicAuth(basicAuthUserinfo)}`;

  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(requestUrl(input), loc.href);
    if (url.origin !== loc.origin) return baseFetch(input, init);

    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (!headers.has('Authorization')) headers.set('Authorization', authHeader);

    return baseFetch(input, { ...init, headers });
  }) as typeof fetch;
}

export function installAuthenticatedFetch(basicAuthUserinfo: string | undefined): void {
  if (!basicAuthUserinfo) return;
  window.fetch = makeAuthenticatedFetch(window.fetch.bind(window), basicAuthUserinfo, window.location);
}
