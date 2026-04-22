import { test, expect } from 'bun:test';
import { getForegroundProcess } from '../../../src/server/foreground-process.ts';
import { execFileAsync } from '../../../src/server/exec.ts';
import type { RunCmd } from '../../../src/server/tmux-control.ts';
import { makeFakeTmux } from './_harness/fake-tmux.ts';

test('default deps: unreachable tmux returns all-null (exercises default exec lambda)', async () => {
  // /bin/false exits non-zero → execFileAsync rejects, hitting the catch branch.
  const run: RunCmd = async (args) => {
    const { stdout } = await execFileAsync('/bin/false', [...args]);
    return stdout;
  };
  const got = await getForegroundProcess(run, 'main');
  expect(got).toEqual({ exePath: null, commandName: null, pid: null });
});

test('default deps: fake-tmux + real /proc/1 exercises default readFile/readlink lambdas', async () => {
  const { path } = makeFakeTmux();
  // fake-tmux returns panePid=1 for display-message. On Linux the defaults
  // will fs.readFileSync('/proc/1/stat') (exists) and fs.readlinkSync(
  // '/proc/1/exe') (usually EACCES for non-root). Either branch still runs
  // the default lambda, which is all we need for function coverage.
  const run: RunCmd = async (args) => {
    const { stdout } = await execFileAsync(path, [...args]);
    return stdout;
  };
  const got = await getForegroundProcess(run, 'main');
  // commandName always resolvable from fake-tmux stdout.
  expect(got.commandName).toBe('bash');
  // pid is either 1 (if /proc/1/stat parsed) or null (on non-Linux).
  expect(got.pid === 1 || got.pid === null).toBe(true);
});
