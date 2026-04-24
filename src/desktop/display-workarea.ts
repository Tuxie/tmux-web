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

export interface Point {
  x: number;
  y: number;
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

function candidateBounds(display: Display): Rectangle[] {
  return uniqueNumbers([
    display.bounds.y,
    display.bounds.y - display.bounds.height + (display.workArea.y - display.bounds.y),
  ]).map((y) => ({
    x: display.bounds.x,
    y,
    width: display.bounds.width,
    height: display.bounds.height,
  }));
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values)];
}

function desktopMaxY(displays: Display[]): number {
  return Math.max(...displays.map((display) => display.bounds.y + display.bounds.height));
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
  return pickClosest(target, values);
}

function normalizedWorkAreaDetails(display: Display, frame: Rectangle, globalMaxY: number): WorkAreaDebugInfo {
  const { bounds, workArea } = display;
  const xCandidates = uniqueNumbers([
    workArea.x,
    bounds.x + workArea.x,
  ]).filter((x) => x >= bounds.x && x + workArea.width <= bounds.x + bounds.width);

  const topInsetFromGlobal = workArea.y - bounds.y;
  const negativeSpaceCandidate = workArea.y + workArea.height - globalMaxY + topInsetFromGlobal;
  const belowPrimaryCandidate = workArea.y - bounds.y + bounds.height;
  const yCandidates = uniqueNumbers([
    workArea.y,
    -workArea.y,
    bounds.y + workArea.y,
    -(bounds.y + workArea.y),
    negativeSpaceCandidate,
    belowPrimaryCandidate,
    bounds.y + bounds.height - topInsetFromGlobal - workArea.height,
    -(bounds.y + bounds.height - topInsetFromGlobal - workArea.height),
    bounds.y + bounds.height - workArea.y - workArea.height,
    -(bounds.y + bounds.height - workArea.y - workArea.height),
  ]).filter((y) => Number.isFinite(y));

  const selectedY = display.isPrimary && frame.y < 0
    ? workArea.y
    : !display.isPrimary && frame.y < 0 && Number.isFinite(negativeSpaceCandidate)
        ? negativeSpaceCandidate
        : !display.isPrimary && bounds.y > 0 && frame.y > 0 && Number.isFinite(belowPrimaryCandidate)
            ? belowPrimaryCandidate
        : pickY(frame.y, yCandidates.length > 0 ? yCandidates : [workArea.y]);

  return {
    displayId: display.id,
    displayBounds: bounds,
    xCandidates,
    yCandidates,
    selectedWorkArea: {
      x: pickClosest(frame.x, xCandidates.length > 0 ? xCandidates : [workArea.x]),
      y: selectedY,
      width: workArea.width,
      height: workArea.height,
    },
  };
}

export function workAreaForFrame(
  frame: Rectangle,
  displays: Display[],
  fallbackWorkArea: Rectangle,
): Rectangle {
  return debugWorkAreaForFrame(frame, displays, fallbackWorkArea).selectedWorkArea;
}

export function workAreaForPoint(
  point: Point,
  frame: Rectangle,
  displays: Display[],
  fallbackWorkArea: Rectangle,
): Rectangle {
  return debugWorkAreaForPoint(point, frame, displays, fallbackWorkArea).selectedWorkArea;
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
  const maxY = desktopMaxY(displays);

  let best = displays[0]!;
  let bestOverlap = overlapArea(frame, best.bounds);
  for (const display of displays.slice(1)) {
    const area = overlapArea(frame, display.bounds);
    if (area > bestOverlap) {
      best = display;
      bestOverlap = area;
    }
  }
  if (bestOverlap > 0) return normalizedWorkAreaDetails(best, frame, maxY);

  best = displays[0]!;
  let bestDistance = centerDistanceSquared(frame, best.bounds);
  for (const display of displays.slice(1)) {
    const distance = centerDistanceSquared(frame, display.bounds);
    if (distance < bestDistance) {
      best = display;
      bestDistance = distance;
    }
  }
  return normalizedWorkAreaDetails(best, frame, maxY);
}

export function debugWorkAreaForPoint(
  point: Point,
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

  const hit = displays.find((display) => (
    point.x >= display.bounds.x
    && point.y >= display.bounds.y
    && point.x <= display.bounds.x + display.bounds.width
    && point.y <= display.bounds.y + display.bounds.height
  ));
  if (hit) return normalizedWorkAreaDetails(hit, frame, desktopMaxY(displays));

  let best = displays[0]!;
  let bestDistance = centerDistanceSquared(
    { x: point.x, y: point.y, width: 0, height: 0 },
    best.bounds,
  );
  for (const display of displays.slice(1)) {
    const distance = centerDistanceSquared(
      { x: point.x, y: point.y, width: 0, height: 0 },
      display.bounds,
    );
    if (distance < bestDistance) {
      best = display;
      bestDistance = distance;
    }
  }
  return normalizedWorkAreaDetails(best, frame, desktopMaxY(displays));
}
