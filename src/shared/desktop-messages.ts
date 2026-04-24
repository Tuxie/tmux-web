export const TMUX_TERM_CLOSE_WINDOW = 'tmux-term:close-window';

export function isTmuxTermCloseWindowMessage(message: unknown): boolean {
  return typeof message === 'object'
    && message !== null
    && (message as { type?: unknown }).type === TMUX_TERM_CLOSE_WINDOW;
}
