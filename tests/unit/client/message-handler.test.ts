import { describe, expect, test } from 'bun:test';
import { handleServerData } from '../../../src/client/message-handler.js';

describe('handleServerData', () => {
  test('applies TT title messages to the topbar verbatim', () => {
    const titles: string[] = [];
    const writes: string[] = [];

    handleServerData('\x00TT:' + JSON.stringify({ title: '\u2733 Compact lessons learned documentation' }), {
      adapter: { write: (data: string) => writes.push(data) },
      topbar: { updateTitle: (title: string) => titles.push(title) },
    });

    handleServerData('\x00TT:' + JSON.stringify({ title: '\u25c7  Ready (Fotona) \u2728' }), {
      adapter: { write: (data: string) => writes.push(data) },
      topbar: { updateTitle: (title: string) => titles.push(title) },
    });

    handleServerData('\x00TT:' + JSON.stringify({ title: 'main:literal pane title' }), {
      adapter: { write: (data: string) => writes.push(data) },
      topbar: { updateTitle: (title: string) => titles.push(title) },
    });

    expect(titles).toEqual([
      '\u2733 Compact lessons learned documentation',
      '\u25c7  Ready (Fotona) \u2728',
      'main:literal pane title',
    ]);
    expect(writes).toEqual([]);
  });

  test('later TT title fully replaces the earlier title', () => {
    let title = '';

    handleServerData(
      '\x00TT:' + JSON.stringify({ title: 'first long title' }) +
      '\x00TT:' + JSON.stringify({ title: 'short' }),
      {
        adapter: { write: () => {} },
        topbar: { updateTitle: (next: string) => { title = next; } },
      },
    );

    expect(title).toBe('short');
  });

  test('routes TT clipboard messages to the clipboard handler without terminal output', () => {
    const clips: string[] = [];
    const writes: string[] = [];

    handleServerData('\x00TT:' + JSON.stringify({ clipboard: 'SGVsbG8=' }), {
      adapter: { write: (data: string) => writes.push(data) },
      topbar: {},
      onClipboard: (base64) => clips.push(base64),
    });

    expect(clips).toEqual(['SGVsbG8=']);
    expect(writes).toEqual([]);
  });

  test('routes TT sessions and windows to the topbar', () => {
    const sessions: unknown[] = [];
    const windows: unknown[] = [];

    handleServerData('\x00TT:' + JSON.stringify({
      sessions: [{ id: '1', name: 'main' }],
      windows: [{ index: '0', name: 'zsh', active: true }],
    }), {
      adapter: { write: () => {} },
      topbar: {
        updateSessions: (next) => sessions.push(next),
        updateWindows: (next) => windows.push(next),
      },
    });

    expect(sessions).toEqual([[{ id: '1', name: 'main' }]]);
    expect(windows).toEqual([[{ index: '0', name: 'zsh', active: true }]]);
  });

  test('dispatches scrollbar TT messages', () => {
    const states: unknown[] = [];

    handleServerData('\x00TT:{"scrollbar":{"paneId":"%4","paneHeight":40,"historySize":100,"scrollPosition":0,"paneInMode":0,"paneMode":"","alternateOn":false}}', {
      adapter: { write: () => {} },
      topbar: {},
      onScrollbar: (state) => states.push(state),
    });

    expect(states).toEqual([{
      paneId: '%4',
      paneHeight: 40,
      historySize: 100,
      scrollPosition: 0,
      paneInMode: 0,
      paneMode: '',
      alternateOn: false,
    }]);
  });
});
