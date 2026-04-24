import {
  isTmuxTermCloseWindowMessage,
  isTmuxTermTitlebarDragMessage,
  isTmuxTermToggleMaximizeMessage,
} from '../shared/desktop-messages.js';

interface HostMessageWebview {
  on(name: string, handler: (event: unknown) => void): void;
}

interface HostMessageWindow {
  close(): void;
  getFrame(): WindowFrame;
  setFrame(x: number, y: number, width: number, height: number): void;
  webview: HostMessageWebview;
}

interface WindowFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type WorkAreaProvider = (frame: WindowFrame) => WindowFrame;
export type HostMessageLogger = (message: string) => void;

function hostMessageDetail(event: unknown): unknown {
  const detail = (event as { data?: { detail?: unknown } })?.data?.detail;
  if (typeof detail !== 'string') return detail;
  try {
    return JSON.parse(detail);
  } catch {
    return detail;
  }
}

export function installTmuxTermHostMessages(
  win: HostMessageWindow,
  getWorkArea: WorkAreaProvider,
  log: HostMessageLogger = () => {},
): void {
  let preMaximizeFrame: WindowFrame | null = null;

  const setFrame = (frame: WindowFrame) => {
    win.setFrame(frame.x, frame.y, frame.width, frame.height);
    log(`afterSetFrame frame=${JSON.stringify(win.getFrame())}`);
  };

  const restoreIfMaximized = () => {
    if (!preMaximizeFrame) return false;
    log(`restore frame=${JSON.stringify(preMaximizeFrame)}`);
    setFrame(preMaximizeFrame);
    preMaximizeFrame = null;
    return true;
  };

  win.webview.on('host-message', (event) => {
    const message = hostMessageDetail(event);
    if (isTmuxTermCloseWindowMessage(message)) {
      win.close();
    } else if (isTmuxTermToggleMaximizeMessage(message)) {
      if (!restoreIfMaximized()) {
        preMaximizeFrame = win.getFrame();
        const workArea = getWorkArea(preMaximizeFrame);
        log(`maximize currentFrame=${JSON.stringify(preMaximizeFrame)} workArea=${JSON.stringify(workArea)}`);
        setFrame(workArea);
      }
    } else if (isTmuxTermTitlebarDragMessage(message)) {
      restoreIfMaximized();
    }
  });
}
