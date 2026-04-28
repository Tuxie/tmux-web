import { describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';

function copyExecutable(src: string, dst: string): void {
  fs.copyFileSync(src, dst);
  fs.chmodSync(dst, 0o755);
}

describe('tmux-web-dev wrapper', () => {
  test('resolves its real repo directory when launched through a symlink', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-dev-wrapper-'));
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

    const cwdFile = path.join(root, 'cwd.txt');
    const argsFile = path.join(root, 'args.txt');
    fs.writeFileSync(path.join(fakeBin, 'bun'), `#!/usr/bin/env bash
pwd > ${JSON.stringify(cwdFile)}
printf '%s\\n' "$*" > ${JSON.stringify(argsFile)}
exit 0
`, { mode: 0o755 });

    copyExecutable(path.join(process.cwd(), 'tmux-web-dev'), path.join(repo, 'tmux-web-dev'));
    fs.symlinkSync(path.join(repo, 'tmux-web-dev'), path.join(bin, 'tmux-web'));

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
});
