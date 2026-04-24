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

function desktopMaxY(displays: Display[]): number {
  return Math.max(...displays.map((display) => display.bounds.y + display.bounds.height));
}

function flipGlobalY(rect: Rectangle, maxY: number): Rectangle {
  return {
    x: rect.x,
    y: maxY - (rect.y + rect.height),
    width: rect.width,
    height: rect.height,
  };
}

function uniqueRects(rects: Rectangle[]): Rectangle[] {
  const seen = new Set<string>();
  const out: Rectangle[] = [];
  for (const rect of rects) {
    const key = `${rect.x}:${rect.y}:${rect.width}:${rect.height}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rect);
  }
  return out;
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

function originDistanceSquared(a: Rectangle, b: Rectangle): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

function containsRect(outer: Rectangle, inner: Rectangle): boolean {
  return inner.x >= outer.x
    && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width
    && inner.y + inner.height <= outer.y + outer.height;
}

function candidateBounds(display: Display, maxY: number): Rectangle[] {
  return uniqueRects([
    display.bounds,
    flipGlobalY(display.bounds, maxY),
  ]);
}

function candidateWorkAreas(display: Display, maxY: number): Rectangle[] {
  const { bounds, workArea } = display;
  const localDirect = {
    x: bounds.x + workArea.x,
    y: bounds.y + workArea.y,
    width: workArea.width,
    height: workArea.height,
  };
  const localFlipped = {
    x: localDirect.x,
    y: bounds.y + bounds.height - workArea.y - workArea.height,
    width: workArea.width,
    height: workArea.height,
  };
  return uniqueRects([
    workArea,
    flipGlobalY(workArea, maxY),
    localDirect,
    flipGlobalY(localDirect, maxY),
    localFlipped,
    flipGlobalY(localFlipped, maxY),
  ]);
}

function pickClosestToFrame(frame: Rectangle, candidates: Rectangle[]): Rectangle {
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

export function workAreaForFrame(
  frame: Rectangle,
  displays: Display[],
  fallbackWorkArea: Rectangle,
): Rectangle {
  if (displays.length === 0) return fallbackWorkArea;
  const maxY = desktopMaxY(displays);

  let best = { display: displays[0]!, bounds: candidateBounds(displays[0]!, maxY)[0]! };
  let bestOverlap = overlapArea(frame, best.bounds);
  for (const display of displays) {
    for (const bounds of candidateBounds(display, maxY)) {
      const area = overlapArea(frame, bounds);
      if (area > bestOverlap) {
        best = { display, bounds };
        bestOverlap = area;
      }
    }
  }

  if (bestOverlap <= 0) {
    let bestDistance = centerDistanceSquared(frame, best.bounds);
    for (const display of displays) {
      for (const bounds of candidateBounds(display, maxY)) {
        const distance = centerDistanceSquared(frame, bounds);
        if (distance < bestDistance) {
          best = { display, bounds };
          bestDistance = distance;
        }
      }
    }
  }

  const candidates = candidateWorkAreas(best.display, maxY);
  const contained = candidates.filter((candidate) => containsRect(best.bounds, candidate));
  return pickClosestToFrame(frame, contained.length > 0 ? contained : candidates);
}
