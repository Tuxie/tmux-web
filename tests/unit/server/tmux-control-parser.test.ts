import { describe, test, expect } from 'bun:test';
import { ControlParser } from '../../../src/server/tmux-control.ts';
import type { TmuxNotification } from '../../../src/server/tmux-control.ts';

describe('ControlParser', () => {
  test('emits a command response on %end', () => {
    const events: Array<{ kind: string; cmdnum?: number; output?: string; error?: string }> = [];
    const parser = new ControlParser({
      onResponse: (cmdnum, output) => events.push({ kind: 'response', cmdnum, output }),
      onError: (cmdnum, stderr) => events.push({ kind: 'error', cmdnum, error: stderr }),
      onNotification: () => {},
    });
    parser.push('%begin 1700000000 5 0\n');
    parser.push('hello world\n');
    parser.push('%end 1700000000 5 0\n');
    expect(events).toEqual([{ kind: 'response', cmdnum: 5, output: 'hello world' }]);
  });

  test('emits an error on %error', () => {
    const events: Array<{ kind: string; cmdnum?: number; stderr?: string }> = [];
    const parser = new ControlParser({
      onResponse: () => {},
      onError: (cmdnum, stderr) => events.push({ kind: 'error', cmdnum, stderr }),
      onNotification: () => {},
    });
    parser.push('%begin 1 7 0\nbad args\n%error 1 7 0\n');
    expect(events).toEqual([{ kind: 'error', cmdnum: 7, stderr: 'bad args' }]);
  });

  test('buffers lines split across push boundaries', () => {
    const events: Array<{ output: string }> = [];
    const parser = new ControlParser({
      onResponse: (_, output) => events.push({ output }),
      onError: () => {},
      onNotification: () => {},
    });
    parser.push('%begin 1 1 0\nhel');
    parser.push('lo\n%en');
    parser.push('d 1 1 0\n');
    expect(events).toEqual([{ output: 'hello' }]);
  });

  test('emits sessionsChanged from a %sessions-changed notification', () => {
    const notes: TmuxNotification[] = [];
    const parser = new ControlParser({
      onResponse: () => {},
      onError: () => {},
      onNotification: (n) => notes.push(n),
    });
    parser.push('%sessions-changed\n');
    expect(notes).toEqual([{ type: 'sessionsChanged' }]);
  });

  test('parses %session-renamed into id + name', () => {
    const notes: TmuxNotification[] = [];
    const parser = new ControlParser({
      onResponse: () => {}, onError: () => {},
      onNotification: (n) => notes.push(n),
    });
    parser.push('%session-renamed $3 newname\n');
    expect(notes).toEqual([{ type: 'sessionRenamed', id: '$3', name: 'newname' }]);
  });

  test('parses %session-closed', () => {
    const notes: TmuxNotification[] = [];
    const parser = new ControlParser({
      onResponse: () => {}, onError: () => {},
      onNotification: (n) => notes.push(n),
    });
    parser.push('%session-closed $5\n');
    expect(notes).toEqual([{ type: 'sessionClosed', id: '$5' }]);
  });

  test('parses %window-add / %window-close / %window-renamed', () => {
    const notes: TmuxNotification[] = [];
    const parser = new ControlParser({
      onResponse: () => {}, onError: () => {},
      onNotification: (n) => notes.push(n),
    });
    parser.push('%window-add @7\n');
    parser.push('%window-close @7\n');
    parser.push('%window-renamed @8 foo\n');
    expect(notes).toEqual([
      { type: 'windowAdd', window: '@7' },
      { type: 'windowClose', window: '@7' },
      { type: 'windowRenamed', window: '@8', name: 'foo' },
    ]);
  });

  test('discards %output (consumed elsewhere under scope B: it is not)', () => {
    const notes: TmuxNotification[] = [];
    const parser = new ControlParser({
      onResponse: () => {}, onError: () => {},
      onNotification: (n) => notes.push(n),
    });
    parser.push('%output %1 some bytes\n');
    expect(notes).toEqual([]);
  });

  test('discards unrecognised notifications', () => {
    const notes: TmuxNotification[] = [];
    const parser = new ControlParser({
      onResponse: () => {}, onError: () => {},
      onNotification: (n) => notes.push(n),
    });
    parser.push('%client-session-changed /dev/pts/0 $1 main\n');
    parser.push('%layout-change @1 whatever 0\n');
    expect(notes).toEqual([]);
  });
});
