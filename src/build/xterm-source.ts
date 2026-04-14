import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export interface VendoredXtermBundle {
  xtermEntry?: string;
  fitEntry?: string;
  cssPath: string;
}

export async function canImportPublishedModule(moduleHref: string): Promise<boolean> {
  try {
    await import(`${moduleHref}?tmux-web-smoke=${Date.now()}`);
    return true;
  } catch {
    return false;
  }
}

function vendorBuildInputs(projectRoot: string): string[] {
  const vendorDir = path.join(projectRoot, 'vendor/xterm.js');
  const inputs = [
    path.join(vendorDir, 'bin/esbuild.mjs'),
    path.join(vendorDir, 'src/browser/public/Terminal.ts'),
    path.join(vendorDir, 'addons/addon-fit/src/FitAddon.ts'),
  ];
  const submoduleHead = path.join(projectRoot, '.git/modules/vendor/xterm.js/HEAD');
  if (fs.existsSync(submoduleHead)) {
    inputs.push(submoduleHead);
  }
  return inputs;
}

function isOlderThanAny(target: string, inputs: string[]): boolean {
  if (!fs.existsSync(target)) return true;
  const targetMtime = fs.statSync(target).mtimeMs;
  return inputs.some(input => fs.existsSync(input) && fs.statSync(input).mtimeMs > targetMtime);
}

function buildWithNode(cwd: string, args: string[]): void {
  execFileSync('node', args, {
    cwd,
    stdio: 'inherit',
  });
}

export async function ensureVendorXtermBuild(projectRoot: string): Promise<void> {
  const vendorDir = path.join(projectRoot, 'vendor/xterm.js');
  const vendorXtermEntry = path.join(vendorDir, 'src/browser/public/Terminal.ts');
  const vendorFitEntry = path.join(vendorDir, 'addons/addon-fit/src/FitAddon.ts');
  const vendorXtermBundle = path.join(vendorDir, 'lib/xterm.mjs');
  const vendorFitBundle = path.join(vendorDir, 'addons/addon-fit/lib/addon-fit.mjs');
  const vendorCssPath = path.join(vendorDir, 'css/xterm.css');

  const hasVendorSources =
    fs.existsSync(vendorXtermEntry) &&
    fs.existsSync(vendorFitEntry) &&
    fs.existsSync(vendorCssPath);

  if (!hasVendorSources) {
    throw new Error('vendor/xterm.js is missing required source files');
  }

  const inputs = vendorBuildInputs(projectRoot);

  if (isOlderThanAny(vendorXtermBundle, inputs)) {
    buildWithNode(vendorDir, ['bin/esbuild.mjs', '--prod']);
  }

  if (isOlderThanAny(vendorFitBundle, inputs)) {
    buildWithNode(vendorDir, ['bin/esbuild.mjs', '--prod', '--addon=fit']);
  }

  const vendorOk = await canImportPublishedModule(pathToFileURL(vendorXtermBundle).href);
  if (!vendorOk) {
    throw new Error('vendored xterm build produced a broken lib/xterm.mjs');
  }

  const fitOk = await canImportPublishedModule(pathToFileURL(vendorFitBundle).href);
  if (!fitOk) {
    throw new Error('vendored xterm build produced a broken addon-fit/lib/addon-fit.mjs');
  }
}

export async function resolveVendoredXtermBundle(projectRoot: string): Promise<VendoredXtermBundle> {
  await ensureVendorXtermBuild(projectRoot);

  const vendorDir = path.join(projectRoot, 'vendor/xterm.js');
  return {
    xtermEntry: path.join(vendorDir, 'lib/xterm.mjs'),
    fitEntry: path.join(vendorDir, 'addons/addon-fit/lib/addon-fit.mjs'),
    cssPath: path.join(vendorDir, 'css/xterm.css'),
  };
}
