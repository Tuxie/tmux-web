import {
  TMUX_TERM_CLOSE_WINDOW,
  TMUX_TERM_TITLEBAR_DRAG,
  TMUX_TERM_TOGGLE_MAXIMIZE,
} from '../shared/desktop-messages.js';

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

export function requestDesktopToggleMaximize(win: Window = window): boolean {
  if (typeof win.__electrobunSendToHost !== 'function') return false;
  win.__electrobunSendToHost({ type: TMUX_TERM_TOGGLE_MAXIMIZE });
  return true;
}

export function notifyDesktopTitlebarDrag(win: Window = window): boolean {
  if (typeof win.__electrobunSendToHost !== 'function') return false;
  win.__electrobunSendToHost({ type: TMUX_TERM_TITLEBAR_DRAG });
  return true;
}
