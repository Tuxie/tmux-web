import { describe, expect, mock, test } from 'bun:test';
import type { TerminalTheme } from '../../../src/shared/types.js';

describe('XtermAdapter', () => {
  const xtermP16Background = 0x1000000 | 1;
  const xtermP16PreviousBackground = 0x1000000 | 3;
  const xtermRgbBackground = 0x3000000 | 0x123456;
  const xtermInverseForeground = 0x4000000 | 0x1000000 | 7;
  const xtermDimDefaultBackground = 0x8000000;
  const xtermRgbBlendedRedBackground = 0x3000000 | 0x460000;

  test('writes theme through to the underlying terminal options', async () => {
    const { XtermAdapter } = await import('../../../src/client/adapters/xterm.ts');
    const adapter = new XtermAdapter();
    const theme: TerminalTheme = {
      background: '#000000',
      foreground: '#ffffff',
    };
    (adapter as any).term = {
      options: {},
    };

    adapter.setTheme(theme);

    expect((adapter as any).term.options.theme).toBe(theme);
  });

  test('passes allowTransparency to the xterm Terminal constructor', async () => {
    const terminalCtor = mock(() => {
      const instance = {
        loadAddon: mock(() => {}),
        open: mock(() => {}),
        options: {},
        write: mock(() => {}),
        onData: mock(() => {}),
        onResize: mock(() => {}),
        fit: mock(() => {}),
        focus: mock(() => {}),
        attachCustomWheelEventHandler: mock(() => {}),
        dispose: mock(() => {}),
        cols: 80,
        rows: 24,
        element: undefined,
        _core: {
          renderer: { _renderer: { _type: 'dom' } },
          optionsService: {
            rawOptions: { lineHeight: 1 },
            _onOptionChange: { fire: mock(() => {}) },
          },
          _renderService: { dimensions: { css: { cell: { width: 8, height: 16 } } } },
        },
      };

      return instance;
    });

    mock.module('@xterm/xterm', () => ({
      Terminal: terminalCtor,
    }));

    mock.module('@xterm/addon-fit', () => ({
      FitAddon: class {
        fit = mock(() => {});
      },
    }));
    mock.module('@xterm/addon-unicode-graphemes', () => ({
      UnicodeGraphemesAddon: class {},
    }));
    mock.module('@xterm/addon-web-links', () => ({
      WebLinksAddon: class { constructor(_h?: unknown) {} },
    }));
    mock.module('@xterm/addon-web-fonts', () => ({
      WebFontsAddon: class { constructor(_f?: unknown) {} },
    }));
    mock.module('@xterm/addon-image', () => ({
      ImageAddon: class { constructor(_o?: unknown) {} },
    }));
    mock.module('@xterm/addon-webgl', () => ({
      WebglAddon: class {
        onContextLoss = () => ({ dispose: mock(() => {}) });
        dispose = mock(() => {});
      },
    }));

    (globalThis as any).ResizeObserver = class {
      constructor(_cb: () => void) {}
      observe() {}
    };

    (globalThis as any).HTMLElement = class {};
    const container = new HTMLElement() as HTMLElement;

    const { XtermAdapter } = await import('../../../src/client/adapters/xterm.ts');
    const adapter = new XtermAdapter();

    await adapter.init(container, {
      fontFamily: 'monospace',
      fontSize: 14,
      lineHeight: 1,
      theme: {
        background: '#000000',
        foreground: '#ffffff',
      },
      opacity: 100,
      tuiBgOpacity: 100,
      tuiFgOpacity: 100,
      fgContrastStrength: 0,
      fgContrastBias: 0,
      // Stale callers/preferences must not be able to disable subpixel AA.
      subpixelAA: false,
    } as any);

    // allowTransparency is intentionally false so xterm's WebGL atlas uses
    // canvas-2d subpixel AA. See composeTheme + adapter for the rationale.
    expect(terminalCtor.mock.calls[0]?.[0]).toMatchObject({ allowTransparency: false });
  });

  test('patches WebGL explicit background rectangles to be translucent', async () => {
    const { XtermAdapter } = await import('../../../src/client/adapters/xterm.ts');
    const adapter = new XtermAdapter();
    (adapter as any).tuiBgAlpha = 0.7;
    const vertices = { attributes: new Float32Array(16) };
    const writeRgb = (v: Float32Array, offset: number) => {
      v[offset + 4] = 1; v[offset + 5] = 0; v[offset + 6] = 0; v[offset + 7] = 1;
    };
    const updateRectangle = mock((vertices: { attributes: Float32Array }, offset: number) => {
      writeRgb(vertices.attributes, offset);
    });
    const rectangleRenderer = {
      _terminal: { cols: 2, buffer: { active: { viewportY: 0 } } },
      _updateRectangle: updateRectangle,
      updateBackgrounds() {
        this._updateRectangle(vertices, 0, 0, xtermP16Background, 0, 1, 0);
      },
    };
    const renderer = {
      _rectangleRenderer: { value: rectangleRenderer },
      _themeService: { colors: { background: { rgba: 0x000000ff } } },
      _initializeWebGLState: mock(() => [rectangleRenderer, {}]),
    };
    (adapter as any).term = {
      _core: {
        _renderService: {
          _renderer: { value: renderer },
        },
      },
    };

    (adapter as any)._patchWebglExplicitBackgroundOpacity();

    rectangleRenderer._updateRectangle(vertices, 0, 0, xtermP16Background, 0, 1, 0);
    // Premultiplied: rgb*=α, alpha=α. rgb=(1,0,0) × 0.7 = (0.7,0,0); alpha=0.7
    expect(vertices.attributes[4]).toBeCloseTo(0.7, 5);
    expect(vertices.attributes[5]).toBeCloseTo(0, 5);
    expect(vertices.attributes[6]).toBeCloseTo(0, 5);
    expect(vertices.attributes[7]).toBeCloseTo(0.7, 5);

    const nextRectangleRenderer = {
      _updateRectangle: mock((v: { attributes: Float32Array }, offset: number) => {
        writeRgb(v.attributes, offset);
      }),
    };
    renderer._rectangleRenderer.value = nextRectangleRenderer;
    renderer._initializeWebGLState();
    const nextVertices = { attributes: new Float32Array(16) };
    nextRectangleRenderer._updateRectangle(nextVertices, 0, 0, xtermP16Background, 0, 1, 0);
    expect(nextVertices.attributes[4]).toBeCloseTo(0.7, 5);
    expect(nextVertices.attributes[7]).toBeCloseTo(0.7, 5);
  });

  test('keeps WebGL cursor rectangles opaque and makes other highlighted backgrounds translucent', async () => {
    const { XtermAdapter } = await import('../../../src/client/adapters/xterm.ts');
    const adapter = new XtermAdapter();
    (adapter as any).tuiBgAlpha = 0.7;
    const vertices = { attributes: new Float32Array(16) };
    const writeRgb = (v: Float32Array, offset: number) => {
      v[offset + 4] = 1; v[offset + 5] = 0; v[offset + 6] = 0; v[offset + 7] = 1;
    };
    const rectangleRenderer = {
      _terminal: { cols: 2, buffer: { active: { viewportY: 0 } } },
      _vertices: vertices,
      _updateRectangle(v: { attributes: Float32Array }, offset: number) {
        writeRgb(v.attributes, offset);
      },
      updateBackgrounds(model: any) {
        // Simulate the production pattern: rect 0 is viewport (set up
        // separately) and bg rects start at offset 8.
        this._updateRectangle(vertices, 8, 0, xtermP16Background, 0, 2, 0);
      },
    };
    const renderer = {
      _rectangleRenderer: { value: rectangleRenderer },
      _themeService: { colors: { background: { rgba: 0x000000ff } } },
      _initializeWebGLState: mock(() => [rectangleRenderer, {}]),
    };
    (adapter as any).term = {
      _core: {
        _renderService: {
          _renderer: { value: renderer },
        },
      },
    };

    (adapter as any)._patchWebglExplicitBackgroundOpacity();

    rectangleRenderer.updateBackgrounds({
      selection: {
        hasSelection: true,
        isCellSelected: (_terminal: unknown, x: number, y: number) => x === 1 && y === 0,
      },
    });
    // Non-cursor highlighted cells are premultiplied: rgb*=α, alpha=α.
    // Viewport rect (offset 0) is zeroed so default cells stay transparent.
    expect(vertices.attributes[4]).toBe(0);
    expect(vertices.attributes[7]).toBe(0);
    // And the rect rect's premul tuple is at offset 8 (rect index 1).
    expect(vertices.attributes[12]).toBeCloseTo(0.7, 5);
    expect(vertices.attributes[15]).toBeCloseTo(0.7, 5);

    vertices.attributes.fill(0);
    rectangleRenderer.updateBackgrounds({
      cursor: { x: 1, y: 0, width: 1 },
      selection: { hasSelection: false },
    });
    // Cursor-overlapping rect stays opaque at ansi colour (no premul)
    expect(vertices.attributes[12]).toBe(1);
    expect(vertices.attributes[15]).toBe(1);

    vertices.attributes.fill(0);
    rectangleRenderer._updateRectangle(vertices, 0, xtermInverseForeground, xtermP16Background, 0, 2, 0);
    // Inverse fg path still goes through the blend
    expect(vertices.attributes[4]).toBeCloseTo(0.7, 5);
    expect(vertices.attributes[7]).toBeCloseTo(0.7, 5);
  });

  test('clears style-only default background rectangles so dim text stays transparent', async () => {
    const { XtermAdapter } = await import('../../../src/client/adapters/xterm.ts');
    const adapter = new XtermAdapter();
    (adapter as any).tuiBgAlpha = 0.7;
    const vertices = { attributes: new Float32Array(16) };
    const rectangleRenderer = {
      _updateRectangle(v: { attributes: Float32Array }, offset: number) {
        v.attributes[offset + 4] = 0.2;
        v.attributes[offset + 5] = 0.2;
        v.attributes[offset + 6] = 0.2;
        v.attributes[offset + 7] = 1;
      },
    };
    const renderer = {
      _rectangleRenderer: { value: rectangleRenderer },
      _themeService: { colors: { background: { rgba: 0x333333ff } } },
      _initializeWebGLState: mock(() => [rectangleRenderer, {}]),
    };
    (adapter as any).term = {
      _core: {
        _renderService: {
          _renderer: { value: renderer },
        },
      },
    };

    (adapter as any)._patchWebglExplicitBackgroundOpacity();

    rectangleRenderer._updateRectangle(vertices, 0, 0, xtermDimDefaultBackground, 0, 2, 0);
    expect(vertices.attributes[4]).toBe(0);
    expect(vertices.attributes[5]).toBe(0);
    expect(vertices.attributes[6]).toBe(0);
    expect(vertices.attributes[7]).toBe(0);
  });

  test('makes WebGL RGB and text-bearing app background rectangles translucent and rasterizes glyphs against the blended background', async () => {
    const { XtermAdapter } = await import('../../../src/client/adapters/xterm.ts');
    const adapter = new XtermAdapter();
    (adapter as any).tuiBgAlpha = 0.7;
    const vertices = { attributes: new Float32Array(16) };
    const glyphUpdateCell = mock(() => {});
    const writeRgb = (v: Float32Array, offset: number) => {
      v[offset + 4] = 1; v[offset + 5] = 0; v[offset + 6] = 0; v[offset + 7] = 1;
    };
    const rectangleRenderer = {
      _terminal: { cols: 2, buffer: { active: { viewportY: 0 } } },
      _vertices: vertices,
      _updateRectangle(v: { attributes: Float32Array }, offset: number) {
        writeRgb(v.attributes, offset);
      },
      updateBackgrounds(model: any) {
        this._updateRectangle(vertices, 8, 0, xtermP16Background, 0, 2, 0);
      },
    };
    const renderer = {
      _rectangleRenderer: { value: rectangleRenderer },
      _glyphRenderer: { value: { _terminal: { cols: 2 }, updateCell: glyphUpdateCell } },
      _themeService: {
        colors: {
          background: { rgba: 0x000000ff },
          foreground: { rgba: 0xffffffff },
          ansi: [
            { rgba: 0x000000ff },
            { rgba: 0x640000ff },
            { rgba: 0x00ff00ff },
            { rgba: 0xffff00ff },
            { rgba: 0x0000ffff },
            { rgba: 0xff00ffff },
            { rgba: 0x00ffffff },
            { rgba: 0xffffffff },
          ],
        },
      },
      _initializeWebGLState: mock(() => [rectangleRenderer, {}]),
    };
    (adapter as any).term = {
      _core: {
        _renderService: {
          _renderer: { value: renderer },
        },
      },
    };

    (adapter as any)._patchWebglExplicitBackgroundOpacity();

    rectangleRenderer._updateRectangle(vertices, 0, 0, xtermRgbBackground, 0, 2, 0);
    expect(vertices.attributes[4]).toBeCloseTo(0.7, 5);
    expect(vertices.attributes[7]).toBeCloseTo(0.7, 5);

    vertices.attributes.fill(0);
    rectangleRenderer.updateBackgrounds({
      cells: new Uint32Array([
        32, 0, 0, 0,
        'A'.charCodeAt(0), 0, 0, 0,
      ]),
      selection: { hasSelection: false },
    });
    // Viewport rect at offset 0 is zeroed out, and ansi rect at offset 8
    // gets premultiplied.
    expect(vertices.attributes[4]).toBe(0);
    expect(vertices.attributes[7]).toBe(0);
    expect(vertices.attributes[12]).toBeCloseTo(0.7, 5);
    expect(vertices.attributes[15]).toBeCloseTo(0.7, 5);

    vertices.attributes.fill(0);
    rectangleRenderer.updateBackgrounds({
      cells: new Uint32Array([
        32, 0, 0, 0,
        0, 0, 0, 0,
      ]),
      selection: { hasSelection: false },
    });
    expect(vertices.attributes[12]).toBeCloseTo(0.7, 5);
    expect(vertices.attributes[15]).toBeCloseTo(0.7, 5);

    renderer._glyphRenderer.value.updateCell(0, 0, 'A'.charCodeAt(0), xtermP16Background, 0, 0, 'A', 1, xtermP16PreviousBackground);
    expect(glyphUpdateCell.mock.calls.at(-1)?.[3]).toBe(xtermRgbBlendedRedBackground);
  });

  test('uses configured TUI opacity for WebGL explicit background rectangles and glyph blending', async () => {
    const { XtermAdapter } = await import('../../../src/client/adapters/xterm.ts');
    const adapter = new XtermAdapter();
    (adapter as any).tuiBgAlpha = 0.25;
    const vertices = { attributes: new Float32Array(16) };
    const glyphUpdateCell = mock(() => {});
    const rectangleRenderer = {
      _updateRectangle(v: { attributes: Float32Array }, offset: number) {
        v.attributes[offset + 4] = 1; v.attributes[offset + 5] = 0; v.attributes[offset + 6] = 0;
        v.attributes[offset + 7] = 1;
      },
    };
    const renderer = {
      _rectangleRenderer: { value: rectangleRenderer },
      _glyphRenderer: { value: { updateCell: glyphUpdateCell } },
      _themeService: {
        colors: {
          background: { rgba: 0x000000ff },
          foreground: { rgba: 0xffffffff },
          ansi: [
            { rgba: 0x000000ff },
            { rgba: 0x640000ff },
          ],
        },
      },
      _initializeWebGLState: mock(() => [rectangleRenderer, {}]),
    };
    (adapter as any).term = {
      _core: {
        _renderService: {
          _renderer: { value: renderer },
        },
      },
    };

    (adapter as any)._patchWebglExplicitBackgroundOpacity();

    rectangleRenderer._updateRectangle(vertices, 0, 0, xtermP16Background, 0, 1, 0);
    // Premultiplied: rgb=(1,0,0) × 0.25 = (0.25,0,0); alpha=0.25
    expect(vertices.attributes[4]).toBeCloseTo(0.25, 5);
    expect(vertices.attributes[7]).toBeCloseTo(0.25, 5);

    renderer._glyphRenderer.value.updateCell(0, 0, 'A'.charCodeAt(0), xtermP16Background, 0, 0, 'A', 1, xtermP16PreviousBackground);
    expect(glyphUpdateCell.mock.calls.at(-1)?.[3]).toBe(0x3000000 | 0x190000);
  });

  test('updates TUI opacity without recreating the terminal', async () => {
    const { XtermAdapter } = await import('../../../src/client/adapters/xterm.ts');
    const adapter = new XtermAdapter();
    const refresh = mock(() => {});
    const clearTextureAtlas = mock(() => {});
    const fit = mock(() => {});
    (adapter as any).term = {
      options: {},
      rows: 24,
      refresh,
    };
    (adapter as any).webglAddon = { clearTextureAtlas };
    (adapter as any).fitAddon = { fit };

    adapter.updateOptions({ tuiBgOpacity: 35 });

    expect((adapter as any).tuiBgAlpha).toBeCloseTo(0.35, 5);
    expect(clearTextureAtlas).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledWith(0, 23);
    expect(fit).toHaveBeenCalled();
  });
});
