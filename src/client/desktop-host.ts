import { TMUX_TERM_CLOSE_WINDOW } from '../shared/desktop-messages.js';

declare global {
  interface Window {
    __electrobunSendToHost?: (message: unknown) => void;
  }
}

export function requestDesktopWindowClose(win: Window = window): boolean {
  if (typeof win.__electrobunSendToHost !== 'function') return false;
  win.__electrobunSendToHost({ type: TMUX_TERM_CLOSE_WINDOW });
  return true;
}
