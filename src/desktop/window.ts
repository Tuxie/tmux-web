interface TmuxTermWindow {
  show?: () => void;
  focus?: () => void;
  on: (event: 'close', cb: () => void) => void;
  close: () => void;
}

interface BrowserWindowConstructor<T extends TmuxTermWindow> {
  new (opts: {
    title: string;
    url: string;
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
