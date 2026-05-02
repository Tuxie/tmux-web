import fs from 'node:fs';
import path from 'node:path';

const buildRoot = path.resolve(process.argv[2] ?? 'build');
const environment = process.argv[3] ?? 'dev';

function targetOS(): string {
  if (process.env.ELECTROBUN_OS === 'macos' || process.env.ELECTROBUN_OS === 'linux') {
    return process.env.ELECTROBUN_OS;
  }
  if (process.platform === 'darwin') return 'macos';
  if (process.platform === 'linux') return 'linux';
  throw new Error(`Unsupported tmux-term desktop build platform: ${process.platform}`);
}

function targetArch(): string {
  if (process.env.ELECTROBUN_ARCH === 'x64' || process.env.ELECTROBUN_ARCH === 'arm64') {
    return process.env.ELECTROBUN_ARCH;
  }
  if (process.arch === 'x64' || process.arch === 'arm64') return process.arch;
  throw new Error(`Unsupported tmux-term desktop build architecture: ${process.arch}`);
}

const appFileName = environment === 'stable' ? 'tmux-term' : `tmux-term-${environment}`;
const platform = targetOS();
const platformBuildRoot = path.join(buildRoot, `${environment}-${platform}-${targetArch()}`);
const appRoot =
  platform === 'macos'
    ? path.join(platformBuildRoot, `${appFileName}.app`)
    : path.join(platformBuildRoot, appFileName);
const resourcesDir =
  platform === 'macos'
    ? path.join(appRoot, 'Contents', 'Resources')
    : path.join(appRoot, 'Resources');
const resourcesApp = path.join(resourcesDir, 'app');
const executableDir =
  platform === 'macos'
    ? path.join(appRoot, 'Contents', 'MacOS')
    : resourcesApp;
const expected = path.join(executableDir, 'tmux-web');
const expectedEntrypoint = path.join(resourcesApp, 'bun', 'index.js');
const misplacedMacTmuxWeb = platform === 'macos' ? path.join(resourcesApp, 'tmux-web') : null;

function tarZstEntries(archive: string): string[] {
  const result = Bun.spawnSync(['tar', '--zstd', '-tf', archive], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = result.stdout.toString();
  const stderr = result.stderr.toString();
  if (!result.success) {
    throw new Error(`failed to list ${archive}: ${stderr || stdout}`);
  }
  return stdout.split('\n').filter(Boolean);
}

function verifyCompressedPayload(): boolean {
  const metadataPath = path.join(resourcesDir, 'metadata.json');
  if (!fs.existsSync(metadataPath)) return false;

  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as { hash?: unknown };
  if (typeof metadata.hash !== 'string' || !metadata.hash) {
    console.error(`tmux-term bundle metadata has no hash: ${metadataPath}`);
    process.exit(1);
  }

  const payload = path.join(resourcesDir, `${metadata.hash}.tar.zst`);
  if (!fs.existsSync(payload)) {
    console.error(`tmux-term bundle is missing app payload: ${payload}`);
    process.exit(1);
  }

  const entries = new Set(tarZstEntries(payload));
  const payloadRoot = platform === 'macos' ? `${appFileName}.app` : appFileName;
  const payloadResourcesApp =
    platform === 'macos'
      ? `${payloadRoot}/Contents/Resources/app`
      : `${payloadRoot}/Resources/app`;
  const payloadExecutableDir =
    platform === 'macos'
      ? `${payloadRoot}/Contents/MacOS`
      : payloadResourcesApp;
  const payloadTmuxWeb = `${payloadExecutableDir}/tmux-web`;
  const payloadEntrypoint = `${payloadResourcesApp}/bun/index.js`;
  if (!entries.has(payloadTmuxWeb)) {
    console.error(`tmux-term payload is missing tmux-web: ${payloadTmuxWeb}`);
    process.exit(1);
  }
  if (!entries.has(payloadEntrypoint)) {
    console.error(`tmux-term payload is missing Electrobun app entrypoint: ${payloadEntrypoint}`);
    process.exit(1);
  }
  if (platform === 'macos') {
    const misplacedPayloadTmuxWeb = `${payloadResourcesApp}/tmux-web`;
    if (entries.has(misplacedPayloadTmuxWeb)) {
      console.error(`tmux-term macOS payload should not keep tmux-web in Resources/app: ${misplacedPayloadTmuxWeb}`);
      process.exit(1);
    }
  }

  console.log(`Verified tmux-term compressed payload contains tmux-web: ${payload}`);
  return true;
}

if (verifyCompressedPayload()) {
  process.exit(0);
}

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
  console.error(`tmux-term tmux-web binary is not executable: ${expected}`);
  process.exit(1);
}

if (misplacedMacTmuxWeb && fs.existsSync(misplacedMacTmuxWeb)) {
  console.error(`tmux-term macOS bundle should not keep tmux-web in Resources/app: ${misplacedMacTmuxWeb}`);
  process.exit(1);
}

console.log(`Verified tmux-term bundle contains executable tmux-web: ${expected}`);
