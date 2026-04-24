import { describe, expect, test } from 'bun:test';
import { installTmuxTermHostMessages } from '../../../src/desktop/window-host-messages.js';

describe('tmux-term window host messages', () => {
  test('closes the window when the webview asks for tmux-term close', () => {
    let closed = 0;
    const handlers: Record<string, (event: unknown) => void> = {};
    const win = {
      close: () => { closed += 1; },
      webview: {
        on: (name: string, handler: (event: unknown) => void) => {
          handlers[name] = handler;
        },
      },
    };

    installTmuxTermHostMessages(win);
    handlers['host-message']!({ data: { detail: { type: 'tmux-term:close-window' } } });

    expect(closed).toBe(1);
  });

  test('ignores unrelated webview host messages', () => {
    let closed = 0;
    const handlers: Record<string, (event: unknown) => void> = {};
    const win = {
      close: () => { closed += 1; },
      webview: {
        on: (name: string, handler: (event: unknown) => void) => {
          handlers[name] = handler;
        },
      },
    };

    installTmuxTermHostMessages(win);
    handlers['host-message']!({ data: { detail: { type: 'other' } } });

    expect(closed).toBe(0);
  });
});
