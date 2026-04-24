import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  prepareMacosBundle,
  resolveMacosAppRoot,
} from '../../../scripts/prepare-electrobun-bundle.ts';

const tempRoots: string[] = [];

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tmux-term-bundle-'));
  tempRoots.push(root);
  return root;
}

function makeApp(root: string, appPath: string): string {
  const appRoot = path.join(root, appPath);
  fs.mkdirSync(path.join(appRoot, 'Contents', 'Resources', 'app'), { recursive: true });
  fs.mkdirSync(path.join(appRoot, 'Contents', 'MacOS'), { recursive: true });
  fs.writeFileSync(path.join(appRoot, 'Contents', 'Resources', 'app', 'tmux-web'), '#!/bin/sh\n');
  return appRoot;
}

describe('prepare-electrobun-bundle', () => {
  test('resolveMacosAppRoot accepts an Electrobun target build directory', () => {
    const root = makeTempRoot();
    const buildDir = path.join(root, 'build', 'dev-macos-arm64');
    const appRoot = makeApp(root, 'build/dev-macos-arm64/tmux-term-dev.app');

    expect(resolveMacosAppRoot({
      ELECTROBUN_BUILD_DIR: buildDir,
      ELECTROBUN_BUILD_ENV: 'dev',
      ELECTROBUN_ARCH: 'arm64',
      ELECTROBUN_APP_NAME: 'tmux-term-dev',
    })).toBe(appRoot);
  });

  test('resolveMacosAppRoot accepts a build root directory', () => {
    const root = makeTempRoot();
    const buildRoot = path.join(root, 'build');
    const appRoot = makeApp(root, 'build/dev-macos-arm64/tmux-term-dev.app');

    expect(resolveMacosAppRoot({
      ELECTROBUN_BUILD_DIR: buildRoot,
      ELECTROBUN_BUILD_ENV: 'dev',
      ELECTROBUN_ARCH: 'arm64',
      ELECTROBUN_APP_NAME: 'tmux-term-dev',
    })).toBe(appRoot);
  });

  test('prepareMacosBundle moves tmux-web from Resources/app to Contents/MacOS', () => {
    const root = makeTempRoot();
    const buildDir = path.join(root, 'build', 'dev-macos-arm64');
    const appRoot = makeApp(root, 'build/dev-macos-arm64/tmux-term-dev.app');

    prepareMacosBundle({
      ELECTROBUN_BUILD_DIR: buildDir,
      ELECTROBUN_BUILD_ENV: 'dev',
      ELECTROBUN_ARCH: 'arm64',
      ELECTROBUN_APP_NAME: 'tmux-term-dev',
    });

    expect(fs.existsSync(path.join(appRoot, 'Contents', 'MacOS', 'tmux-web'))).toBe(true);
    expect(fs.existsSync(path.join(appRoot, 'Contents', 'Resources', 'app', 'tmux-web'))).toBe(false);
  });
});
