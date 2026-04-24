interface TmuxTermWindow {
  show?: () => void;
  focus?: () => void;
  on: (event: 'close' | 'move' | 'resize', cb: () => void) => void;
  close: () => void;
  getFrame?: () => {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

interface BrowserWindowConstructor<T extends TmuxTermWindow> {
  new (opts: {
    title: string;
    url: string;
    titleBarStyle: 'hidden' | 'hiddenInset' | 'default';
    frame: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  }): T;
}

export function openTmuxTermWindow<T extends TmuxTermWindow>(
  BrowserWindowClass: BrowserWindowConstructor<T>,
  url: string,
): T {
  const win = new BrowserWindowClass({
    title: 'tmux-term',
    url,
    titleBarStyle: 'hidden',
    frame: {
      x: 0,
      y: 0,
      width: 1200,
      height: 760,
    },
  });

  win.show?.();
  win.focus?.();
  return win;
}

export function installWindowFrameLogging(
  win: TmuxTermWindow,
  log: (message: string) => void,
): void {
  const logFrame = (source: 'move' | 'resize') => {
    const frame = win.getFrame?.();
    if (!frame) return;
    log(`window-frame ${source} frame=${JSON.stringify(frame)}`);
  };
  win.on('move', () => logFrame('move'));
  win.on('resize', () => logFrame('resize'));
}
