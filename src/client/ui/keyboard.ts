export interface KeyboardHandlerOptions {
  terminalElement: HTMLElement;
  send: (data: string) => void;
  toggleFullscreen: () => void;
}

/**
 * Browser-shortcut passthrough + a single Shift+Enter intercept.
 *
 * Modified special-key reporting (Shift+Tab, Ctrl+Backspace, etc.) is
 * handled by xterm's built-in Kitty keyboard protocol, enabled via
 * `vtExtensions.kittyKeyboard: true` in the adapter. The catch is that
 * xterm only emits the enhanced encodings when the application opts in
 * by writing `CSI > 1 u`. Claude Code's TUI doesn't, so Shift+Enter
 * would fall back to the legacy encoding — which is just `\r`,
 * indistinguishable from plain Enter. That breaks Claude's "submit
 * with newline" shortcut.
 *
 * Send `CSI 13 ; 2 u` explicitly so Claude (and anything else that
 * grew to understand CSI-u) can tell Shift+Enter from Enter regardless
 * of whether Kitty has been negotiated.
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
    if (ev.key === 'Enter' && ev.shiftKey && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
      ev.preventDefault();
      ev.stopPropagation();
      opts.send('\x1b[13;2u');
    }
    if (ev.key === 'Enter' && ev.ctrlKey && !ev.shiftKey && !ev.altKey && !ev.metaKey) {
      ev.preventDefault();
      ev.stopPropagation();
      opts.send('\x1b[13;5u');
    }
  }

  document.addEventListener('keydown', handleShortcuts, true);

  return () => {
    document.removeEventListener('keydown', handleShortcuts, true);
  };
}
