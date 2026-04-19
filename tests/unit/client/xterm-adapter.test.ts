import { describe, expect, mock, test } from 'bun:test';
import type { TerminalTheme } from '../../../src/shared/types.js';

describe('XtermAdapter', () => {
  const xtermP16Background = 0x1000000 | 1;
  const xtermP16PreviousBackground = 0x1000000 | 3;
  const xtermRgbBackground = 0x3000000 | 0x123456;
  const xtermInverseForeground = 0x4000000 | 0x1000000 | 7;
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
      tuiOpacity: 100,
    });

    // allowTransparency is intentionally false so xterm's WebGL atlas uses
    // canvas-2d subpixel AA. See composeTheme + adapter for the rationale.
    expect(terminalCtor.mock.calls[0]?.[0]).toMatchObject({ allowTransparency: false });
  });

  test('patches WebGL explicit background rectangles to be translucent', async () => {
    const { XtermAdapter } = await import('../../../src/client/adapters/xterm.ts');
    const adapter = new XtermAdapter();
    (adapter as any).tuiBackgroundAlpha = 0.7;
    const vertices = { attributes: new Float32Array(16) };
    const updateRectangle = mock((vertices: { attributes: Float32Array }, offset: number) => {
      vertices.attributes[offset + 7] = 1;
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
    expect(vertices.attributes[7]).toBeCloseTo(0.7, 5);

    const nextRectangleRenderer = {
      _updateRectangle: mock((v: { attributes: Float32Array }, offset: number) => {
        v.attributes[offset + 7] = 1;
      }),
    };
    renderer._rectangleRenderer.value = nextRectangleRenderer;
    renderer._initializeWebGLState();
    const nextVertices = { attributes: new Float32Array(16) };
    nextRectangleRenderer._updateRectangle(nextVertices, 0, 0, xtermP16Background, 0, 1, 0);
    expect(nextVertices.attributes[7]).toBeCloseTo(0.7, 5);
  });

  test('keeps WebGL cursor rectangles opaque and makes other highlighted backgrounds translucent', async () => {
    const { XtermAdapter } = await import('../../../src/client/adapters/xterm.ts');
    const adapter = new XtermAdapter();
    (adapter as any).tuiBackgroundAlpha = 0.7;
    const vertices = { attributes: new Float32Array(16) };
    const rectangleRenderer = {
      _terminal: { cols: 2, buffer: { active: { viewportY: 0 } } },
      _updateRectangle(v: { attributes: Float32Array }, offset: number) {
        v.attributes[offset + 7] = 1;
      },
      updateBackgrounds(model: any) {
        this._updateRectangle(vertices, 0, 0, xtermP16Background, 0, 2, 0);
      },
    };
    const renderer = {
      _rectangleRenderer: { value: rectangleRenderer },
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
    expect(vertices.attributes[7]).toBeCloseTo(0.7, 5);

    vertices.attributes[7] = 0;
    rectangleRenderer.updateBackgrounds({
      cursor: { x: 1, y: 0, width: 1 },
      selection: { hasSelection: false },
    });
    expect(vertices.attributes[7]).toBe(1);

    vertices.attributes[7] = 0;
    rectangleRenderer._updateRectangle(vertices, 0, xtermInverseForeground, xtermP16Background, 0, 2, 0);
    expect(vertices.attributes[7]).toBeCloseTo(0.7, 5);
  });

  test('makes WebGL RGB and text-bearing app background rectangles translucent and rasterizes glyphs against the blended background', async () => {
    const { XtermAdapter } = await import('../../../src/client/adapters/xterm.ts');
    const adapter = new XtermAdapter();
    (adapter as any).tuiBackgroundAlpha = 0.7;
    const vertices = { attributes: new Float32Array(16) };
    const glyphUpdateCell = mock(() => {});
    const rectangleRenderer = {
      _terminal: { cols: 2, buffer: { active: { viewportY: 0 } } },
      _updateRectangle(v: { attributes: Float32Array }, offset: number) {
        v.attributes[offset + 7] = 1;
      },
      updateBackgrounds(model: any) {
        this._updateRectangle(vertices, 0, 0, xtermP16Background, 0, 2, 0);
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
    expect(vertices.attributes[7]).toBeCloseTo(0.7, 5);

    vertices.attributes[7] = 0;
    rectangleRenderer.updateBackgrounds({
      cells: new Uint32Array([
        32, 0, 0, 0,
        'A'.charCodeAt(0), 0, 0, 0,
      ]),
      selection: { hasSelection: false },
    });
    expect(vertices.attributes[7]).toBeCloseTo(0.7, 5);

    vertices.attributes[7] = 0;
    rectangleRenderer.updateBackgrounds({
      cells: new Uint32Array([
        32, 0, 0, 0,
        0, 0, 0, 0,
      ]),
      selection: { hasSelection: false },
    });
    expect(vertices.attributes[7]).toBeCloseTo(0.7, 5);

    renderer._glyphRenderer.value.updateCell(0, 0, 'A'.charCodeAt(0), xtermP16Background, 0, 0, 'A', 1, xtermP16PreviousBackground);
    expect(glyphUpdateCell.mock.calls.at(-1)?.[3]).toBe(xtermRgbBlendedRedBackground);
  });

  test('uses configured TUI opacity for WebGL explicit background rectangles and glyph blending', async () => {
    const { XtermAdapter } = await import('../../../src/client/adapters/xterm.ts');
    const adapter = new XtermAdapter();
    (adapter as any).tuiBackgroundAlpha = 0.25;
    const vertices = { attributes: new Float32Array(16) };
    const glyphUpdateCell = mock(() => {});
    const rectangleRenderer = {
      _updateRectangle(v: { attributes: Float32Array }, offset: number) {
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

    adapter.updateOptions({ tuiOpacity: 35 });

    expect((adapter as any).tuiBackgroundAlpha).toBeCloseTo(0.35, 5);
    expect(clearTextureAtlas).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledWith(0, 23);
    expect(fit).toHaveBeenCalled();
  });
});
