import { describe, expect, test } from 'bun:test';
import { installWindowFrameLogging, openTmuxTermWindow } from '../../../src/desktop/window.js';

describe('desktop window creation', () => {
  test('creates and foregrounds the tmux-term window', () => {
    const calls: string[] = [];
    const windows: Array<{ opts: unknown; show: () => void; focus: () => void; on: () => void }> = [];
    class FakeBrowserWindow {
      opts: unknown;

      constructor(opts: unknown) {
        this.opts = opts;
        windows.push(this);
      }

      show() {
        calls.push('show');
      }

      focus() {
        calls.push('focus');
      }

      on() {}
    }

    const win = openTmuxTermWindow(FakeBrowserWindow, 'http://127.0.0.1:1234/');

    expect(win).toBe(windows[0]);
    expect(windows[0]!.opts).toEqual({
      title: 'tmux-term',
      url: 'http://127.0.0.1:1234/',
      titleBarStyle: 'hidden',
      frame: {
        x: 0,
        y: 0,
        width: 1200,
        height: 760,
      },
    });
    expect(calls).toEqual(['show', 'focus']);
  });

  test('logs full frame after move and resize events', () => {
    const messages: string[] = [];
    const handlers: Record<string, () => void> = {};
    const win = {
      getFrame: () => ({ x: -1200, y: -386, width: 1800, height: 1130 }),
      on: (event: 'move' | 'resize' | 'close', cb: () => void) => {
        handlers[event] = cb;
      },
    };

    installWindowFrameLogging(win as any, (message) => {
      messages.push(message);
    });

    handlers.move?.();
    handlers.resize?.();

    expect(messages).toEqual([
      'window-frame move frame={"x":-1200,"y":-386,"width":1800,"height":1130}',
      'window-frame resize frame={"x":-1200,"y":-386,"width":1800,"height":1130}',
    ]);
  });
});
