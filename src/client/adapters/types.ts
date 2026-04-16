import type { CellMetrics, TerminalOptions, TerminalTheme } from '../../shared/types.js';

export interface TerminalAdapter {
  init(container: HTMLElement, options: TerminalOptions): Promise<void>;
  dispose(): void;
  write(data: string | Uint8Array): void;
  onData(cb: (data: string) => void): void;
  onResize(cb: (size: { cols: number; rows: number }) => void): void;
  fit(): void;
  readonly cols: number;
  readonly rows: number;
  readonly metrics: CellMetrics;
  focus(): void;
  readonly element: HTMLElement;
  attachCustomWheelEventHandler(handler: (ev: WheelEvent) => boolean): void;
  setTheme(theme: TerminalTheme): void;
  updateOptions?(opts: Partial<TerminalOptions>): void;
  onTitleChange?(cb: (title: string) => void): void;
  /** If true, font changes require page reload to properly recalculate metrics */
  readonly requiresReloadForFontChange?: boolean;
}
