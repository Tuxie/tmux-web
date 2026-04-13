import type { TerminalAdapter } from './types.js';
import type { CellMetrics, TerminalOptions } from '../../shared/types.js';

export class XtermAdapter implements TerminalAdapter {
  private term!: any;
  private fitAddon!: any;
  private useVendor: boolean;

  constructor(useVendor: boolean = false) {
    this.useVendor = useVendor;
  }

  // xterm-dev (DOM renderer) doesn't properly recalculate metrics after font changes.
  // Metric values remain at their initial calculations even after changing fonts.
  // Reload is required to properly initialize metrics with the new font.
  get requiresReloadForFontChange(): boolean {
    return this.useVendor; // xterm-dev is the vendor build (DOM renderer)
  }

  async init(container: HTMLElement, options: TerminalOptions): Promise<void> {
    let xtermMod: any;
    let FitAddonMod: any;

    if (this.useVendor) {
      try {
        xtermMod = await import('/dist/client/vendor-xterm.js');
        FitAddonMod = await import('/dist/client/vendor-xterm-addon-fit.js');
      } catch {
        console.warn('[xterm-dev] vendor build not found, falling back to npm xterm — run: make vendor');
        xtermMod = await import('@xterm/xterm');
        FitAddonMod = await import('@xterm/addon-fit');
      }
    } else {
      xtermMod = await import('@xterm/xterm');
      FitAddonMod = await import('@xterm/addon-fit');
    }

    this.term = new xtermMod.Terminal({
      fontFamily: options.fontFamily,
      // xterm throws for lineHeight < 1; clamp to 1 here, patched below after open()
      fontSize: options.fontSize,
      lineHeight: Math.max(1, options.lineHeight),
      theme: options.theme,
      allowProposedApi: true,
      scrollback: 0,
    });

    this.fitAddon = new FitAddonMod.FitAddon();
    this.term.loadAddon(this.fitAddon);
    this.term.open(container);
    this._applyLineHeight(options.lineHeight);
    this.fitAddon.fit();

    const resizeObserver = new ResizeObserver(() => this.fitAddon.fit());
    resizeObserver.observe(container);
  }

  // xterm rejects lineHeight < 1 via the public setter. For sub-1 values, write the
  // raw option directly (bypassing validation) and force a dimension recalculation.
  // xterm reads rawOptions.lineHeight for cell-height math, so the tighter spacing
  // propagates correctly through fitAddon.fit() and the cursor renderer.
  private _applyLineHeight(lineHeight: number): void {
    if (lineHeight >= 1) {
      this.term.options.lineHeight = lineHeight;
      return;
    }
    const core = this.term._core;
    const rawOpts = core?.optionsService?.rawOptions;
    if (rawOpts) {
      rawOpts.lineHeight = lineHeight;
      // Fire the option change event so the render service runs its full
      // cascade (clear → handleResize → fullRefresh). The public setter
      // rejects values < 1, so we bypass it and fire the event manually.
      core.optionsService._onOptionChange?.fire('lineHeight');
    }
  }

  dispose(): void { this.term?.dispose(); }
  write(data: string | Uint8Array): void { this.term.write(data); }
  onData(cb: (data: string) => void): void { this.term.onData(cb); }
  onResize(cb: (size: { cols: number; rows: number }) => void): void { this.term.onResize(cb); }
  fit(): void { this.fitAddon.fit(); }
  get cols(): number { return this.term.cols; }
  get rows(): number { return this.term.rows; }
  get metrics(): CellMetrics {
    const core = this.term._core;
    const renderer = core?._renderService;
    const dims = renderer?.dimensions;
    if (dims) return { width: dims.css.cell.width, height: dims.css.cell.height };
    return { width: 8, height: 16 };
  }
  focus(): void { this.term.focus(); }
  get element(): HTMLElement {
    return this.term.element || document.getElementById('terminal')!;
  }
  attachCustomWheelEventHandler(handler: (ev: WheelEvent) => boolean): void {
    this.term.attachCustomWheelEventHandler(handler);
  }

  updateOptions(opts: Partial<TerminalOptions>): void {
    if (opts.fontFamily !== undefined) this.term.options.fontFamily = opts.fontFamily;
    if (opts.fontSize !== undefined) this.term.options.fontSize = opts.fontSize;
    if (opts.lineHeight !== undefined) this._applyLineHeight(opts.lineHeight);
    this.fitAddon.fit();
  }
}
