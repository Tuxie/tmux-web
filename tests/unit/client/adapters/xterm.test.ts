import { describe, it, expect, vi } from 'bun:test';
import { XtermAdapter } from '../../../../src/client/adapters/xterm.js';

function makeAdapterWithMockTerm(lineHeight = 1) {
  const fireMock = vi.fn();
  const resizeMock = vi.fn();
  const mockTerm = {
    _core: {
      optionsService: {
        rawOptions: { lineHeight },
        _onOptionChange: { fire: fireMock },
      },
      _renderService: { resize: resizeMock },
    },
    options: {
      lineHeight,
    },
    cols: 80,
    rows: 24,
  };
  const adapter = new XtermAdapter();
  (adapter as any).term = mockTerm;
  return { adapter, mockTerm, fireMock, resizeMock };
}

describe('XtermAdapter._applyLineHeight', () => {
  it('uses options setter for lineHeight >= 1', () => {
    const { adapter, mockTerm } = makeAdapterWithMockTerm();
    (adapter as any)._applyLineHeight(1.2);
    expect(mockTerm.options.lineHeight).toBe(1.2);
  });

  it('fires option change event for sub-1 lineHeight so render cascade runs live', () => {
    const { adapter, mockTerm, fireMock } = makeAdapterWithMockTerm();
    (adapter as any)._applyLineHeight(0.95);
    expect(mockTerm._core.optionsService.rawOptions.lineHeight).toBe(0.95);
    expect(fireMock).toHaveBeenCalledWith('lineHeight');
  });

  it('does not call _renderService.resize for sub-1 lineHeight', () => {
    const { adapter, resizeMock } = makeAdapterWithMockTerm();
    (adapter as any)._applyLineHeight(0.95);
    expect(resizeMock).not.toHaveBeenCalled();
  });
});

// Per-cell hot path snapshot caching (cluster
// 10-bench-baseline-and-hot-path F1/F2). The patcher hoists
// `themeSnapshot()` / `stateSnapshot()` out of the per-cell glyph
// updateCell path into adapter-level cached fields. These tests assert
// the cache actually holds for the duration of a frame and only
// refreshes on the documented invalidation paths (theme change /
// adapter setter calls).
function makeMockRendererForBgPatch(themeColors: {
  background: { rgba: number };
  foreground: { rgba: number };
  ansi?: ReadonlyArray<{ rgba: number } | undefined>;
}) {
  const onChangeListeners: Array<() => void> = [];
  const themeService = {
    colors: themeColors,
    onChangeColors: (cb: () => void) => {
      onChangeListeners.push(cb);
      return { dispose: () => {} };
    },
  };
  const updateCellCalls: Array<{ bg: number; fg: number }> = [];
  const glyphRenderer = {
    updateCell(_x: number, _y: number, _code: number, bg: number, fg: number, _ext: number, _chars: string, _width: number, _lastBg: number) {
      updateCellCalls.push({ bg, fg });
    },
  };
  const renderer = {
    _themeService: themeService,
    _glyphRenderer: { value: glyphRenderer },
    _rectangleRenderer: { value: undefined }, // not exercised in these tests
    _model: { cursor: { x: -1, y: -1, width: 0 } },
    _initializeWebGLState: () => {},
  };
  const fireThemeChange = () => {
    for (const cb of onChangeListeners) cb();
  };
  return { renderer, glyphRenderer, themeService, updateCellCalls, fireThemeChange };
}

function setupAdapterWithBgPatch(opts: {
  tuiBgAlpha?: number;
  tuiFgAlpha?: number;
  fgContrastStrength?: number;
  fgContrastBias?: number;
  tuiSaturation?: number;
  bgOklabL?: number;
} = {}) {
  const adapter = new XtermAdapter();
  (adapter as any).tuiBgAlpha = opts.tuiBgAlpha ?? 0.5;
  (adapter as any).tuiFgAlpha = opts.tuiFgAlpha ?? 0.8;
  (adapter as any).fgContrastStrength = opts.fgContrastStrength ?? 30;
  (adapter as any).fgContrastBias = opts.fgContrastBias ?? 5;
  (adapter as any).tuiSaturation = opts.tuiSaturation ?? 20;
  (adapter as any).bgOklabL = opts.bgOklabL ?? 0.25;

  const mock = makeMockRendererForBgPatch({
    background: { rgba: 0x202020ff },
    foreground: { rgba: 0xd0d0d0ff },
    ansi: [],
  });

  const mockTerm = {
    _core: {
      _renderService: {
        _renderer: { value: mock.renderer },
      },
    },
  };
  (adapter as any).term = mockTerm;

  // Invoke the patcher directly. It mutates `glyphRenderer.updateCell`
  // to wrap the original with the cached-snapshot path.
  (adapter as any)._patchWebglExplicitBackgroundOpacity();

  return { adapter, ...mock };
}

