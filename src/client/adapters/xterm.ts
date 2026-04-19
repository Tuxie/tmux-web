import type { TerminalAdapter } from './types.js';
import type { CellMetrics, TerminalOptions, TerminalTheme } from '../../shared/types.js';
import { getWebglEnabled } from '../prefs.js';

const XTERM_COLOR_MODE_MASK = 0x3000000;
const XTERM_COLOR_MODE_P16 = 0x1000000;
const XTERM_COLOR_MODE_P256 = 0x2000000;
const XTERM_COLOR_MODE_RGB = 0x3000000;
const XTERM_FG_FLAG_INVERSE = 0x4000000;
const XTERM_RGB_MASK = 0xffffff;

export class XtermAdapter implements TerminalAdapter {
  private term!: any;
  private fitAddon!: any;
  private webglAddon: any | null = null;
  private tuiBackgroundAlpha = 1;

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
    this._setTuiOpacity(options.tuiOpacity);
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

    // Keep allowTransparency OFF so xterm's WebGL atlas uses subpixel AA
    // (opaque tmpCanvas + clearColor). composeTheme feeds xterm a
    // theme.background pre-blended with the body backdrop at the current
    // opacity, so glyph halos come out of the atlas already matching
    // what's behind the terminal: no coloured fringing at any opacity.
    // RectangleRenderer skips default-bg cells, so the #page alpha slider
    // keeps driving the visible transparency.
    this.term = new Terminal({
      fontFamily: options.fontFamily,
      // xterm throws for lineHeight < 1; clamp to 1 here, patched below after open()
      fontSize: options.fontSize,
      lineHeight: Math.max(1, options.lineHeight),
      theme: options.theme,
      allowTransparency: false,
      allowProposedApi: true,
      scrollback: 0,
      // @ts-expect-error: scrollbar is a vendored extension not in @xterm/xterm npm types
      scrollbar: { showScrollbar: false },
      // Opt-in to xterm's built-in Kitty keyboard protocol
      // (https://sw.kovidgoyal.net/kitty/keyboard-protocol/). When
      // applications negotiate via `CSI > flags u`, xterm emits proper
      // CSI-u sequences for modified keys — we no longer need to hand-roll
      // Shift+Enter / Shift+Tab / etc. in ui/keyboard.ts.
      vtExtensions: { kittyKeyboard: true },
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
        this._patchWebglLineHeightOverflow();
        this._patchWebglExplicitBackgroundOpacity();
      } catch (err) {
        console.warn('WebGL renderer unavailable, falling back to DOM:', err);
      }
    }

