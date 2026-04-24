import type { Display, Rectangle } from './display-workarea.js';

export function toNativeWindowFrame(frame: Rectangle, displays: Display[]): Rectangle {
  if (displays.length === 0) return frame;
  const maxY = Math.max(...displays.map((display) => display.bounds.y + display.bounds.height));
  return {
    x: frame.x,
    y: maxY - (frame.y + frame.height),
    width: frame.width,
    height: frame.height,
  };
}
