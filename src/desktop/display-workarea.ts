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

export interface WorkAreaDebugInfo {
  displayId: number;
  displayBounds: Rectangle;
  selectedWorkArea: Rectangle;
  xCandidates: number[];
  yCandidates: number[];
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

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values)];
}

function pickClosest(target: number, values: number[]): number {
  let best = values[0]!;
  let bestDistance = Math.abs(target - best);
  for (const value of values.slice(1)) {
    const distance = Math.abs(target - value);
    if (distance < bestDistance) {
      best = value;
      bestDistance = distance;
    }
  }
  return best;
}

function pickY(target: number, values: number[]): number {
  if (target < 0) {
    const negative = values.filter((value) => value < 0);
    if (negative.length > 0) return Math.max(...negative);
  }
  return pickClosest(target, values);
}

function normalizedWorkAreaDetails(display: Display, frame: Rectangle): WorkAreaDebugInfo {
  const { bounds, workArea } = display;
  const xCandidates = uniqueNumbers([
    workArea.x,
    bounds.x + workArea.x,
  ]).filter((x) => x >= bounds.x && x + workArea.width <= bounds.x + bounds.width);

  const topInsetFromGlobal = workArea.y - bounds.y;
  const yCandidates = uniqueNumbers([
    workArea.y,
    -workArea.y,
    bounds.y + workArea.y,
    -(bounds.y + workArea.y),
    bounds.y + bounds.height - topInsetFromGlobal - workArea.height,
    -(bounds.y + bounds.height - topInsetFromGlobal - workArea.height),
    bounds.y + bounds.height - workArea.y - workArea.height,
    -(bounds.y + bounds.height - workArea.y - workArea.height),
  ]).filter((y) => Number.isFinite(y));

  return {
    displayId: display.id,
    displayBounds: bounds,
    xCandidates,
    yCandidates,
    selectedWorkArea: {
      x: pickClosest(frame.x, xCandidates.length > 0 ? xCandidates : [workArea.x]),
      y: pickY(frame.y, yCandidates.length > 0 ? yCandidates : [workArea.y]),
      width: workArea.width,
      height: workArea.height,
    },
  };
}

function normalizedWorkArea(display: Display, frame: Rectangle): Rectangle {
  return normalizedWorkAreaDetails(display, frame).selectedWorkArea;
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
  if (bestOverlap > 0) return normalizedWorkArea(best, frame);

  best = displays[0]!;
  let bestDistance = centerDistanceSquared(frame, best.bounds);
  for (const display of displays.slice(1)) {
    const distance = centerDistanceSquared(frame, display.bounds);
    if (distance < bestDistance) {
      best = display;
      bestDistance = distance;
    }
  }
  return normalizedWorkArea(best, frame);
}

export function debugWorkAreaForFrame(
  frame: Rectangle,
  displays: Display[],
  fallbackWorkArea: Rectangle,
): WorkAreaDebugInfo {
  if (displays.length === 0) {
    return {
      displayId: -1,
      displayBounds: fallbackWorkArea,
      selectedWorkArea: fallbackWorkArea,
      xCandidates: [fallbackWorkArea.x],
      yCandidates: [fallbackWorkArea.y],
    };
  }

  let best = displays[0]!;
  let bestOverlap = overlapArea(frame, best.bounds);
  for (const display of displays.slice(1)) {
    const area = overlapArea(frame, display.bounds);
    if (area > bestOverlap) {
      best = display;
      bestOverlap = area;
    }
  }
  if (bestOverlap > 0) return normalizedWorkAreaDetails(best, frame);

  best = displays[0]!;
  let bestDistance = centerDistanceSquared(frame, best.bounds);
  for (const display of displays.slice(1)) {
    const distance = centerDistanceSquared(frame, display.bounds);
    if (distance < bestDistance) {
      best = display;
      bestDistance = distance;
    }
  }
  return normalizedWorkAreaDetails(best, frame);
}
