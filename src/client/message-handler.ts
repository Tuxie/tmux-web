import type { ScrollbarState, SessionInfo, WindowInfo } from '../shared/types.js';
import { extractTTMessages } from './protocol.js';

export interface HandleServerDataOptions {
  adapter: { write(data: string): void };
  topbar: {
    updateSession?(session: string): void;
    updateSessions?(sessions: SessionInfo[]): void;
    updateWindows?(windows: WindowInfo[]): void;
    updateTitle?(title: string): void;
    updateTitles?(titles: Record<string, string>): void;
  };
  onClipboard?(base64: string): void;
  onClipboardReadRequest?(req: { reqId: string }): void;
  onClipboardPrompt?(prompt: { reqId: string; exePath: string | null; commandName: string | null }): void;
  onDropsChanged?(): void;
  onPtyExit?(): void;
  onScrollbar?(state: ScrollbarState): void;
}

export function handleServerData(data: string, opts: HandleServerDataOptions): void {
  const { terminalData, messages } = extractTTMessages(data);
  if (terminalData) opts.adapter.write(terminalData);

  for (const msg of messages) {
    if (msg.clipboard) opts.onClipboard?.(msg.clipboard);
    if (msg.session) opts.topbar.updateSession?.(msg.session);
    if (msg.sessions) opts.topbar.updateSessions?.(msg.sessions);
    if (msg.windows) opts.topbar.updateWindows?.(msg.windows);
    if (msg.title !== undefined) opts.topbar.updateTitle?.(String(msg.title ?? ''));
    if (msg.titles) opts.topbar.updateTitles?.(msg.titles);
    if (msg.clipboardReadRequest) opts.onClipboardReadRequest?.(msg.clipboardReadRequest);
    if (msg.clipboardPrompt) opts.onClipboardPrompt?.(msg.clipboardPrompt);
    if (msg.dropsChanged) opts.onDropsChanged?.();
    if (msg.ptyExit) opts.onPtyExit?.();
    if (msg.scrollbar) opts.onScrollbar?.(msg.scrollbar);
  }
}
