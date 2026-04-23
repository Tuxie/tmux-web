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
});
