import { describe, expect, test } from 'bun:test';
import { openTmuxTermWindow } from '../../../src/desktop/window.js';

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
});
