export interface KeyboardHandlerOptions {
  terminalElement: HTMLElement;
  send: (data: string) => void;
  toggleFullscreen: () => void;
}

/**
 * Browser-shortcut passthrough. Modified special-key reporting
 * (CSI-u for Shift+Enter, Shift+Tab, Ctrl+Backspace, etc.) is now handled
 * by xterm's built-in Kitty keyboard protocol — enabled via
 * `vtExtensions.kittyKeyboard: true` in the adapter. Applications opt in
 * by writing `CSI > flags u`; xterm then emits the proper sequences.
 */
export function installKeyboardHandler(opts: KeyboardHandlerOptions): () => void {
  function handleShortcuts(ev: KeyboardEvent) {
    if (ev.metaKey && !ev.ctrlKey && ev.key.toLowerCase() === 'r') {
      ev.stopPropagation();
    }
    if (ev.metaKey && !ev.ctrlKey && ev.key.toLowerCase() === 'f') {
      ev.preventDefault();
      ev.stopPropagation();
      opts.toggleFullscreen();
    }
  }

  document.addEventListener('keydown', handleShortcuts, true);

  return () => {
    document.removeEventListener('keydown', handleShortcuts, true);
  };
}
