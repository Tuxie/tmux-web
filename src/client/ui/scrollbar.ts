import type { ScrollbarActionMessage, ScrollbarState } from '../../shared/types.js';

export interface ThumbInput {
  paneHeight: number;
  historySize: number;
  scrollPosition: number;
}

export interface ThumbGeometry {
  topPx: number;
  heightPx: number;
}

export interface ScrollbarController {
  updateState(state: ScrollbarState): void;
  setAutohide(value: boolean): void;
  handleWheel(ev: WheelEvent): boolean;
  dispose(): void;
}

const MIN_THUMB_PX = 24;
const WHEEL_PIXELS_PER_LINE = 33;
const MAX_WHEEL_LINES = 5;
const AUTOHIDE_REVEAL_PX = 48;
const AUTOHIDE_HIDE_MS = 900;
/* Workbench-style arrow buttons: fire once on press, then a brief
 * hold-down delay before auto-repeat kicks in at a steady cadence. */
const ARROW_REPEAT_DELAY_MS = 320;
const ARROW_REPEAT_INTERVAL_MS = 60;

export function computeScrollbarThumb(input: ThumbInput, trackHeightPx: number): ThumbGeometry {
  const track = Math.max(0, Math.round(trackHeightPx));
  if (track <= 0) return { topPx: 0, heightPx: 0 };
  if (input.historySize <= 0 || input.paneHeight <= 0) return { topPx: 0, heightPx: track };

  const totalRows = input.historySize + input.paneHeight;
  const rawHeight = Math.round(track * (input.paneHeight / totalRows));
  const heightPx = Math.min(track, Math.max(MIN_THUMB_PX, rawHeight));
  const maxTop = Math.max(0, track - heightPx);
  const scrollPosition = Math.max(0, Math.min(input.scrollPosition, input.historySize));
  const distanceFromTop = 1 - (scrollPosition / input.historySize);

  return {
    topPx: Math.round(maxTop * distanceFromTop),
    heightPx,
  };
}

