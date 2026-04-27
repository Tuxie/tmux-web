/* Centralised parsers for the three tmux listing commands tmux-web fans
 * out per session refresh:
 *   - `list-sessions -F '#{session_id}\t#{session_name}'`
 *   - `list-windows  -t <s> -F '#{window_index}\t#{window_name}\t#{window_active}'`
 *   - `display-message -t <s> -p '#{pane_title}'`
 *
 * Six near-identical inline copies of these parsers used to live across
 * `http.ts` and `ws.ts`; this module is the single home so the wire
 * format and tab-separator decision (v1.7.0) cannot drift.
 *
 * Each helper accepts a `preferControl` flag:
 *   - true  → try `tmuxControl.run` first, fall back to `execFileAsync`.
 *             Used by the WS-attached path where a live control client
 *             exists.
 *   - false → skip control; go straight to `execFileAsync`. Used by
 *             startup / probe paths that run before the control client
 *             is attached.
 */

import type { SessionInfo, WindowInfo } from '../shared/types.js';
import type { TmuxControl } from './tmux-control.js';
import { execFileAsync } from './exec.js';

export interface TmuxListingsDeps {
  tmuxControl: TmuxControl;
  tmuxBin: string;
  preferControl: boolean;
}

const SESSIONS_ARGS = ['list-sessions', '-F', '#{session_id}\t#{session_name}\t#{session_windows}'] as const;

function windowsArgs(session: string): readonly string[] {
  return ['list-windows', '-t', session, '-F', '#{window_index}\t#{window_name}\t#{window_active}'];
}

function paneTitleArgs(session: string): readonly string[] {
  return ['display-message', '-t', session, '-p', '#{pane_title}'];
}

/* Format string for the per-window title subscription. `#{W:fmt}`
 * iterates over every window in the current session; inside,
 * `#{window_index}`, `#{window_active}`, and `#{pane_title}` resolve
 * to that window's index, its 0/1 active flag, and its active-pane
 * title. The unit-separator (`\x1f`) ends each window's record so the
 * receiver can split unambiguously even if a title happens to contain
 * `\t`. The active-flag inclusion is what makes tmux-side window
 * switches (`prefix n`/`prefix p`) re-fire the subscription — without
 * it, switching the active window in a session leaves the
 * idx-and-titles concatenation unchanged and tmux suppresses the
 * notification. */
export const TITLES_FORMAT = '#{W:#{window_index}\t#{window_active}\t#{pane_title}\x1f}';

export function buildTitlesSubscriptionArgs(name: string): string[] {
  return ['refresh-client', '-B', `${name}::${TITLES_FORMAT}`];
}

export function buildTitlesUnsubscribeArgs(name: string): string[] {
  return ['refresh-client', '-B', name];
}

export function buildTitlesFetchArgs(session: string): string[] {
  return ['display-message', '-p', '-t', session, '-F', TITLES_FORMAT];
}

/** Parse a `#{W:idx\tactive\ttitle\x1f}` subscription value into a
 *  per-window title map. The active flag is consumed only as a
 *  subscription-fire trigger and discarded after parsing — clients
 *  read the active flag from the canonical windows list. Empty /
 *  malformed records are silently dropped; titles may contain tabs
 *  (we only split on the first two). */
export function parseTitlesValue(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const entry of raw.split('\x1f')) {
    if (!entry) continue;
    const firstTab = entry.indexOf('\t');
    if (firstTab < 0) continue;
    const idx = entry.slice(0, firstTab);
    if (!idx) continue;
    const rest = entry.slice(firstTab + 1);
    const secondTab = rest.indexOf('\t');
    if (secondTab < 0) continue;
    /* rest.slice(0, secondTab) is `#{window_active}` ("0" or "1"); we
     * don't currently need it on the client. */
    out[idx] = rest.slice(secondTab + 1);
  }
  return out;
}

async function runListing(deps: TmuxListingsDeps, args: readonly string[]): Promise<string | null> {
  if (deps.preferControl) {
    try {
      return await deps.tmuxControl.run(args);
    } catch {
      // fall through to execFileAsync
    }
  }
  try {
    const { stdout } = await execFileAsync(deps.tmuxBin, args);
    return stdout;
  } catch {
    return null;
  }
}

/** Parse `#{session_id}\t#{session_name}` lines into structured records.
 *  Strips the leading `$` from the tmux internal session id so the client
 *  can render it like window ids. */
export function parseSessionLines(stdout: string): SessionInfo[] {
  return stdout.trim().split('\n').filter(Boolean).map((line) => {
    const parts = line.split('\t');
    const rawId = parts[0] ?? '';
    /* `#{session_windows}` is the trailing tab-separated field. The
     *  middle field is `#{session_name}`, which may itself contain tabs
     *  if a user renames a session to one — so we pop the trailing
     *  count off and re-join the rest as the name (matches the prior
     *  `rest.join('\t')` behaviour for backward-compatible names). */
    const winsRaw = parts.length >= 3 ? parts[parts.length - 1] : '';
    const middle = parts.length >= 3 ? parts.slice(1, -1) : parts.slice(1);
    const windows = /^\d+$/.test(winsRaw) ? Number(winsRaw) : undefined;
    const info: SessionInfo = {
      id: rawId.replace(/^\$/, ''),
      name: middle.join('\t'),
    };
    if (windows !== undefined) info.windows = windows;
    return info;
  });
}

/** Parse `#{window_index}\t#{window_name}\t#{window_active}` lines. */
export function parseWindowLines(stdout: string): WindowInfo[] {
  return stdout.trim().split('\n').filter(Boolean).map((line) => {
    const [index, name, active] = line.split('\t');
    return { index: index ?? '', name: name ?? '', active: active === '1' };
  });
}

export async function listSessionsViaTmux(deps: TmuxListingsDeps): Promise<SessionInfo[] | null> {
  const stdout = await runListing(deps, SESSIONS_ARGS);
  if (stdout === null) return null;
  const sessions = parseSessionLines(stdout);
  return sessions.length > 0 ? sessions : null;
}

export async function listWindowsViaTmux(
  session: string,
  deps: TmuxListingsDeps,
): Promise<WindowInfo[] | null> {
  const stdout = await runListing(deps, windowsArgs(session));
  if (stdout === null) return null;
  const windows = parseWindowLines(stdout);
  return windows.length > 0 ? windows : null;
}

export async function getPaneTitleViaTmux(
  session: string,
  deps: TmuxListingsDeps,
): Promise<string | undefined> {
  const stdout = await runListing(deps, paneTitleArgs(session));
  if (stdout === null) return undefined;
  return stdout.trim();
}
