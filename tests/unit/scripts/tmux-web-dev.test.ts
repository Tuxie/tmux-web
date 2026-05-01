import { describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';

function copyExecutable(src: string, dst: string): void {
  fs.copyFileSync(src, dst);
  fs.chmodSync(dst, 0o755);
}

function makeRepoFixture(root: string): { repo: string; bin: string; fakeBin: string } {
  const repo = path.join(root, 'repo');
  const bin = path.join(root, 'bin');
  const fakeBin = path.join(root, 'fake-bin');
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.mkdirSync(path.join(repo, 'dist/client'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'src/server'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'src/client'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'src/shared'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });

  fs.writeFileSync(path.join(repo, 'bun-build.ts'), '');
  fs.writeFileSync(path.join(repo, 'tmux.conf'), '');
  fs.writeFileSync(path.join(repo, 'scripts/generate-assets.ts'), '');
  fs.writeFileSync(path.join(repo, 'dist/client/xterm.js'), '');
  fs.writeFileSync(path.join(repo, 'src/server/assets-embedded.ts'), '');
  fs.writeFileSync(path.join(repo, 'src/server/index.ts'), '');
  copyExecutable(path.join(process.cwd(), 'tmux-web-dev'), path.join(repo, 'tmux-web-dev'));
  fs.symlinkSync(path.join(repo, 'tmux-web-dev'), path.join(bin, 'tmux-web'));

  return { repo, bin, fakeBin };
}

describe('tmux-web-dev wrapper', () => {
  test('resolves its real repo directory when launched through a symlink', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-dev-wrapper-'));
    const { repo, bin, fakeBin } = makeRepoFixture(root);

    const cwdFile = path.join(root, 'cwd.txt');
    const argsFile = path.join(root, 'args.txt');
    fs.writeFileSync(path.join(fakeBin, 'bun'), `#!/usr/bin/env bash
pwd > ${JSON.stringify(cwdFile)}
printf '%s\\n' "$*" > ${JSON.stringify(argsFile)}
exit 0
`, { mode: 0o755 });

    try {
      const result = Bun.spawnSync({
        cmd: [path.join(bin, 'tmux-web'), '--help'],
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      });

      expect(result.exitCode).toBe(0);
      expect(fs.readFileSync(cwdFile, 'utf8').trim()).toBe(repo);
      expect(fs.readFileSync(argsFile, 'utf8').trim()).toBe('src/server/index.ts --help');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('--stdio-agent runs bun in the foreground instead of starting the dev watcher', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-dev-wrapper-'));
    const { bin, fakeBin } = makeRepoFixture(root);

    const argsFile = path.join(root, 'args.txt');
    fs.writeFileSync(path.join(fakeBin, 'bun'), `#!/usr/bin/env bash
printf '%s\\n' "$*" > ${JSON.stringify(argsFile)}
sleep 2
exit 17
`, { mode: 0o755 });

    try {
      const started = performance.now();
      const result = Bun.spawnSync({
        cmd: [path.join(bin, 'tmux-web'), '--stdio-agent'],
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
        },
        stdout: 'pipe',
        stderr: 'pipe',
        timeout: 3000,
      });
      const elapsed = performance.now() - started;

      expect(result.exitCode).toBe(17);
      expect(elapsed).toBeGreaterThanOrEqual(1900);
      expect(fs.readFileSync(argsFile, 'utf8').trim()).toBe('src/server/index.ts --stdio-agent');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('git watcher does not leak inotifywait after a commit-triggered restart', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-dev-wrapper-'));
    const { bin, fakeBin } = makeRepoFixture(root);

    const triggerFile = path.join(root, 'commit-triggered');
    const inotifyPidFile = path.join(root, 'inotify-pid.txt');
    const bunInvocationsFile = path.join(root, 'bun-invocations.txt');

    fs.writeFileSync(path.join(fakeBin, 'git'), `#!/usr/bin/env bash
if [ "$1" = "rev-parse" ] && [ "$2" = "HEAD" ]; then
  if [ -f ${JSON.stringify(triggerFile)} ]; then
    echo new-head
  else
    echo old-head
  fi
  exit 0
fi
exit 1
`, { mode: 0o755 });

    fs.writeFileSync(path.join(fakeBin, 'bun'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> ${JSON.stringify(bunInvocationsFile)}
trap 'exit 0' TERM INT
while true; do sleep 1; done
`, { mode: 0o755 });

    fs.writeFileSync(path.join(fakeBin, 'inotifywait'), `#!/usr/bin/env bash
echo "$$" > ${JSON.stringify(inotifyPidFile)}
while [ ! -f ${JSON.stringify(triggerFile)} ]; do sleep 0.05; done
echo "./.git/ CLOSE_WRITE HEAD"
case " $* " in
  *" -qmr "*) while true; do sleep 1; done ;;
esac
`, { mode: 0o755 });

    const proc = Bun.spawn({
      cmd: [path.join(bin, 'tmux-web'), '--test'],
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });

    try {
      await waitUntil(() => fs.existsSync(inotifyPidFile), 1000);
      fs.writeFileSync(triggerFile, '');
      await waitUntil(() => {
        if (!fs.existsSync(bunInvocationsFile)) return false;
        return fs.readFileSync(bunInvocationsFile, 'utf8').trim().split('\n').length >= 2;
      }, 1000);

      const inotifyPid = Number(fs.readFileSync(inotifyPidFile, 'utf8').trim());
      expect(isProcessAlive(inotifyPid)).toBeFalse();
    } finally {
      proc.kill();
      await proc.exited.catch(() => {});
      if (fs.existsSync(inotifyPidFile)) {
        const inotifyPid = Number(fs.readFileSync(inotifyPidFile, 'utf8').trim());
        try {
          process.kill(inotifyPid, 'TERM');
        } catch {
          // Already exited, which is the expected path for the fixed wrapper.
        }
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    if (predicate()) return;
    await Bun.sleep(20);
  }
  throw new Error('condition was not met before timeout');
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
