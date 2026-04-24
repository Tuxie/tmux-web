import fs from 'node:fs';
import path from 'node:path';

export function resolveMacosAppRoot(env: NodeJS.ProcessEnv = process.env): string {
  const buildDir = env.ELECTROBUN_BUILD_DIR ?? 'build';
  const buildEnv = env.ELECTROBUN_BUILD_ENV ?? 'dev';
  const arch = env.ELECTROBUN_ARCH ?? process.arch;
  const appName = env.ELECTROBUN_APP_NAME ?? (buildEnv === 'stable' ? 'tmux-term' : `tmux-term-${buildEnv}`);
  const platformDir = `${buildEnv}-macos-${arch}`;

  const direct = path.join(buildDir, `${appName}.app`);
  if (fs.existsSync(direct)) return direct;

  return path.join(buildDir, platformDir, `${appName}.app`);
}

function installExecutable(source: string, destination: string): void {
  if (!fs.existsSync(source)) {
    throw new Error(`missing executable for tmux-term bundle: ${source}`);
  }
  fs.rmSync(destination, { force: true });
  fs.cpSync(source, destination);
  fs.chmodSync(destination, 0o755);
}

export function prepareMacosBundle(env: NodeJS.ProcessEnv = process.env): void {
  const appRoot = resolveMacosAppRoot(env);
  const resourcesApp = path.join(appRoot, 'Contents', 'Resources', 'app');
  const macosDir = path.join(appRoot, 'Contents', 'MacOS');

  installExecutable(path.join(resourcesApp, 'tmux-web'), path.join(macosDir, 'tmux-web'));

  const bundledTmux = path.join('dist', 'bin', 'tmux');
  if (fs.existsSync(bundledTmux)) {
    installExecutable(bundledTmux, path.join(macosDir, 'tmux'));
  }

  fs.rmSync(path.join(resourcesApp, 'tmux-web'), { force: true });
  console.log(`Prepared macOS tmux-term executables in ${macosDir}`);
}

if (import.meta.main) {
  if (process.env.ELECTROBUN_OS === 'macos') {
    prepareMacosBundle();
  }
}
