import { describe, test, expect } from 'bun:test';
import { deliverOsc52Reply } from '../../../src/server/osc52-reply.ts';

function recordingRun() {
  const calls: Array<readonly string[]> = [];
  const run = async (args: readonly string[]) => { calls.push(args); return ''; };
  return { calls, run };
}

describe('deliverOsc52Reply', () => {
  test('invokes send-keys -H, not a direct PTY write, when no directWrite is provided', async () => {
    const { calls, run } = recordingRun();
    let directWriteCalls = 0;
    await deliverOsc52Reply({
      run, target: 'main', selection: 'c', base64: 'aGk=',
    });
    expect(directWriteCalls).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.slice(0, 4)).toEqual(['send-keys', '-H', '-t', 'main']);
    const hexArgs = calls[0]!.slice(4);
    expect(hexArgs.every(a => /^[0-9a-f]{2}$/.test(a))).toBe(true);
  });

  test('hex args decode back to the expected OSC 52 response bytes', async () => {
    const { calls, run } = recordingRun();
    await deliverOsc52Reply({ run, target: 'dev', selection: 'c', base64: 'aGk=' });
    const hex = calls[0]!.slice(4);
    const decoded = hex.map(h => String.fromCharCode(parseInt(h, 16))).join('');
    expect(decoded).toBe('\x1b]52;c;aGk=\x07');
  });

  test('empty base64 still delivers a well-formed OSC 52 reply (deny path)', async () => {
    const { calls, run } = recordingRun();
    await deliverOsc52Reply({ run, target: 'main', selection: 'c', base64: '' });
    const hex = calls[0]!.slice(4);
    expect(hex.map(h => String.fromCharCode(parseInt(h, 16))).join(''))
      .toBe('\x1b]52;c;\x07');
  });

  test('directWrite shortcut (test mode) bypasses tmux entirely', async () => {
    const { calls, run } = recordingRun();
    let captured = '';
    await deliverOsc52Reply({
      run, target: 'main', selection: 'c', base64: 'b2s=',
      directWrite: (b) => { captured = b; },
    });
    expect(calls).toHaveLength(0);
    expect(captured).toBe('\x1b]52;c;b2s=\x07');
  });

  test('target string is forwarded verbatim (session, window, pane)', async () => {
    const { calls, run } = recordingRun();
    await deliverOsc52Reply({ run, target: 'dev:2.1', selection: 'c', base64: '' });
    expect(calls[0]!.slice(0, 4)).toEqual(['send-keys', '-H', '-t', 'dev:2.1']);
  });
});
