import fs from 'node:fs';
import path from 'node:path';

export function findTmuxInPath(): string | null {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, 'tmux');
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {}
  }
  return null;
}

export function findBundledTmux(executablePath = process.execPath): string | null {
  const candidate = path.join(path.dirname(executablePath), 'tmux');
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return candidate;
  } catch {
    return null;
  }
}

export function desktopExtraArgs(opts: { executablePath?: string } = {}): string[] {
  const args: string[] = [];
  const tmuxBin =
    process.env.TMUX_TERM_TMUX_BIN ||
    findTmuxInPath() ||
    findBundledTmux(opts.executablePath);
  if (tmuxBin) {
    args.push('--tmux', tmuxBin);
  }
  if (process.env.TMUX_TERM_THEMES_DIR) {
    args.push('--themes-dir', process.env.TMUX_TERM_THEMES_DIR);
  }
  return args;
}
