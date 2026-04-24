export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Display {
  id: number;
  bounds: Rectangle;
  workArea: Rectangle;
  scaleFactor: number;
  isPrimary: boolean;
}

function candidateWorkAreas(display: Display): Rectangle[] {
  const { bounds, workArea } = display;
  const looksGlobal =
    workArea.x >= bounds.x
    && workArea.y >= bounds.y
    && workArea.x + workArea.width <= bounds.x + bounds.width
    && workArea.y + workArea.height <= bounds.y + bounds.height;
  if (looksGlobal) return [workArea];
  const direct = {
    x: bounds.x + workArea.x,
    y: bounds.y + workArea.y,
    width: workArea.width,
    height: workArea.height,
  };
  const flipped = {
    x: direct.x,
    y: bounds.y + bounds.height - workArea.y - workArea.height,
    width: workArea.width,
    height: workArea.height,
  };
  return direct.y === flipped.y ? [direct] : [direct, flipped];
}

function originDistanceSquared(a: Rectangle, b: Rectangle): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

function normalizeWorkArea(display: Display, frame: Rectangle): Rectangle {
  const candidates = candidateWorkAreas(display);
  let best = candidates[0]!;
  let bestDistance = originDistanceSquared(frame, best);
  for (const candidate of candidates.slice(1)) {
    const distance = originDistanceSquared(frame, candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function overlapArea(a: Rectangle, b: Rectangle): number {
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function centerDistanceSquared(a: Rectangle, b: Rectangle): number {
  const ax = a.x + a.width / 2;
  const ay = a.y + a.height / 2;
  const bx = b.x + b.width / 2;
  const by = b.y + b.height / 2;
  return (ax - bx) ** 2 + (ay - by) ** 2;
}

export function workAreaForFrame(
  frame: Rectangle,
  displays: Display[],
  fallbackWorkArea: Rectangle,
): Rectangle {
  if (displays.length === 0) return fallbackWorkArea;

  let best = displays[0]!;
  let bestOverlap = overlapArea(frame, best.bounds);
  for (const display of displays.slice(1)) {
    const area = overlapArea(frame, display.bounds);
    if (area > bestOverlap) {
      best = display;
      bestOverlap = area;
    }
  }
  if (bestOverlap > 0) return normalizeWorkArea(best, frame);

  best = displays[0]!;
  let bestDistance = centerDistanceSquared(frame, best.bounds);
  for (const display of displays.slice(1)) {
    const distance = centerDistanceSquared(frame, display.bounds);
    if (distance < bestDistance) {
      best = display;
      bestDistance = distance;
    }
  }
  return normalizeWorkArea(best, frame);
}
