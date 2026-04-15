import { describe, expect, mock, test } from 'bun:test';

describe('XtermAdapter', () => {
  test('exposes setTheme method on prototype', async () => {
    const { XtermAdapter } = await import('../../../src/client/adapters/xterm.ts');
    expect(typeof XtermAdapter.prototype.setTheme).toBe('function');
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
      theme: { background: '#000000' } as any,
    });

    expect(terminalCtor.mock.calls[0]?.[0]).toMatchObject({ allowTransparency: true });
  });
});
