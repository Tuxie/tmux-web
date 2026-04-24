import { describe, expect, test } from 'bun:test';
import { installTmuxTermHostMessages } from '../../../src/desktop/window-host-messages.js';

describe('tmux-term window host messages', () => {
  function fakeWindow() {
    let closed = 0;
    let maximized = false;
    const calls: string[] = [];
    const handlers: Record<string, (event: unknown) => void> = {};
    const win = {
      close: () => { closed += 1; calls.push('close'); },
      maximize: () => { maximized = true; calls.push('maximize'); },
      unmaximize: () => { maximized = false; calls.push('unmaximize'); },
      isMaximized: () => maximized,
      setMaximized: (next: boolean) => { maximized = next; },
      closed: () => closed,
      calls: () => calls.slice(),
      webview: {
        on: (name: string, handler: (event: unknown) => void) => {
          handlers[name] = handler;
        },
      },
    };
    return { win, handlers };
  }

  test('closes the window when the webview asks for tmux-term close', () => {
    const { win, handlers } = fakeWindow();

    installTmuxTermHostMessages(win);
    handlers['host-message']!({ data: { detail: { type: 'tmux-term:close-window' } } });

    expect(win.closed()).toBe(1);
  });

  test('double-click titlebar message maximizes a normal window', () => {
    const { win, handlers } = fakeWindow();

    installTmuxTermHostMessages(win);
    handlers['host-message']!({ data: { detail: { type: 'tmux-term:toggle-maximize' } } });

    expect(win.calls()).toEqual(['maximize']);
  });

  test('double-click titlebar message restores a maximized window', () => {
    const { win, handlers } = fakeWindow();
    win.setMaximized(true);

    installTmuxTermHostMessages(win);
    handlers['host-message']!({ data: { detail: { type: 'tmux-term:toggle-maximize' } } });

    expect(win.calls()).toEqual(['unmaximize']);
  });

  test('titlebar drag message restores a maximized window before native drag', () => {
    const { win, handlers } = fakeWindow();
    win.setMaximized(true);

    installTmuxTermHostMessages(win);
    handlers['host-message']!({ data: { detail: { type: 'tmux-term:titlebar-drag' } } });

    expect(win.calls()).toEqual(['unmaximize']);
  });

  test('titlebar drag message leaves a normal window alone', () => {
    const { win, handlers } = fakeWindow();

    installTmuxTermHostMessages(win);
    handlers['host-message']!({ data: { detail: { type: 'tmux-term:titlebar-drag' } } });

    expect(win.calls()).toEqual([]);
  });

  test('ignores unrelated webview host messages', () => {
    const { win, handlers } = fakeWindow();

    installTmuxTermHostMessages(win);
    handlers['host-message']!({ data: { detail: { type: 'other' } } });

    expect(win.closed()).toBe(0);
  });
});
