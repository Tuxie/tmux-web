/**
 * Pure message router for the WS inbound channel. Given a raw frame and a
 * small piece of per-connection state (current session name + pending OSC 52
 * read requests), returns a list of `WsAction`s for the dispatcher in
 * `ws.ts` to translate into real PTY / tmux / socket calls.
 *
 * The router mutates `state.pendingReads` directly (adding `awaitingContent`,
 * deleting entries on decision/reply) so the dispatcher and the OSC 52 read
 * request path share a single source of truth.
 */

export interface PendingRead {
  selection: string;
  exePath: string | null;
  commandName: string | null;
  /** Populated when the server has already decided to allow and is
   *  awaiting the client's clipboard content for this request. */
  awaitingContent?: boolean;
}

export interface RouterState {
  currentSession: string;
  pendingReads: Map<string, PendingRead>;
}

export type WsAction =
  | { type: 'pty-write'; data: string }
  | { type: 'pty-resize'; cols: number; rows: number }
  | { type: 'colour-variant'; variant: 'dark' | 'light' }
  | { type: 'switch-session'; name: string }
  | { type: 'window'; action: string; index?: string; name?: string }
  | { type: 'session'; action: string; name?: string }
  | { type: 'clipboard-deny'; reqId: string; selection: string }
  | { type: 'clipboard-grant-persist'; reqId: string; exePath: string; allow: boolean; expiresAt: string | null; pinHash: boolean }
  | { type: 'clipboard-request-content'; reqId: string }
  | { type: 'clipboard-reply'; selection: string; base64: string };

const MAX_BASE64 = 1024 * 1024;

export function routeClientMessage(raw: string, state: RouterState): WsAction[] {
  if (!raw.startsWith('{')) return [{ type: 'pty-write', data: raw }];
  let raw2: unknown;
  try { raw2 = JSON.parse(raw); } catch { return [{ type: 'pty-write', data: raw }]; }
  // JSON.parse returns `unknown`; runtime is still validated per-branch
  // via typeof / === checks below. A `Record<string, unknown>` cast
  // gives TypeScript enough shape to typecheck the optional-chained
  // property reads without loosening everything back to `any`.
  if (raw2 === null || typeof raw2 !== 'object') {
    return [{ type: 'pty-write', data: raw }];
  }
  const parsed = raw2 as Record<string, unknown>;

  if (parsed?.type === 'resize' && typeof parsed.cols === 'number' && typeof parsed.rows === 'number') {
    return [{ type: 'pty-resize', cols: parsed.cols, rows: parsed.rows }];
  }
  if (parsed?.type === 'colour-variant' && (parsed.variant === 'dark' || parsed.variant === 'light')) {
    return [{ type: 'colour-variant', variant: parsed.variant }];
  }
  if (parsed?.type === 'switch-session' && typeof parsed.name === 'string') {
    return [{ type: 'switch-session', name: parsed.name }];
  }
  if (parsed?.type === 'window' && typeof parsed.action === 'string') {
    return [{
      type: 'window',
      action: parsed.action,
      index: typeof parsed.index === 'string' ? parsed.index : undefined,
      name: typeof parsed.name === 'string' ? parsed.name : undefined,
    }];
  }
  if (parsed?.type === 'session' && typeof parsed.action === 'string') {
    return [{
      type: 'session',
      action: parsed.action,
      name: typeof parsed.name === 'string' ? parsed.name : undefined,
    }];
  }
  if (parsed?.type === 'clipboard-decision' && typeof parsed.reqId === 'string') {
    const pending = state.pendingReads.get(parsed.reqId);
    if (!pending) return [];
    const allow = !!parsed.allow;
    const out: WsAction[] = [];
    if (parsed.persist === true && pending.exePath) {
      const expiresAt = (typeof parsed.expiresAt === 'string' || parsed.expiresAt === null) ? parsed.expiresAt : null;
      out.push({
        type: 'clipboard-grant-persist',
        reqId: parsed.reqId,
        exePath: pending.exePath,
        allow,
        expiresAt,
        pinHash: !!parsed.pinHash,
      });
    }
    if (allow) {
      pending.awaitingContent = true;
      out.push({ type: 'clipboard-request-content', reqId: parsed.reqId });
    } else {
      const sel = pending.selection;
      state.pendingReads.delete(parsed.reqId);
      out.push({ type: 'clipboard-deny', reqId: parsed.reqId, selection: sel });
    }
    return out;
  }
  if (parsed?.type === 'clipboard-read-reply' && typeof parsed.reqId === 'string') {
    const pending = state.pendingReads.get(parsed.reqId);
    if (!pending || !pending.awaitingContent) return [];
    state.pendingReads.delete(parsed.reqId);
    const base64 = typeof parsed.base64 === 'string' ? parsed.base64 : '';
    const clipped = base64.length > MAX_BASE64 ? '' : base64;
    return [{ type: 'clipboard-reply', selection: pending.selection, base64: clipped }];
  }
  return [{ type: 'pty-write', data: raw }];
}