    this._applyLineHeight(options.lineHeight);
    this.fitAddon.fit();
  }

  // With lineHeight < 1 the WebGL renderer floors cellHeight = charHeight *
  // lineHeight, so cellHeight < charHeight. By default xterm centers the glyph
  // vertically in its cell (char.top = (cellH - charH)/2), so glyphs overflow
  // both the top and bottom of each cell by (charH-cellH)/2 pixels. For the
  // bottom row, the overflow below extends past the canvas buffer (which is
  // sized to rows*cellH) and gets clipped — visible as missing descender
  // pixels on the last line.
  //
  // Padding canvas.height doesn't fix it: the GlyphRenderer's per-cell
  // `a_cellpos` is `(x/cols, y/rows)` in grid-fraction space, so any canvas
  // height change stretches cell positions non-uniformly relative to bg
  // rectangles.
  //
  // Workaround: anchor glyph bottoms to cell bottoms by rewriting char.top
  // to `cellH - charH` (negative). Last row's descenders now fit; rows above
  // lose the bottom half of their overflow (which previously overlapped the
  // next row's top anyway). Row 0's top sheds a small strip of ascender
  // headroom — typically empty space in monospace fonts.
  private _patchWebglLineHeightOverflow(): void {
    // _renderService._renderer is a MutableDisposable wrapper; the actual
    // WebglRenderer sits at .value.
    const renderer: any = this.term?._core?._renderService?._renderer?.value;
    if (!renderer || typeof renderer._updateDimensions !== 'function') return;
    if (renderer.__tmuxWebLineHeightPatched) return;
    renderer.__tmuxWebLineHeightPatched = true;
    const orig = renderer._updateDimensions.bind(renderer);
    renderer._updateDimensions = () => {
      orig();
      const d = renderer.dimensions;

      // Round instead of floor for char.width so the cumulative floor error
      // (natural advance - floored cell width) is redistributed symmetrically.
      // Upstream uses Math.floor which always under-sizes the cell, leaving
      // the glyph visually crowded against the next column; rounding caps the
      // error at ±0.5 device px per cell and makes fonts whose natural advance
      // has a >0.5 fractional component render noticeably sharper.
      const charSize = renderer._charSizeService;
      const dpr = renderer._devicePixelRatio || 1;
      if (charSize && typeof charSize.width === 'number') {
        const newCharW = Math.round(charSize.width * dpr);
        const ls = Math.round(renderer._optionsService?.rawOptions?.letterSpacing ?? 0);
        d.device.char.width = newCharW;
        d.device.cell.width = newCharW + ls;
        d.css.cell.width = d.device.cell.width / dpr;
        d.device.canvas.width = this.term.cols * d.device.cell.width;
        d.css.canvas.width = Math.round(d.device.canvas.width / dpr);
      }

      if (d.device.cell.height < d.device.char.height) {
        d.device.char.top = d.device.cell.height - d.device.char.height;
      }
    };
    renderer.handleResize(this.term.cols, this.term.rows);
    this._patchWebglAtlasFilter(renderer);
  }

  // WebGL draws non-default SGR backgrounds as rectangle runs, separately
  // from glyphs and the default viewport background. Lower only those
  // rectangle alphas so app highlights can show some of the terminal/page
  // backdrop through while keeping allowTransparency=false for glyph quality.
  private _patchWebglExplicitBackgroundOpacity(): void {
    const renderer: any = this.term?._core?._renderService?._renderer?.value;
    if (!renderer) return;
    const adapter = this;

    const patchRectangleRenderer = (rectangleRenderer: any): void => {
      if (!rectangleRenderer || rectangleRenderer.__tmuxWebBgOpacityPatched) return;
      if (typeof rectangleRenderer._updateRectangle !== 'function') return;
      rectangleRenderer.__tmuxWebBgOpacityPatched = true;
      if (typeof rectangleRenderer.updateBackgrounds === 'function') {
        const origUpdateBackgrounds = rectangleRenderer.updateBackgrounds.bind(rectangleRenderer);
        rectangleRenderer.updateBackgrounds = function (model: unknown) {
          this.__tmuxWebBgOpacityModel = model;
          try {
            const result = origUpdateBackgrounds(model);
            // The viewport rect sits at offset 0 with RGB = theme.bg and
            // alpha = 0; under premultiplied compositing that would add
            // theme.bg on top of the page. Zero its colour so default-bg
            // areas leave the canvas transparent and CSS can composite
            // #page + body (solid, gradient, or image) unaltered.
            const attrs = this._vertices?.attributes;
            if (attrs && attrs.length >= 8) {
              attrs[4] = 0; attrs[5] = 0; attrs[6] = 0; attrs[7] = 0;
            }
            return result;
          } finally {
            this.__tmuxWebBgOpacityModel = undefined;
          }
        };
      }
      const orig = rectangleRenderer._updateRectangle.bind(rectangleRenderer);
      rectangleRenderer._updateRectangle = function (
        vertices: { attributes?: Float32Array },
        offset: number,
        fg: number,
        bg: number,
        startX: number,
        endX: number,
        y: number,
      ) {
        orig(vertices, offset, fg, bg, startX, endX, y);
        if (
          vertices.attributes &&
          offset + 7 < vertices.attributes.length &&
          shouldApplyBackgroundOpacity(this, fg, bg, startX, endX, y)
        ) {
          // Premultiply: shader will output (rgb × α, α) so the canvas
          // (premultipliedAlpha:true) composites as ansi × α + page × (1-α).
          // Combined with the renderBackgrounds blend-func swap to
          // ONE × ONE_MINUS_SRC_ALPHA below, this produces a linear fade
          // into whatever #page + body actually shows (including gradients
          // and images that composeTheme can't see via body.backgroundColor).
          const a = adapter.tuiBackgroundAlpha;
          const attrs = vertices.attributes;
          attrs[offset + 4] = attrs[offset + 4] * a;
          attrs[offset + 5] = attrs[offset + 5] * a;
          attrs[offset + 6] = attrs[offset + 6] * a;
          attrs[offset + 7] = a;
        }
      };

      if (typeof rectangleRenderer.renderBackgrounds === 'function') {
        const origRenderBackgrounds = rectangleRenderer.renderBackgrounds.bind(rectangleRenderer);
        rectangleRenderer.renderBackgrounds = function () {
          const gl = rectangleRenderer._gl ?? renderer._gl;
          if (!gl) return origRenderBackgrounds();
          // Rect attributes are premultiplied below; the framebuffer must
          // start empty each frame or successive renderBackgrounds calls
          // (cursor blink, slider drag, etc.) accumulate into it — with
          // preserveDrawingBuffer:false the spec only guarantees a clear
          // *after compositor read*, not between in-task draws. Clearing
          // explicitly here keeps the per-frame math linear.
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);
          // Switch blend factors to ONE × (1-srcA) so premultiplied src
          // writes the intended (rgb × α, α) tuple. Restore SRC_ALPHA ×
          // (1-srcA) after so the glyph pass blends straight-alpha texture
          // samples normally.
          gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
          try {
            origRenderBackgrounds();
          } finally {
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
          }
        };
      }
    };

    const shouldApplyBackgroundOpacity = (
      rectangleRenderer: any,
      fg: number,
      bg: number,
      startX: number,
      endX: number,
      y: number,
    ): boolean => {
      const effectiveBg = effectiveBackgroundAttr(fg, bg);
      const colorMode = effectiveBg & XTERM_COLOR_MODE_MASK;
      if (
        colorMode !== XTERM_COLOR_MODE_P16 &&
        colorMode !== XTERM_COLOR_MODE_P256 &&
        colorMode !== XTERM_COLOR_MODE_RGB
      ) {
        return false;
      }
      const model = rectangleRenderer.__tmuxWebBgOpacityModel ?? renderer._model;
      const cursor = model?.cursor;
      if (
        cursor &&
        y === cursor.y &&
        startX < cursor.x + cursor.width &&
        endX > cursor.x
      ) {
        return false;
      }
      return true;
    };

    const effectiveBackgroundAttr = (fg: number, bg: number): number => {
      return (fg & XTERM_FG_FLAG_INVERSE) ? fg : bg;
    };

    const resolveAttrRgba = (attr: number, defaultRgba: number): number => {
      switch (attr & XTERM_COLOR_MODE_MASK) {
        case XTERM_COLOR_MODE_P16:
        case XTERM_COLOR_MODE_P256:
          return renderer._themeService?.colors?.ansi?.[attr & 0xff]?.rgba ?? defaultRgba;
        case XTERM_COLOR_MODE_RGB:
          return ((attr & XTERM_RGB_MASK) << 8) | 0xff;
        default:
          return defaultRgba;
      }
    };

    const blendRgbaOverDefaultBackground = (rgba: number): number => {
      const base = renderer._themeService?.colors?.background?.rgba ?? 0x000000ff;
      const a = adapter.tuiBackgroundAlpha;
      const r = Math.round(((rgba >> 24) & 0xff) * a + ((base >> 24) & 0xff) * (1 - a));
      const g = Math.round(((rgba >> 16) & 0xff) * a + ((base >> 16) & 0xff) * (1 - a));
      const b = Math.round(((rgba >> 8) & 0xff) * a + ((base >> 8) & 0xff) * (1 - a));
      return (r << 16) | (g << 8) | b;
    };

    const withBlendedEffectiveBackground = (fg: number, bg: number): { fg: number; bg: number } => {
      const defaultRgba = (fg & XTERM_FG_FLAG_INVERSE)
        ? (renderer._themeService?.colors?.foreground?.rgba ?? 0xffffffff)
        : (renderer._themeService?.colors?.background?.rgba ?? 0x000000ff);
      const effectiveBg = effectiveBackgroundAttr(fg, bg);
      const colorMode = effectiveBg & XTERM_COLOR_MODE_MASK;
      if (
        colorMode !== XTERM_COLOR_MODE_P16 &&
        colorMode !== XTERM_COLOR_MODE_P256 &&
        colorMode !== XTERM_COLOR_MODE_RGB
      ) {
        return { fg, bg };
      }
      const blendedRgb = blendRgbaOverDefaultBackground(resolveAttrRgba(effectiveBg, defaultRgba));
      if (fg & XTERM_FG_FLAG_INVERSE) {
        return {
          fg: (fg & ~(XTERM_RGB_MASK | XTERM_COLOR_MODE_MASK)) | XTERM_COLOR_MODE_RGB | blendedRgb,
          bg,
        };
      }
      return {
        fg,
        bg: (bg & ~(XTERM_RGB_MASK | XTERM_COLOR_MODE_MASK)) | XTERM_COLOR_MODE_RGB | blendedRgb,
      };
    };

    const patchGlyphRenderer = (glyphRenderer: any): void => {
      if (!glyphRenderer || glyphRenderer.__tmuxWebBgOpacityPatched) return;
      if (typeof glyphRenderer.updateCell !== 'function') return;
      glyphRenderer.__tmuxWebBgOpacityPatched = true;
      const orig = glyphRenderer.updateCell.bind(glyphRenderer);
      glyphRenderer.updateCell = function (
        x: number,
        y: number,
        code: number,
        bg: number,
        fg: number,
        ext: number,
        chars: string,
        width: number,
        lastBg: number,
      ) {
        if (shouldApplyBackgroundOpacity(this, fg, bg, x, x + Math.max(width || 1, 1), y)) {
          const current = withBlendedEffectiveBackground(fg, bg);
          const previous = withBlendedEffectiveBackground(fg, lastBg);
          return orig(x, y, code, current.bg, current.fg, ext, chars, width, previous.bg);
        }
        return orig(x, y, code, bg, fg, ext, chars, width, lastBg);
      };
    };

    patchRectangleRenderer(renderer._rectangleRenderer?.value);
    patchGlyphRenderer(renderer._glyphRenderer?.value);

    if (renderer.__tmuxWebBgOpacityInitPatched || typeof renderer._initializeWebGLState !== 'function') return;
    renderer.__tmuxWebBgOpacityInitPatched = true;
    const origInit = renderer._initializeWebGLState.bind(renderer);
    renderer._initializeWebGLState = () => {
      const result = origInit();
      patchRectangleRenderer(renderer._rectangleRenderer?.value);
      patchGlyphRenderer(renderer._glyphRenderer?.value);
      return result;
    };
  }

  private _setTuiOpacity(opacityPct: number | undefined): void {
    const pct = Number.isFinite(opacityPct) ? opacityPct! : 100;
    this.tuiBackgroundAlpha = Math.max(0, Math.min(100, pct)) / 100;
  }

  // Force NEAREST-neighbour sampling on the glyph atlas texture. xterm's
  // WebGL addon leaves TEXTURE_MAG_FILTER at the WebGL default (LINEAR),
  // which bilinearly blends neighbouring texels whenever the glyph quad
  // and atlas texels don't line up exactly — always the case at
  // fractional-dpr layouts or after float→int rounding. For outline fonts
  // the atlas is already anti-aliased and there's nothing to blend so
  // LINEAR and NEAREST produce identical output, but bitmap fonts (e.g.
  // Topaz8 as TTF) get their hard pixel edges smeared and the strokes
  // appear visibly thinner. Setting both MIN and MAG to NEAREST keeps
  // bitmap glyphs pixel-exact without affecting smooth fonts.
  private _patchWebglAtlasFilter(renderer: any): void {
    const glyphRenderer: any = renderer?._glyphRenderer?.value;
    if (!glyphRenderer || typeof glyphRenderer._bindAtlasPageTexture !== 'function') return;
    if (glyphRenderer.__tmuxWebFilterPatched) return;
    glyphRenderer.__tmuxWebFilterPatched = true;
    const orig = glyphRenderer._bindAtlasPageTexture.bind(glyphRenderer);
    glyphRenderer._bindAtlasPageTexture = function (gl: WebGL2RenderingContext, atlas: unknown, i: number) {
      orig(gl, atlas, i);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    };
    // Force the next frame to rebind textures with the new filters.
    for (const t of glyphRenderer._atlasTextures ?? []) {
      if (t) t.version = -1;
    }
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
    if (opts.tuiOpacity !== undefined) {
      this._setTuiOpacity(opts.tuiOpacity);
      this.webglAddon?.clearTextureAtlas?.();
      this.term.refresh?.(0, Math.max(0, (this.term.rows ?? 1) - 1));
    }
    // opacity lives in theme.background (pre-blended against body); no
    // allowTransparency toggle here.
    this.fitAddon.fit();
  }

  onTitleChange(cb: (title: string) => void): void {
    this.term.onTitleChange(cb);
  }
}
