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

function mouse(clientY: number, target?: unknown) {
  let prevented = false;
  let stopped = false;
  return {
    target,
    clientY,
    preventDefault() { prevented = true; },
    stopPropagation() { stopped = true; },
    get prevented() { return prevented; },
    get stopped() { return stopped; },
  } as MouseEvent & { readonly prevented: boolean; readonly stopped: boolean };
}

function withTrackHeight(track: StubElement, height: number) {
  (track as any).getBoundingClientRect = () => ({ height });
  (track as any).offsetHeight = height;
}

function withRect(el: StubElement, rect: Partial<DOMRect> & { top: number; height: number }) {
  (el as any).getBoundingClientRect = () => ({
    bottom: rect.top + rect.height,
    left: 0,
    right: 12,
    width: 12,
    ...rect,
  });
  (el as any).offsetHeight = rect.height;
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

    expect(root.classList.contains('tw-scrollbar')).toBe(true);
    const track = root.children[0]!;
    expect(track.classList.contains('tw-scrollbar-track')).toBe(true);
    expect(track.children[0]!.classList.contains('tw-scrollbar-thumb')).toBe(true);
  });

  test('reuses existing track and thumb children under the root', () => {
    const root = el('div');
    const track = el('div');
    const thumb = el('div');
    track.classList.add('tw-scrollbar-track');
    thumb.classList.add('tw-scrollbar-thumb');
    track.appendChild(thumb);
    root.appendChild(track);
    (root as any).querySelector = (selector: string) => selector === '.tw-scrollbar-track' ? track : null;
    (track as any).querySelector = (selector: string) => selector === '.tw-scrollbar-thumb' ? thumb : null;

    createScrollbarController({
      root: root as any,
      send: () => {},
      passThroughWheel: () => false,
      requestFit: () => {},
    });

    expect(root.children).toHaveLength(1);
    expect(root.children[0]).toBe(track);
    expect(track.children).toHaveLength(1);
    expect(track.children[0]).toBe(thumb);
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

  test('zero-delta wheel does not send a scroll action', () => {
    const sent: unknown[] = [];
    const root = el('div');
    const controller = createScrollbarController({
      root: root as any,
      send: (msg) => sent.push(msg),
      passThroughWheel: () => true,
      requestFit: () => {},
    });
    controller.updateState(state());

    expect(controller.handleWheel(wheel(0))).toBe(false);
    expect(sent).toEqual([]);
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

  test('autohide reveals near the right edge and hides when pinned', () => {
    const root = el('div');
    const controller = createScrollbarController({
      root: root as any,
      send: () => {},
      passThroughWheel: () => false,
      requestFit: () => {},
    });
    (globalThis as any).window = { innerWidth: 200 };

    controller.setAutohide(true);
    (globalThis.document as any).dispatch('mousemove', { clientX: 180 });
    expect(root.classList.contains('visible')).toBe(true);

    controller.setAutohide(false);
    expect(root.classList.contains('visible')).toBe(false);
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
    expect(root.classList.contains('unavailable')).toBe(true);
    expect(passedWheel.prevented).toBe(false);
    expect(passedWheel.stopped).toBe(false);

    controller.dispose();
    track.dispatch('wheel', wheel(33));
    expect(sent).toHaveLength(1);
  });

  test('track mousedown above current thumb sends page-up', () => {
    const sent: unknown[] = [];
    const root = el('div');
    const controller = createScrollbarController({
      root: root as any,
      send: (msg) => sent.push(msg),
      passThroughWheel: () => false,
      requestFit: () => {},
    });
    const track = root.children[0]!;
    const thumb = track.children[0]!;
    withRect(track, { top: 0, height: 200 });
    withRect(thumb, { top: 80, height: 40 });
    controller.updateState(state({ historySize: 160, scrollPosition: 80 }));

    const ev = mouse(20, track);
    track.dispatch('mousedown', ev);

    expect(ev.prevented).toBe(true);
    expect(ev.stopped).toBe(true);
    expect(sent).toEqual([{ type: 'scrollbar', action: 'page-up', paneId: '%4' }]);
  });

  test('track mousedown below current thumb sends page-down', () => {
    const sent: unknown[] = [];
    const root = el('div');
    const controller = createScrollbarController({
      root: root as any,
      send: (msg) => sent.push(msg),
      passThroughWheel: () => false,
      requestFit: () => {},
    });
    const track = root.children[0]!;
    const thumb = track.children[0]!;
    withRect(track, { top: 0, height: 200 });
    withRect(thumb, { top: 80, height: 40 });
    controller.updateState(state({ paneId: null, historySize: 160, scrollPosition: 80 }));

    const ev = mouse(150, track);
    track.dispatch('mousedown', ev);

    expect(ev.prevented).toBe(true);
    expect(ev.stopped).toBe(true);
    expect(sent).toEqual([{ type: 'scrollbar', action: 'page-down' }]);
  });

  test('track mousedown ignores thumb target', () => {
    const sent: unknown[] = [];
    const root = el('div');
    const controller = createScrollbarController({
      root: root as any,
      send: (msg) => sent.push(msg),
      passThroughWheel: () => false,
      requestFit: () => {},
    });
    const track = root.children[0]!;
    const thumb = track.children[0]!;
    withRect(track, { top: 0, height: 200 });
    withRect(thumb, { top: 80, height: 40 });
    controller.updateState(state({ historySize: 160, scrollPosition: 80 }));

    const ev = mouse(90, thumb);
    track.dispatch('mousedown', ev);

    expect(ev.prevented).toBe(false);
    expect(ev.stopped).toBe(false);
    expect(sent).toEqual([]);
  });

  test('track and thumb mousedown no-op when unavailable, alternate screen, or no history', () => {
    for (const blockedState of [
      state({ unavailable: true }),
      state({ alternateOn: true }),
      state({ historySize: 0 }),
    ]) {
      const sent: unknown[] = [];
      const root = el('div');
      const controller = createScrollbarController({
        root: root as any,
        send: (msg) => sent.push(msg),
        passThroughWheel: () => false,
        requestFit: () => {},
      });
      const track = root.children[0]!;
      const thumb = track.children[0]!;
      withRect(track, { top: 0, height: 200 });
      withRect(thumb, { top: 80, height: 40 });
      controller.updateState(blockedState);

      const trackEv = mouse(20, track);
      track.dispatch('mousedown', trackEv);
      const thumbEv = mouse(90, thumb);
      thumb.dispatch('mousedown', thumbEv);
      (globalThis.document as any).dispatch('mousemove', mouse(20));

      expect(trackEv.prevented).toBe(false);
      expect(trackEv.stopped).toBe(false);
      expect(thumbEv.prevented).toBe(false);
      expect(thumbEv.stopped).toBe(false);
      expect(root.classList.contains('dragging')).toBe(false);
      expect(sent).toEqual([]);
    }
  });

  test('thumb drag sends absolute scroll position using tmux top-oldest bottom-live semantics', () => {
    const sent: unknown[] = [];
    const root = el('div');
    const controller = createScrollbarController({
      root: root as any,
      send: (msg) => sent.push(msg),
      passThroughWheel: () => false,
      requestFit: () => {},
    });
    const track = root.children[0]!;
    const thumb = track.children[0]!;
    withRect(track, { top: 0, height: 200 });
    withRect(thumb, { top: 160, height: 40 });
    controller.updateState(state({ historySize: 160, scrollPosition: 0 }));

    const down = mouse(180, thumb);
    thumb.dispatch('mousedown', down);
    (globalThis.document as any).dispatch('mousemove', mouse(20));
    (globalThis.document as any).dispatch('mousemove', mouse(180));

    expect(down.prevented).toBe(true);
    expect(down.stopped).toBe(true);
    expect(root.classList.contains('dragging')).toBe(true);
    expect(sent).toEqual([
      { type: 'scrollbar', action: 'drag', position: 160, paneId: '%4' },
      { type: 'scrollbar', action: 'drag', position: 0, paneId: '%4' },
    ]);
  });

  test('drag adds and removes dragging, keeps autohide visible, and dispose removes mouse listeners', () => {
    const sent: unknown[] = [];
    const root = el('div');
    const controller = createScrollbarController({
      root: root as any,
      send: (msg) => sent.push(msg),
      passThroughWheel: () => false,
      requestFit: () => {},
    });
    const track = root.children[0]!;
    const thumb = track.children[0]!;
    withRect(track, { top: 0, height: 200 });
    withRect(thumb, { top: 160, height: 40 });
    controller.updateState(state({ historySize: 160, scrollPosition: 0 }));
    controller.setAutohide(true);

    thumb.dispatch('mousedown', mouse(180, thumb));
    expect(root.classList.contains('dragging')).toBe(true);
    expect(root.classList.contains('visible')).toBe(true);

    (globalThis.document as any).dispatch('mousemove', mouse(100));
    expect(root.classList.contains('visible')).toBe(true);
    expect(sent).toHaveLength(1);

    (globalThis.document as any).dispatch('mouseup', mouse(100));
    expect(root.classList.contains('dragging')).toBe(false);

    thumb.dispatch('mousedown', mouse(180, thumb));
    controller.dispose();
    expect(root.classList.contains('visible')).toBe(false);
    (globalThis.document as any).dispatch('mousemove', mouse(20));
    (globalThis.document as any).dispatch('mouseup', mouse(20));

    expect(sent).toHaveLength(1);
    expect(root.classList.contains('dragging')).toBe(false);
  });
});
