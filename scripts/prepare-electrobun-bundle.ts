import fs from 'node:fs';
import path from 'node:path';

if (process.env.ELECTROBUN_OS !== 'macos') {
  process.exit(0);
}

const buildDir = process.env.ELECTROBUN_BUILD_DIR ?? 'build';
const buildEnv = process.env.ELECTROBUN_BUILD_ENV ?? 'dev';
const arch = process.env.ELECTROBUN_ARCH ?? process.arch;
const appName = process.env.ELECTROBUN_APP_NAME ?? (buildEnv === 'stable' ? 'tmux-term' : `tmux-term-${buildEnv}`);

const appRoot = path.join(buildDir, `${buildEnv}-macos-${arch}`, `${appName}.app`);
const resourcesApp = path.join(appRoot, 'Contents', 'Resources', 'app');
const macosDir = path.join(appRoot, 'Contents', 'MacOS');

function installExecutable(source: string, destination: string): void {
  if (!fs.existsSync(source)) {
    throw new Error(`missing executable for tmux-term bundle: ${source}`);
  }
  fs.rmSync(destination, { force: true });
  fs.cpSync(source, destination);
  fs.chmodSync(destination, 0o755);
}

installExecutable(path.join(resourcesApp, 'tmux-web'), path.join(macosDir, 'tmux-web'));

const bundledTmux = path.join('dist', 'bin', 'tmux');
if (fs.existsSync(bundledTmux)) {
  installExecutable(bundledTmux, path.join(macosDir, 'tmux'));
}

fs.rmSync(path.join(resourcesApp, 'tmux-web'), { force: true });
console.log(`Prepared macOS tmux-term executables in ${macosDir}`);
