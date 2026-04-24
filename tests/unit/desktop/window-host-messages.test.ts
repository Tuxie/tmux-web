import { describe, expect, test } from 'bun:test';
import { installTmuxTermHostMessages, type WorkAreaProvider } from '../../../src/desktop/window-host-messages.js';

describe('tmux-term window host messages', () => {
  function fakeWindow() {
    let closed = 0;
    const calls: string[] = [];
    let frame = { x: 100, y: 120, width: 900, height: 620 };
    const handlers: Record<string, (event: unknown) => void> = {};
    const win = {
      close: () => { closed += 1; calls.push('close'); },
      getFrame: () => ({ ...frame }),
      setFrame: (x: number, y: number, width: number, height: number) => {
        frame = { x, y, width, height };
        calls.push(`setFrame:${x},${y},${width},${height}`);
      },
      closed: () => closed,
      calls: () => calls.slice(),
      frame: () => ({ ...frame }),
      webview: {
        on: (name: string, handler: (event: unknown) => void) => {
          handlers[name] = handler;
        },
      },
    };
    return { win, handlers };
  }

  const workArea: WorkAreaProvider = () => ({ x: 0, y: 25, width: 1440, height: 875 });

  test('closes the window when the webview asks for tmux-term close', () => {
    const { win, handlers } = fakeWindow();

    installTmuxTermHostMessages(win, workArea);
    handlers['host-message']!({ data: { detail: { type: 'tmux-term:close-window' } } });

    expect(win.closed()).toBe(1);
  });

  test('double-click titlebar message instantly fills the work area and remembers the old frame', () => {
    const { win, handlers } = fakeWindow();

    installTmuxTermHostMessages(win, workArea);
    handlers['host-message']!({ data: { detail: { type: 'tmux-term:toggle-maximize' } } });

    expect(win.calls()).toEqual(['setFrame:0,25,1440,875']);
    expect(win.frame()).toEqual({ x: 0, y: 25, width: 1440, height: 875 });
  });

  test('double-click titlebar message restores the saved pre-maximize frame', () => {
    const { win, handlers } = fakeWindow();

    installTmuxTermHostMessages(win, workArea);
    handlers['host-message']!({ data: { detail: { type: 'tmux-term:toggle-maximize' } } });
    handlers['host-message']!({ data: { detail: { type: 'tmux-term:toggle-maximize' } } });

    expect(win.calls()).toEqual([
      'setFrame:0,25,1440,875',
      'setFrame:100,120,900,620',
    ]);
    expect(win.frame()).toEqual({ x: 100, y: 120, width: 900, height: 620 });
  });

  test('titlebar drag message restores the saved frame before native drag', () => {
    const { win, handlers } = fakeWindow();

    installTmuxTermHostMessages(win, workArea);
    handlers['host-message']!({ data: { detail: { type: 'tmux-term:toggle-maximize' } } });
    handlers['host-message']!({ data: { detail: { type: 'tmux-term:titlebar-drag' } } });

    expect(win.calls()).toEqual([
      'setFrame:0,25,1440,875',
      'setFrame:100,120,900,620',
    ]);
  });

  test('titlebar drag message leaves a normal window alone', () => {
    const { win, handlers } = fakeWindow();

    installTmuxTermHostMessages(win, workArea);
    handlers['host-message']!({ data: { detail: { type: 'tmux-term:titlebar-drag' } } });

    expect(win.calls()).toEqual([]);
  });

  test('ignores unrelated webview host messages', () => {
    const { win, handlers } = fakeWindow();

    installTmuxTermHostMessages(win, workArea);
    handlers['host-message']!({ data: { detail: { type: 'other' } } });

    expect(win.closed()).toBe(0);
  });
});
