import { describe, test, expect } from 'bun:test';
import { execFileAsync } from '../../../src/server/exec.ts';

describe('execFileAsync', () => {
  test('captures stdout of a real command', async () => {
    const { stdout } = await execFileAsync('printf', ['%s', 'hello']);
    expect(stdout).toBe('hello');
  });

  test('rejects on non-zero exit', async () => {
    await expect(execFileAsync('false', [])).rejects.toBeDefined();
  });

  test('rejects on missing binary', async () => {
    await expect(execFileAsync('/nonexistent/binary-xyz', [])).rejects.toBeDefined();
  });

  test('honours explicit timeout', async () => {
    await expect(execFileAsync('sleep', ['5'], { timeout: 50 })).rejects.toBeDefined();
  });

  test('captures stderr', async () => {
    const { stderr } = await execFileAsync('sh', ['-c', 'printf err 1>&2']);
    expect(stderr).toBe('err');
  });

  test('honours env override', async () => {
    const { stdout } = await execFileAsync('sh', ['-c', 'printf %s "$FOO"'], { env: { FOO: 'bar', PATH: process.env.PATH } });
    expect(stdout).toBe('bar');
  });
});
