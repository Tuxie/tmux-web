import { CSI_U_KEYS } from '../../shared/constants.js';

export interface ModifierState {
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

export function getModifierCode(mods: ModifierState): number {
  return 1
    + (mods.shiftKey ? 1 : 0)
    + (mods.altKey ? 2 : 0)
    + (mods.ctrlKey ? 4 : 0)
    + (mods.metaKey ? 8 : 0);
}

export function buildCsiU(keyCode: number, modifier: number): string {
  return `\x1b[${keyCode};${modifier}u`;
}

export interface KeyboardHandlerOptions {
  terminalElement: HTMLElement;
  send: (data: string) => void;
  toggleFullscreen: () => void;
}

export function installKeyboardHandler(opts: KeyboardHandlerOptions): () => void {
  function handleCsiU(ev: KeyboardEvent) {
    const mod = getModifierCode(ev);
    if (mod <= 1) return;
    const code = CSI_U_KEYS[ev.key];
    if (code !== undefined) {
      opts.send(buildCsiU(code, mod));
      ev.stopPropagation();
      ev.preventDefault();
    }
  }

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

  opts.terminalElement.addEventListener('keydown', handleCsiU, true);
  document.addEventListener('keydown', handleShortcuts, true);

  return () => {
    opts.terminalElement.removeEventListener('keydown', handleCsiU, true);
    document.removeEventListener('keydown', handleShortcuts, true);
  };
}
