import type { TerminalAdapter } from './types.js';
import type { CellMetrics, TerminalOptions, TerminalTheme } from '../../shared/types.js';
import { getWebglEnabled } from '../prefs.js';

export class XtermAdapter implements TerminalAdapter {
  private term!: any;
  private fitAddon!: any;
  private webglAddon: any | null = null;

  constructor() {}

  // xterm (DOM renderer) doesn't properly recalculate metrics after font changes.
  // Metric values remain at their initial calculations even after changing fonts.
  // Reload is required to properly initialize metrics with the new font.
  get requiresReloadForFontChange(): boolean {
    // WebGL and canvas renderers recompute metrics on option change; only the
    // DOM fallback is stuck. webglAddon presence proves we aren't on DOM.
    if (this.webglAddon) return false;
    return this.term?._core?.renderer?._renderer?._type === 'dom';
  }

  async init(container: HTMLElement, options: TerminalOptions): Promise<void> {
    const [
      { Terminal },
      { FitAddon },
      { UnicodeGraphemesAddon },
      { WebLinksAddon },
      { WebFontsAddon },
      { ImageAddon },
    ] = await Promise.all([
      import('@xterm/xterm'),
      import('@xterm/addon-fit'),
      import('@xterm/addon-unicode-graphemes'),
      import('@xterm/addon-web-links'),
      import('@xterm/addon-web-fonts'),
      import('@xterm/addon-image'),
    ]);

    this.term = new Terminal({
      fontFamily: options.fontFamily,
      // xterm throws for lineHeight < 1; clamp to 1 here, patched below after open()
      fontSize: options.fontSize,
      lineHeight: Math.max(1, options.lineHeight),
      theme: options.theme,
      allowTransparency: true,
      allowProposedApi: true,
      scrollback: 0,
      scrollbar: { showScrollbar: false },
    });

    this.fitAddon = new FitAddon();
    this.term.loadAddon(this.fitAddon);
    this.term.open(container);

    // Load remaining addons AFTER open — ImageAddon and friends poke at
    // core._inputHandler, which isn't wired up until open().
    const safeLoad = (make: () => any, name: string) => {
      try { this.term.loadAddon(make()); }
      catch (err) { console.warn(`${name} addon failed, skipping:`, err); }
    };
    safeLoad(() => new UnicodeGraphemesAddon(), 'unicode-graphemes');
    safeLoad(() => new WebLinksAddon(), 'web-links');
    safeLoad(() => new WebFontsAddon(), 'web-fonts');
    safeLoad(() => new ImageAddon(), 'image');

    if (getWebglEnabled()) {
      try {
        const { WebglAddon } = await import('@xterm/addon-webgl');
        const addon = new WebglAddon();
        addon.onContextLoss(() => {
          addon.dispose();
          this.webglAddon = null;
        });
        this.term.loadAddon(addon);
        this.webglAddon = addon;
      } catch (err) {
        console.warn('WebGL renderer unavailable, falling back to DOM:', err);
      }
    }

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

  setTheme(theme: TerminalTheme): void {
    this.term.options.theme = theme;
  }

  updateOptions(opts: Partial<TerminalOptions>): void {
    if (opts.fontFamily !== undefined) this.term.options.fontFamily = opts.fontFamily;
    if (opts.fontSize !== undefined) this.term.options.fontSize = opts.fontSize;
    if (opts.lineHeight !== undefined) this._applyLineHeight(opts.lineHeight);
    this.fitAddon.fit();
  }

  onTitleChange(cb: (title: string) => void): void {
    this.term.onTitleChange(cb);
  }
}
