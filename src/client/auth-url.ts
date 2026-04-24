import type { ClientConfig } from '../shared/types.js';

type LocationLike = Pick<Location, 'href' | 'origin'>;

function currentConfig(): ClientConfig | undefined {
  return typeof window === 'undefined' ? undefined : window.__TMUX_WEB_CONFIG;
}

export function withClientAuth(
  url: string,
  clientAuthToken = currentConfig()?.clientAuthToken,
  loc?: LocationLike,
): string {
  if (!clientAuthToken) return url;
  const location = loc ?? (typeof window === 'undefined' ? undefined : window.location);
  if (!location) return url;

  const parsed = new URL(url, location.href);
  if (parsed.origin !== location.origin) return url;

  parsed.searchParams.set('tw_auth', clientAuthToken);
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
