import { beforeEach, describe, expect, test } from 'bun:test';
import { setupDocument, el, type StubElement } from '../_dom.ts';
import { computeScrollbarThumb, createScrollbarController } from '../../../../src/client/ui/scrollbar.ts';

function state(overrides: Partial<Parameters<ReturnType<typeof createScrollbarController>['updateState']>[0]> = {}) {
  return {
    paneId: '%4',
    paneHeight: 40,
    historySize: 100,
    scrollPosition: 0,
    paneInMode: 0,
    paneMode: '',
    alternateOn: false,
    ...overrides,
  };
}

function wheel(deltaY: number) {
  let prevented = false;
  let stopped = false;
  return {
    deltaY,
    preventDefault() { prevented = true; },
    stopPropagation() { stopped = true; },
    get prevented() { return prevented; },
    get stopped() { return stopped; },
  } as WheelEvent & { readonly prevented: boolean; readonly stopped: boolean };
}

function withTrackHeight(track: StubElement, height: number) {
  (track as any).getBoundingClientRect = () => ({ height });
  (track as any).offsetHeight = height;
}

describe('computeScrollbarThumb', () => {
  test('fills track when there is no history', () => {
    expect(computeScrollbarThumb({ paneHeight: 40, historySize: 0, scrollPosition: 0 }, 200))
      .toEqual({ topPx: 0, heightPx: 200 });
  });

  test('fills track when the track has invalid height', () => {
    expect(computeScrollbarThumb({ paneHeight: 40, historySize: 160, scrollPosition: 0 }, -1))
      .toEqual({ topPx: 0, heightPx: 0 });
  });

  test('fills track when the pane height is invalid', () => {
    expect(computeScrollbarThumb({ paneHeight: 0, historySize: 160, scrollPosition: 0 }, 200))
      .toEqual({ topPx: 0, heightPx: 200 });
  });

  test('places live bottom at bottom and oldest history at top', () => {
    expect(computeScrollbarThumb({ paneHeight: 40, historySize: 160, scrollPosition: 0 }, 200))
      .toEqual({ topPx: 160, heightPx: 40 });
    expect(computeScrollbarThumb({ paneHeight: 40, historySize: 160, scrollPosition: 160 }, 200))
      .toEqual({ topPx: 0, heightPx: 40 });
  });

  test('enforces minimum thumb size', () => {
    expect(computeScrollbarThumb({ paneHeight: 10, historySize: 9990, scrollPosition: 0 }, 200).heightPx)
      .toBe(24);
  });
});

describe('createScrollbarController', () => {
  beforeEach(() => setupDocument());

  test('creates track and thumb children under the root', () => {
    const root = el('div');
    createScrollbarController({
      root: root as any,
      send: () => {},
      passThroughWheel: () => false,
      requestFit: () => {},
    });

    const track = root.children[0]!;
    expect(track.classList.contains('tw-scrollbar-track')).toBe(true);
    expect(track.children[0]!.classList.contains('tw-scrollbar-thumb')).toBe(true);
  });

  test('updates thumb custom properties from tmux scroll state', () => {
    const root = el('div');
    const controller = createScrollbarController({
      root: root as any,
      send: () => {},
      passThroughWheel: () => false,
      requestFit: () => {},
    });
    const track = root.children[0]!;
    const thumb = track.children[0]!;
    withTrackHeight(track, 200);

    controller.updateState(state({ historySize: 160, scrollPosition: 0 }));

    expect(thumb.style['--tw-scrollbar-thumb-top']).toBe('160px');
    expect(thumb.style['--tw-scrollbar-thumb-height']).toBe('40px');
  });

  test('wheel sends line actions when available', () => {
    const sent: string[] = [];
    const root = el('div');
    const controller = createScrollbarController({
      root: root as any,
      send: (msg) => sent.push(JSON.stringify(msg)),
      passThroughWheel: () => false,
      requestFit: () => {},
    });
    controller.updateState(state());

    const handled = controller.handleWheel(wheel(-99));

    expect(handled).toBe(true);
    expect(sent).toEqual(['{"type":"scrollbar","action":"line-up","count":3,"paneId":"%4"}']);
  });

  test('clamps wheel line count and sends down actions for positive delta', () => {
    const sent: unknown[] = [];
    const root = el('div');
    const controller = createScrollbarController({
      root: root as any,
      send: (msg) => sent.push(msg),
      passThroughWheel: () => false,
      requestFit: () => {},
    });
    controller.updateState(state({ paneId: null }));

    expect(controller.handleWheel(wheel(9999))).toBe(true);

    expect(sent).toEqual([{ type: 'scrollbar', action: 'line-down', count: 5 }]);
  });

  test('alternate screen adds unavailable and lets wheel pass through', () => {
    let passThrough = false;
    const root = el('div');
    const controller = createScrollbarController({
      root: root as any,
      send: () => {},
      passThroughWheel: () => { passThrough = true; return false; },
      requestFit: () => {},
    });
    controller.updateState(state({ alternateOn: true }));

    const handled = controller.handleWheel(wheel(33));

    expect(handled).toBe(false);
    expect(passThrough).toBe(true);
    expect(root.classList.contains('unavailable')).toBe(true);
  });

  test('autohide toggles pinned classes and requests a fit', () => {
    let fits = 0;
    const root = el('div');
    const controller = createScrollbarController({
      root: root as any,
      send: () => {},
      passThroughWheel: () => false,
      requestFit: () => { fits++; },
    });

    controller.setAutohide(true);
    expect(root.classList.contains('tw-scrollbar-autohide')).toBe(true);
    expect(root.classList.contains('tw-scrollbar-pinned')).toBe(false);

    controller.setAutohide(false);
    expect(root.classList.contains('tw-scrollbar-autohide')).toBe(false);
    expect(root.classList.contains('tw-scrollbar-pinned')).toBe(true);
    expect(fits).toBe(2);
  });

  test('track listener prevents default only when wheel is handled and dispose removes it', () => {
    const sent: unknown[] = [];
    const root = el('div');
    const controller = createScrollbarController({
      root: root as any,
      send: (msg) => sent.push(msg),
      passThroughWheel: () => false,
      requestFit: () => {},
    });
    const track = root.children[0]!;
    controller.updateState(state());

    const handledWheel = wheel(33);
    track.dispatch('wheel', handledWheel);
    expect(handledWheel.prevented).toBe(true);
    expect(handledWheel.stopped).toBe(true);
    expect(sent).toHaveLength(1);

    controller.updateState(state({ unavailable: true }));
    const passedWheel = wheel(33);
    track.dispatch('wheel', passedWheel);
    expect(passedWheel.prevented).toBe(false);
    expect(passedWheel.stopped).toBe(false);

    controller.dispose();
    track.dispatch('wheel', wheel(33));
    expect(sent).toHaveLength(1);
  });
});
