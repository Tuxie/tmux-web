export function desktopExtraArgs(): string[] {
  const args: string[] = [];
  const tmuxBin = process.env.TMUX_TERM_TMUX_BIN;
  if (tmuxBin) {
    args.push('--tmux', tmuxBin);
  }
  if (process.env.TMUX_TERM_THEMES_DIR) {
    args.push('--themes-dir', process.env.TMUX_TERM_THEMES_DIR);
  }
  return args;
}