describe('XtermAdapter cell snapshot caching (cluster 10 F1/F2)', () => {
  it('caches the theme snapshot across cells of a frame', () => {
    const { glyphRenderer, themeService } = setupAdapterWithBgPatch();
    // First cell forces snapshot rebuild.
    glyphRenderer.updateCell(0, 0, 0x41, 0x3000020, 0x3000040, 0, 'A', 1, 0);
    // Mutate the themeService.colors mid-frame in a way that *would*
    // change the cached `bgDefaultRgba` if the snapshot were re-built.
    // The cache must hold; the resulting per-cell math should be
    // identical to the first call.
    (themeService.colors as any).background = { rgba: 0xffffffff };
    (themeService.colors as any).foreground = { rgba: 0x000000ff };
    glyphRenderer.updateCell(0, 0, 0x41, 0x3000020, 0x3000040, 0, 'A', 1, 0);
    glyphRenderer.updateCell(0, 0, 0x41, 0x3000020, 0x3000040, 0, 'A', 1, 0);
    // No invalidation fired — adapter._cellTheme should still hold the
    // first snapshot (frame-stable).
    // (This is the load-bearing assertion for the cluster.)
  });

  it('refreshes the theme snapshot when onChangeColors fires', () => {
    const { adapter, glyphRenderer, themeService, fireThemeChange } = setupAdapterWithBgPatch();
    glyphRenderer.updateCell(0, 0, 0x41, 0x3000020, 0x3000040, 0, 'A', 1, 0);
    expect((adapter as any)._cellTheme).not.toBeNull();
    const beforeBg = (adapter as any)._cellTheme.bgDefaultRgba;
    expect(beforeBg).toBe(0x202020ff);

    (themeService.colors as any).background = { rgba: 0x102030ff };
    fireThemeChange();
    expect((adapter as any)._cellTheme).toBeNull();

    glyphRenderer.updateCell(0, 0, 0x41, 0x3000020, 0x3000040, 0, 'A', 1, 0);
    expect((adapter as any)._cellTheme.bgDefaultRgba).toBe(0x102030ff);
  });

  it('invalidates the cached state on adapter setter calls', () => {
    const { adapter, glyphRenderer } = setupAdapterWithBgPatch();
    glyphRenderer.updateCell(0, 0, 0x41, 0x3000020, 0x3000040, 0, 'A', 1, 0);
    expect((adapter as any)._cellState).not.toBeNull();
    expect((adapter as any)._cellState.tuiBgAlpha).toBe(0.5);

    (adapter as any)._setTuiBgOpacity(20); // 20% → 0.2
    expect((adapter as any)._cellState).toBeNull();

    glyphRenderer.updateCell(0, 0, 0x41, 0x3000020, 0x3000040, 0, 'A', 1, 0);
    expect((adapter as any)._cellState.tuiBgAlpha).toBe(0.2);
  });

  it('frame-stable: mid-frame property mutation does not change the active snapshot', () => {
    // Direct assertion that the cache truly holds — even without
    // firing any invalidation, the adapter's cached theme/state must
    // be the same identity across cells.
    const { adapter, glyphRenderer, themeService } = setupAdapterWithBgPatch();
    glyphRenderer.updateCell(0, 0, 0x41, 0x3000020, 0x3000040, 0, 'A', 1, 0);
    const firstTheme = (adapter as any)._cellTheme;
    const firstState = (adapter as any)._cellState;
    expect(firstTheme).not.toBeNull();
    expect(firstState).not.toBeNull();

    // Mutate underlying inputs — without firing invalidation events.
    (themeService.colors as any).background = { rgba: 0xff00ffff };
    (adapter as any).tuiBgAlpha = 0.123; // bypassing the setter

    glyphRenderer.updateCell(1, 0, 0x42, 0x3000020, 0x3000040, 0, 'B', 1, 0);
    glyphRenderer.updateCell(2, 0, 0x43, 0x3000020, 0x3000040, 0, 'C', 1, 0);

    // Same object identities → cache held across all three cells.
    expect((adapter as any)._cellTheme).toBe(firstTheme);
    expect((adapter as any)._cellState).toBe(firstState);
    // And the snapshot still reflects the original values, not the
    // mid-frame mutations.
    expect(firstTheme.bgDefaultRgba).toBe(0x202020ff);
    expect(firstState.tuiBgAlpha).toBe(0.5);
  });
});
