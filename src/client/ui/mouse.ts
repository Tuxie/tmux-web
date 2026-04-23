import type { CellMetrics } from '../../shared/types.js';

export function getSgrCoords(
  clientX: number, clientY: number,
  metrics: CellMetrics, canvasRect: { left: number; top: number },
): { col: number; row: number } {
  return {
    col: Math.max(1, Math.floor((clientX - canvasRect.left) / metrics.width) + 1),
    row: Math.max(1, Math.floor((clientY - canvasRect.top) / metrics.height) + 1),
  };
}

export function buildSgrSequence(button: number, col: number, row: number, isRelease: boolean): string {
  return `\x1b[<${button};${col};${row}${isRelease ? 'm' : 'M'}`;
}

export function mouseButton(ev: MouseEvent): number {
  return ev.button === 2 ? 2 : ev.button === 1 ? 1 : 0;
}

export function addModifiers(button: number, ev: MouseEvent | WheelEvent): number {
  let btn = button;
  if (ev.altKey) btn += 8;
  if (ev.ctrlKey) btn += 16;
  return btn;
}

export function buildWheelSgrSequences(
  ev: WheelEvent,
  metrics: CellMetrics,
  canvasRect: { left: number; top: number },
): string[] {
  const coords = getSgrCoords(ev.clientX, ev.clientY, metrics, canvasRect);
  const btn = addModifiers(ev.deltaY < 0 ? 64 : 65, ev);
  const count = Math.max(1, Math.min(Math.abs(Math.round(ev.deltaY / 33)), 5));
  const seq: string[] = [];
  for (let i = 0; i < count; i++) {
    seq.push(buildSgrSequence(btn, coords.col, coords.row, false));
  }
  return seq;
}

export interface MouseHandlerOptions {
  getMetrics: () => CellMetrics;
  getCanvasRect: () => DOMRect;
  getTerminalElement: () => HTMLElement;
  send: (data: string) => void;
}

/** xterm's web-links addon sets `cursor: pointer` on the cell overlay
 *  when a URL is under the mouse. Use that as the signal that the
 *  click belongs to xterm (the link handler) and not to our SGR
 *  forwarding — our document-capture stopPropagation would otherwise
 *  swallow the event before xterm's listeners see it. */
function isOverLink(ev: MouseEvent): boolean {
  const target = ev.target as Element | null;
  if (!target) return false;
  try {
    return getComputedStyle(target).cursor === 'pointer';
  } catch {
    return false;
  }
}

export function installMouseHandler(opts: MouseHandlerOptions): () => void {
  let dragButton = -1;

  function handleMouseDown(ev: MouseEvent) {
    if (ev.shiftKey || !opts.getTerminalElement().contains(ev.target as Node)) return;
    if (isOverLink(ev)) return;
    dragButton = mouseButton(ev);
    const coords = getSgrCoords(ev.clientX, ev.clientY, opts.getMetrics(), opts.getCanvasRect());
    const btn = addModifiers(dragButton, ev);
    opts.send(buildSgrSequence(btn, coords.col, coords.row, false));
    ev.preventDefault();
    ev.stopPropagation();
  }

  function handleMouseUp(ev: MouseEvent) {
    if (ev.shiftKey || dragButton < 0) return;
    if (isOverLink(ev)) { dragButton = -1; return; }
    const coords = getSgrCoords(ev.clientX, ev.clientY, opts.getMetrics(), opts.getCanvasRect());
    const btn = addModifiers(dragButton, ev);
    opts.send(buildSgrSequence(btn, coords.col, coords.row, true));
    dragButton = -1;
    ev.preventDefault();
    ev.stopPropagation();
  }

  function handleMouseMove(ev: MouseEvent) {
    if (dragButton < 0) return;
    const coords = getSgrCoords(ev.clientX, ev.clientY, opts.getMetrics(), opts.getCanvasRect());
    const btn = addModifiers(dragButton + 32, ev);
    opts.send(buildSgrSequence(btn, coords.col, coords.row, false));
  }

  function handleContextMenu(ev: MouseEvent) {
    if (!ev.shiftKey && opts.getTerminalElement().contains(ev.target as Node)) {
      ev.preventDefault();
    }
  }

  document.addEventListener('mousedown', handleMouseDown, true);
  document.addEventListener('mouseup', handleMouseUp, true);
  document.addEventListener('mousemove', handleMouseMove, true);
  document.addEventListener('contextmenu', handleContextMenu, true);

  return () => {
    document.removeEventListener('mousedown', handleMouseDown, true);
    document.removeEventListener('mouseup', handleMouseUp, true);
    document.removeEventListener('mousemove', handleMouseMove, true);
    document.removeEventListener('contextmenu', handleContextMenu, true);
  };
}
