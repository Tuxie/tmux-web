import { isTmuxTermCloseWindowMessage } from '../shared/desktop-messages.js';

interface HostMessageWebview {
  on(name: string, handler: (event: unknown) => void): void;
}

interface HostMessageWindow {
  close(): void;
  webview: HostMessageWebview;
}

function hostMessageDetail(event: unknown): unknown {
  const detail = (event as { data?: { detail?: unknown } })?.data?.detail;
  if (typeof detail !== 'string') return detail;
  try {
    return JSON.parse(detail);
  } catch {
    return detail;
  }
}

export function installTmuxTermHostMessages(win: HostMessageWindow): void {
  win.webview.on('host-message', (event) => {
    if (isTmuxTermCloseWindowMessage(hostMessageDetail(event))) {
      win.close();
    }
  });
}
