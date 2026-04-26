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

const SESSIONS_ARGS = ['list-sessions', '-F', '#{session_id}\t#{session_name}'] as const;

function windowsArgs(session: string): readonly string[] {
  return ['list-windows', '-t', session, '-F', '#{window_index}\t#{window_name}\t#{window_active}'];
}

function paneTitleArgs(session: string): readonly string[] {
  return ['display-message', '-t', session, '-p', '#{pane_title}'];
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
    const [rawId, ...rest] = line.split('\t');
    return { id: (rawId ?? '').replace(/^\$/, ''), name: rest.join('\t') };
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