export function createScrollbarController(opts: {
  root: HTMLElement;
  send: (msg: ScrollbarActionMessage) => void;
  passThroughWheel: (ev: WheelEvent) => boolean;
  requestFit: () => void;
}): ScrollbarController {
  opts.root.classList.add('tw-scrollbar');
  const track = ensureChild(opts.root, '.tw-scrollbar-track', 'tw-scrollbar-track');
  const thumb = ensureChild(track, '.tw-scrollbar-thumb', 'tw-scrollbar-thumb');
  /* Workbench-style cluster at the bottom of the bar: ↑ button, ↓ button,
   * and a no-op window-resize handle. Themes that don't want the cluster
   * (default theme) hide them via `display: none` in CSS. */
  const upButton = ensureChild(opts.root, '.tw-scrollbar-up', 'tw-scrollbar-up');
  const downButton = ensureChild(opts.root, '.tw-scrollbar-down', 'tw-scrollbar-down');
  const resizeHandle = ensureChild(opts.root, '.tw-scrollbar-resize', 'tw-scrollbar-resize');
  upButton.setAttribute('role', 'button');
  upButton.setAttribute('aria-label', 'Scroll up');
  downButton.setAttribute('role', 'button');
  downButton.setAttribute('aria-label', 'Scroll down');
  resizeHandle.setAttribute('aria-hidden', 'true');

  let state: ScrollbarState = {
    paneId: null,
    paneHeight: 0,
    historySize: 0,
    scrollPosition: 0,
    paneInMode: 0,
    paneMode: '',
    alternateOn: false,
    unavailable: true,
  };
  let autohide = false;
  let dragging = false;
  let dragGrabOffsetPx = 0;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let arrowDelayTimer: ReturnType<typeof setTimeout> | null = null;
  let arrowRepeatTimer: ReturnType<typeof setInterval> | null = null;

  function render(): void {
    const unavailable = !!state.unavailable || state.alternateOn;
    opts.root.classList.toggle('unavailable', unavailable);
    opts.root.classList.toggle('tw-scrollbar-autohide', autohide);
    opts.root.classList.toggle('tw-scrollbar-pinned', !autohide);

    const { top: marginTop, bottom: marginBottom } = readThumbMargin(opts.root);
    const trackHeight = readTrackHeight(track);
    const usable = Math.max(0, trackHeight - marginTop - marginBottom);
    const thumbGeometry = computeScrollbarThumb(state, usable);
    setStyleProperty(thumb, '--tw-scrollbar-thumb-top', `${thumbGeometry.topPx + marginTop}px`);
    setStyleProperty(thumb, '--tw-scrollbar-thumb-height', `${thumbGeometry.heightPx}px`);
  }

  function setVisible(value: boolean): void {
    if (!value && dragging) {
      opts.root.classList.add('visible');
      return;
    }
    opts.root.classList.toggle('visible', value);
    if (!value && hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function scheduleHide(): void {
    if (!autohide) return;
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      hideTimer = null;
      setVisible(false);
    }, AUTOHIDE_HIDE_MS);
  }

  function reveal(): void {
    if (!autohide) return;
    setVisible(true);
    scheduleHide();
  }

  function sendLine(action: 'line-up' | 'line-down', count: number): void {
    const msg: ScrollbarActionMessage = {
      type: 'scrollbar',
      action,
      count,
    };
    if (state.paneId) msg.paneId = state.paneId;
    opts.send(msg);
  }

  function sendPage(action: 'page-up' | 'page-down'): void {
    const msg: ScrollbarActionMessage = {
      type: 'scrollbar',
      action,
    };
    if (state.paneId) msg.paneId = state.paneId;
    opts.send(msg);
  }

  function sendDrag(position: number): void {
    const msg: ScrollbarActionMessage = {
      type: 'scrollbar',
      action: 'drag',
      position,
    };
    if (state.paneId) msg.paneId = state.paneId;
    opts.send(msg);
  }

  function canUsePointerScrollbar(): boolean {
    return !state.unavailable && !state.alternateOn && state.historySize > 0;
  }

  function scrollPositionForClientY(clientY: number, grabOffsetPx: number): number {
    const rect = track.getBoundingClientRect();
    const { top: marginTop, bottom: marginBottom } = readThumbMargin(opts.root);
    const trackHeight = (rect.height || track.offsetHeight || 0);
    const usable = Math.max(0, trackHeight - marginTop - marginBottom);
    const thumbGeometry = computeScrollbarThumb(state, usable);
    const maxTop = Math.max(1, usable - thumbGeometry.heightPx);
    const rawTop = clientY - rect.top - grabOffsetPx - marginTop;
    const top = Math.max(0, Math.min(rawTop, maxTop));
    const ratioFromTop = top / maxTop;
    return Math.round((1 - ratioFromTop) * state.historySize);
  }

  function handleWheel(ev: WheelEvent): boolean {
    if (state.unavailable || state.alternateOn) return opts.passThroughWheel(ev);
    if (ev.deltaY === 0) return false;

    reveal();
    const count = Math.max(
      1,
      Math.min(MAX_WHEEL_LINES, Math.abs(Math.round(ev.deltaY / WHEEL_PIXELS_PER_LINE))),
    );
    sendLine(ev.deltaY < 0 ? 'line-up' : 'line-down', count);
    return true;
  }

  function onTrackWheel(ev: WheelEvent): void {
    if (!handleWheel(ev)) return;
    ev.preventDefault();
    ev.stopPropagation();
  }

  function onTrackMouseDown(ev: MouseEvent): void {
    if (!canUsePointerScrollbar()) return;
    if (ev.target === thumb) return;

    const rect = thumb.getBoundingClientRect();
    sendPage(ev.clientY < rect.top ? 'page-up' : 'page-down');
    ev.preventDefault();
    ev.stopPropagation();
  }

  function onThumbMouseDown(ev: MouseEvent): void {
    if (!canUsePointerScrollbar()) return;

    dragging = true;
    const rect = thumb.getBoundingClientRect();
    dragGrabOffsetPx = Math.max(0, Math.min(ev.clientY - rect.top, rect.height || thumb.offsetHeight || 0));
    opts.root.classList.add('dragging');
    reveal();
    ev.preventDefault();
    ev.stopPropagation();
  }

  function onDocumentMouseMove(ev: MouseEvent): void {
    if (dragging) {
      sendDrag(Math.max(0, Math.min(scrollPositionForClientY(ev.clientY, dragGrabOffsetPx), state.historySize)));
      if (autohide) opts.root.classList.add('visible');
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }

    if (!autohide) return;
    const width = viewportWidth();
    if (width > 0 && ev.clientX >= width - AUTOHIDE_REVEAL_PX) reveal();
  }

  function onDocumentMouseUp(): void {
    stopArrowRepeat();
    if (!dragging) return;
    dragging = false;
    dragGrabOffsetPx = 0;
    opts.root.classList.remove('dragging');
    if (autohide) scheduleHide();
  }

  function stopArrowRepeat(): void {
    if (arrowDelayTimer) {
      clearTimeout(arrowDelayTimer);
      arrowDelayTimer = null;
    }
    if (arrowRepeatTimer) {
      clearInterval(arrowRepeatTimer);
      arrowRepeatTimer = null;
    }
    upButton.classList.remove('pressed');
    downButton.classList.remove('pressed');
  }

  function startArrowRepeat(direction: 'line-up' | 'line-down'): void {
    if (!canUsePointerScrollbar()) return;
    stopArrowRepeat();
    (direction === 'line-up' ? upButton : downButton).classList.add('pressed');
    sendLine(direction, 1);
    arrowDelayTimer = setTimeout(() => {
      arrowDelayTimer = null;
      arrowRepeatTimer = setInterval(() => {
        if (!canUsePointerScrollbar()) {
          stopArrowRepeat();
          return;
        }
        sendLine(direction, 1);
      }, ARROW_REPEAT_INTERVAL_MS);
    }, ARROW_REPEAT_DELAY_MS);
  }

  function onUpMouseDown(ev: MouseEvent): void {
    if (ev.button !== 0) return;
    reveal();
    startArrowRepeat('line-up');
    ev.preventDefault();
    ev.stopPropagation();
  }

  function onDownMouseDown(ev: MouseEvent): void {
    if (ev.button !== 0) return;
    reveal();
    startArrowRepeat('line-down');
    ev.preventDefault();
    ev.stopPropagation();
  }

  track.addEventListener('wheel', onTrackWheel, { passive: false });
  track.addEventListener('mousedown', onTrackMouseDown);
  thumb.addEventListener('mousedown', onThumbMouseDown);
  upButton.addEventListener('mousedown', onUpMouseDown);
  downButton.addEventListener('mousedown', onDownMouseDown);
  document.addEventListener('mousemove', onDocumentMouseMove);
  document.addEventListener('mouseup', onDocumentMouseUp);
  render();

  return {
    updateState(next: ScrollbarState) {
      state = next;
      render();
    },
    setAutohide(value: boolean) {
      autohide = value;
      if (!autohide) setVisible(false);
      render();
      opts.requestFit();
    },
    handleWheel,
    dispose() {
      if (hideTimer) clearTimeout(hideTimer);
      stopArrowRepeat();
      dragging = false;
      dragGrabOffsetPx = 0;
      opts.root.classList.remove('dragging');
      opts.root.classList.remove('visible');
      track.removeEventListener('wheel', onTrackWheel);
      track.removeEventListener('mousedown', onTrackMouseDown);
      thumb.removeEventListener('mousedown', onThumbMouseDown);
      upButton.removeEventListener('mousedown', onUpMouseDown);
      downButton.removeEventListener('mousedown', onDownMouseDown);
      document.removeEventListener('mousemove', onDocumentMouseMove);
      document.removeEventListener('mouseup', onDocumentMouseUp);
    },
  };
}

