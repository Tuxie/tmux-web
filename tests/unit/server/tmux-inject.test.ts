import { describe, test, expect } from 'bun:test';
import { sendBytesToPane } from '../../../src/server/tmux-inject.ts';

function recordingRun() {
  const calls: Array<readonly string[]> = [];
  const run = async (args: readonly string[]) => {
    calls.push(args);
    return '';
  };
  return { calls, run };
}

describe('sendBytesToPane', () => {
  test('invokes `send-keys -H -t <target> <hex bytes>`', async () => {
    const { calls, run } = recordingRun();
    await sendBytesToPane({
      run, target: 'main', bytes: '\x1b[200~/tmp/x\x1b[201~',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.slice(0, 4)).toEqual(['send-keys', '-H', '-t', 'main']);
    const decoded = calls[0]!.slice(4).map(h => String.fromCharCode(parseInt(h, 16))).join('');
    expect(decoded).toBe('\x1b[200~/tmp/x\x1b[201~');
  });

  test('forwards the target string verbatim (session:window.pane form)', async () => {
    const { calls, run } = recordingRun();
    await sendBytesToPane({ run, target: 'dev:2.1', bytes: 'x' });
    expect(calls[0]!.slice(0, 4)).toEqual(['send-keys', '-H', '-t', 'dev:2.1']);
  });

  test('each byte is emitted as exactly one two-digit hex arg', async () => {
    const { calls, run } = recordingRun();
    await sendBytesToPane({ run, target: 'main', bytes: 'ab\x00\xff' });
    expect(calls[0]!.slice(4)).toEqual(['61', '62', '00', 'ff']);
  });
});
