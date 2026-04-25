import { afterEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoots: string[] = [];

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tmux-term-verify-'));
  tempRoots.push(root);
  return root;
}

function writeFile(file: string, contents = ''): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

function makeTarZst(sourceDir: string, destination: string, entry: string): void {
  const result = spawnSync('tar', ['--zstd', '-cf', destination, '-C', sourceDir, entry], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout);
  }
}

describe('verify-electrobun-bundle', () => {
  test('accepts macOS stable bundles compressed by Electrobun', () => {
    const root = makeTempRoot();
    const buildRoot = path.join(root, 'build');
    const appRoot = path.join(buildRoot, 'stable-macos-arm64', 'tmux-term.app');
    const resources = path.join(appRoot, 'Contents', 'Resources');
    const payloadRoot = path.join(root, 'payload');
    const payloadApp = path.join(payloadRoot, 'tmux-term.app');
    const hash = 'testbundle';

    writeFile(path.join(payloadApp, 'Contents', 'MacOS', 'tmux-web'), '#!/bin/sh\n');
    writeFile(path.join(payloadApp, 'Contents', 'MacOS', 'tmux'), '#!/bin/sh\n');
    writeFile(path.join(payloadApp, 'Contents', 'Resources', 'app', 'bun', 'index.js'));
    fs.mkdirSync(resources, { recursive: true });
    fs.writeFileSync(path.join(resources, 'metadata.json'), JSON.stringify({ hash }));
    makeTarZst(payloadRoot, path.join(resources, `${hash}.tar.zst`), 'tmux-term.app');

    const result = spawnSync('bun', ['scripts/verify-electrobun-bundle.ts', buildRoot, 'stable'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ELECTROBUN_OS: 'macos',
        ELECTROBUN_ARCH: 'arm64',
      },
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Verified tmux-term compressed payload contains tmux-web');
  });
});