function ensureChild(parent: HTMLElement, selector: string, className: string): HTMLElement {
  const existing = parent.querySelector(selector);
  if (existing) return existing as HTMLElement;

  const child = document.createElement('div');
  child.classList.add(className);
  parent.appendChild(child);
  return child;
}

function readTrackHeight(track: HTMLElement): number {
  const rect = track.getBoundingClientRect?.();
  return rect?.height || track.offsetHeight || 0;
}

/* Pixels of breathing room reserved at the top and bottom of the
 * track. The thumb is positioned and sized as if the track were
 * `top + bottom` pixels shorter, so it never sits flush against the
 * track edges. Set via `--tw-scrollbar-thumb-margin` on the scrollbar
 * root (symmetric default), with optional `-top` / `-bottom`
 * overrides for asymmetric layouts (e.g. tracks with a thicker
 * `border-bottom` that the controller can't see). */
function readThumbMargin(root: HTMLElement): { top: number; bottom: number } {
  if (typeof getComputedStyle !== 'function') return { top: 0, bottom: 0 };
  const style = getComputedStyle(root);
  const base = parsePxVar(style, '--tw-scrollbar-thumb-margin');
  const top = parsePxVar(style, '--tw-scrollbar-thumb-margin-top');
  const bottom = parsePxVar(style, '--tw-scrollbar-thumb-margin-bottom');
  return {
    top: top ?? base ?? 0,
    bottom: bottom ?? base ?? 0,
  };
}

function parsePxVar(style: CSSStyleDeclaration, name: string): number | null {
  const value = style.getPropertyValue(name).trim();
  if (!value) return null;
  const match = /^(-?\d+(?:\.\d+)?)/.exec(value);
  return match ? Math.max(0, Number(match[1])) : null;
}

function viewportWidth(): number {
  if (typeof window !== 'undefined' && window.innerWidth) return window.innerWidth;
  return document.documentElement?.clientWidth || 0;
}

function setStyleProperty(el: HTMLElement, name: string, value: string): void {
  if (typeof el.style.setProperty === 'function') {
    el.style.setProperty(name, value);
    return;
  }
  (el.style as unknown as Record<string, string>)[name] = value;
}
