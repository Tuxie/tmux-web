import { withClientAuth } from './auth-url.js';

export function clientLog(message: string): void {
  try {
    const url = withClientAuth(`/api/client-log?message=${encodeURIComponent(message)}`);
    const img = new Image();
    img.src = url;
  } catch {
    // Diagnostic-only path.
  }
}
