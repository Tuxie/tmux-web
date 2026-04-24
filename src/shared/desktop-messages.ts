export const TMUX_TERM_CLOSE_WINDOW = 'tmux-term:close-window';
export const TMUX_TERM_TOGGLE_MAXIMIZE = 'tmux-term:toggle-maximize';
export const TMUX_TERM_TITLEBAR_DRAG = 'tmux-term:titlebar-drag';

export function isTmuxTermCloseWindowMessage(message: unknown): boolean {
  return typeof message === 'object'
    && message !== null
    && (message as { type?: unknown }).type === TMUX_TERM_CLOSE_WINDOW;
}

export function isTmuxTermToggleMaximizeMessage(message: unknown): boolean {
  return typeof message === 'object'
    && message !== null
    && (message as { type?: unknown }).type === TMUX_TERM_TOGGLE_MAXIMIZE;
}

export function isTmuxTermTitlebarDragMessage(message: unknown): boolean {
  return typeof message === 'object'
    && message !== null
    && (message as { type?: unknown }).type === TMUX_TERM_TITLEBAR_DRAG;
}
