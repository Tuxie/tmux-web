import { describe, it, expect, vi } from 'vitest';
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
