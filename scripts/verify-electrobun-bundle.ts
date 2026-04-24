import fs from 'node:fs';
import path from 'node:path';

const buildRoot = path.resolve(process.argv[2] ?? 'build');
const environment = process.argv[3] ?? 'dev';

function targetOS(): string {
  if (process.platform === 'darwin') return 'macos';
  if (process.platform === 'linux') return 'linux';
  throw new Error(`Unsupported tmux-term desktop build platform: ${process.platform}`);
}

function targetArch(): string {
  if (process.arch === 'x64' || process.arch === 'arm64') return process.arch;
  throw new Error(`Unsupported tmux-term desktop build architecture: ${process.arch}`);
}

const appFileName = environment === 'stable' ? 'tmux-term' : `tmux-term-${environment}`;
const platform = targetOS();
const platformBuildRoot = path.join(buildRoot, `${environment}-${platform}-${targetArch()}`);
const resourcesApp =
  platform === 'macos'
    ? path.join(platformBuildRoot, `${appFileName}.app`, 'Contents', 'Resources', 'app')
    : path.join(platformBuildRoot, appFileName, 'Resources', 'app');
const expected = path.join(resourcesApp, 'tmux-web');
const expectedEntrypoint = path.join(resourcesApp, 'bun', 'index.js');

if (!fs.existsSync(expected)) {
  console.error(`tmux-term bundle is missing tmux-web binary: ${expected}`);
  process.exit(1);
}

if (!fs.existsSync(expectedEntrypoint)) {
  console.error(`tmux-term bundle is missing Electrobun app entrypoint: ${expectedEntrypoint}`);
  process.exit(1);
}

const mode = fs.statSync(expected).mode;
if ((mode & 0o111) === 0) {
  console.error(`tmux-term bundled tmux-web is not executable: ${expected}`);
  process.exit(1);
}

console.log(`Verified tmux-term bundle contains executable tmux-web: ${expected}`);
