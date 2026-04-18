import { describe, test, expect, beforeEach } from 'bun:test';
import { setupDocument, el } from '../_dom.ts';
import {
  installMouseHandler, getSgrCoords, buildSgrSequence, mouseButton, addModifiers,
} from '../../../../src/client/ui/mouse.ts';

describe('pure helpers', () => {
  test('getSgrCoords', () => {
    expect(getSgrCoords(100, 200, { width: 10, height: 20 }, { left: 0, top: 0 })).toEqual({ col: 11, row: 11 });
  });
  test('getSgrCoords clamps to 1,1 for clicks inside first cell offset', () => {
    expect(getSgrCoords(0, 0, { width: 10, height: 20 }, { left: 50, top: 50 })).toEqual({ col: 1, row: 1 });
  });
  test('buildSgrSequence press vs release', () => {
    expect(buildSgrSequence(0, 1, 1, false)).toBe('\x1b[<0;1;1M');
    expect(buildSgrSequence(0, 1, 1, true)).toBe('\x1b[<0;1;1m');
  });
  test('mouseButton mapping', () => {
    expect(mouseButton({ button: 0 } as any)).toBe(0);
    expect(mouseButton({ button: 1 } as any)).toBe(1);
    expect(mouseButton({ button: 2 } as any)).toBe(2);
    expect(mouseButton({ button: 3 } as any)).toBe(0);
  });
  test('addModifiers alt+ctrl', () => {
    expect(addModifiers(0, { altKey: true, ctrlKey: true } as any)).toBe(24);
    expect(addModifiers(0, { altKey: false, ctrlKey: false } as any)).toBe(0);
    expect(addModifiers(0, { altKey: true, ctrlKey: false } as any)).toBe(8);
    expect(addModifiers(0, { altKey: false, ctrlKey: true } as any)).toBe(16);
  });
});

describe('installMouseHandler', () => {
  beforeEach(() => setupDocument());

  const makeOpts = (term: any, sent: string[]) => ({
    getMetrics: () => ({ width: 10, height: 20 }) as any,
    getCanvasRect: () => ({ left: 0, top: 0 }) as any,
    getTerminalElement: () => term,
    send: (s: string) => sent.push(s),
  });
  const mk = (clientX: number, clientY: number, opts: Partial<{ button: number; shiftKey: boolean; altKey: boolean; ctrlKey: boolean; target: any }> = {}) => ({
    clientX, clientY,
    button: opts.button ?? 0,
    altKey: opts.altKey ?? false,
    ctrlKey: opts.ctrlKey ?? false,
    shiftKey: opts.shiftKey ?? false,
    target: opts.target,
    preventDefault() {},
    stopPropagation() {},
  });

  test('press-drag-release round-trip emits three sgr sequences', () => {
    const term = el('div');
    const sent: string[] = [];
    const off = installMouseHandler(makeOpts(term, sent));
    (globalThis as any).document.dispatch('mousedown', mk(5, 5, { target: term }));
    (globalThis as any).document.dispatch('mousemove', mk(25, 25, { target: term }));
    (globalThis as any).document.dispatch('mouseup', mk(25, 25, { target: term }));
    expect(sent).toHaveLength(3);
    expect(sent[0]).toMatch(/\[<0;1;1M$/);
    expect(sent[2]).toMatch(/\[<0;3;2m$/);
    off();
  });

  test('mousemove without prior mousedown is ignored', () => {
    const term = el('div');
    const sent: string[] = [];
    installMouseHandler(makeOpts(term, sent));
    (globalThis as any).document.dispatch('mousemove', mk(25, 25, { target: term }));
    expect(sent).toHaveLength(0);
  });

  test('shift-click bypasses SGR', () => {
    const term = el('div');
    const sent: string[] = [];
    installMouseHandler(makeOpts(term, sent));
    (globalThis as any).document.dispatch('mousedown', mk(5, 5, { shiftKey: true, target: term }));
    expect(sent).toHaveLength(0);
  });

  test('click outside terminal is ignored', () => {
    const term = el('div');
    const other = el('section');
    Object.assign(term, { contains: (n: any) => n === term });
    const sent: string[] = [];
    installMouseHandler(makeOpts(term, sent));
    (globalThis as any).document.dispatch('mousedown', mk(5, 5, { target: other }));
    expect(sent).toHaveLength(0);
  });

  test('click over link (cursor:pointer) bypasses SGR', () => {
    (globalThis as any).getComputedStyle = () => ({ cursor: 'pointer' });
    const term = el('div');
    const sent: string[] = [];
    installMouseHandler(makeOpts(term, sent));
    (globalThis as any).document.dispatch('mousedown', mk(5, 5, { target: term }));
    expect(sent).toHaveLength(0);
  });

  test('mouseup without prior mousedown is ignored (dragButton < 0)', () => {
    const term = el('div');
    const sent: string[] = [];
    installMouseHandler(makeOpts(term, sent));
    (globalThis as any).document.dispatch('mouseup', mk(5, 5, { target: term }));
    expect(sent).toHaveLength(0);
  });

  test('mouseup over link resets dragButton without emit', () => {
    const term = el('div');
    const sent: string[] = [];
    installMouseHandler(makeOpts(term, sent));
    (globalThis as any).document.dispatch('mousedown', mk(5, 5, { target: term }));
    sent.length = 0;
    (globalThis as any).getComputedStyle = () => ({ cursor: 'pointer' });
    (globalThis as any).document.dispatch('mouseup', mk(5, 5, { target: term }));
    expect(sent).toHaveLength(0);
  });

  test('contextmenu on terminal is prevented', () => {
    const term = el('div');
    const sent: string[] = [];
    installMouseHandler(makeOpts(term, sent));
    let prevented = false;
    (globalThis as any).document.dispatch('contextmenu', {
      target: term, shiftKey: false, preventDefault() { prevented = true; },
    });
    expect(prevented).toBe(true);
  });

  test('contextmenu with shift is NOT prevented', () => {
    const term = el('div');
    const sent: string[] = [];
    installMouseHandler(makeOpts(term, sent));
    let prevented = false;
    (globalThis as any).document.dispatch('contextmenu', {
      target: term, shiftKey: true, preventDefault() { prevented = true; },
    });
    expect(prevented).toBe(false);
  });

  test('uninstall removes listeners', () => {
    const term = el('div');
    const sent: string[] = [];
    const off = installMouseHandler(makeOpts(term, sent));
    off();
    (globalThis as any).document.dispatch('mousedown', mk(5, 5, { target: term }));
    expect(sent).toHaveLength(0);
  });

  test('isOverLink handles getComputedStyle throwing', () => {
    (globalThis as any).getComputedStyle = () => { throw new Error('boom'); };
    const term = el('div');
    const sent: string[] = [];
    installMouseHandler(makeOpts(term, sent));
    (globalThis as any).document.dispatch('mousedown', mk(5, 5, { target: term }));
    expect(sent).toHaveLength(1);
  });
});
