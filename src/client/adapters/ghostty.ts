import type { TerminalAdapter } from './types.js';
import type { CellMetrics, TerminalOptions } from '../../shared/types.js';

export class GhosttyAdapter implements TerminalAdapter {
  private term!: any;
  private fitAddon!: any;

  async init(container: HTMLElement, options: TerminalOptions): Promise<void> {
    const ghostty = await import('/dist/ghostty-web.js');
    await ghostty.init();

    // ghostty-web expects a bare font name, not a CSS font-family stack.
    // Strip CSS quoting and take the first family from the list.
    const ghosttyFont = options.fontFamily.replace(/^"([^"]+)".*$/, '$1').split(',')[0]!.trim();
    this.term = new ghostty.Terminal({
      fontFamily: ghosttyFont,
      fontSize: options.fontSize,
      theme: options.theme,
    });

    this.fitAddon = new ghostty.FitAddon();
    this.term.loadAddon(this.fitAddon);
    await this.term.open(container);

    const lineHeightPadding = Math.round((options.lineHeight - 1) * options.fontSize);
    if (lineHeightPadding !== 0 && this.term.renderer?.metrics) {
      this.term.renderer.metrics.height += lineHeightPadding;
      this.term.renderer.resize(this.term.cols, this.term.rows);
    }

    this.fitAddon.fit();
    this.fitAddon.observeResize();
  }

  dispose(): void { this.term?.dispose(); }
  write(data: string | Uint8Array): void { this.term.write(data); }
  onData(cb: (data: string) => void): void { this.term.onData(cb); }
  onResize(cb: (size: { cols: number; rows: number }) => void): void { this.term.onResize(cb); }
  fit(): void { this.fitAddon.fit(); }
  get cols(): number { return this.term.cols; }
  get rows(): number { return this.term.rows; }
  get metrics(): CellMetrics {
    const m = this.term.renderer?.getMetrics?.() || this.term.renderer?.metrics;
    return m || { width: 8, height: 16 };
  }
  focus(): void { this.term.focus(); }
  get element(): HTMLElement {
    return this.term.element || this.term._core?.element || document.getElementById('terminal')!;
  }
  attachCustomWheelEventHandler(handler: (ev: WheelEvent) => boolean): void {
    this.term.attachCustomWheelEventHandler(handler);
  }
}
