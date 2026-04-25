import type { ScrollbarState } from "../shared/types.js";
import type { RunCmd } from "./tmux-control.js";

export const SCROLLBAR_FORMAT = "#{pane_id}\t#{pane_height}\t#{history_size}\t#{scroll_position}\t#{pane_in_mode}\t#{pane_mode}\t#{alternate_on}";

export type ScrollbarAction =
  | { action: "line-up"; count?: number }
  | { action: "line-down"; count?: number }
  | { action: "page-up" }
  | { action: "page-down" }
  | { action: "drag"; position?: number };

export function unavailableScrollbarState(): ScrollbarState {
  return {
    paneId: null,
    paneHeight: 0,
    historySize: 0,
    scrollPosition: 0,
    paneInMode: 0,
    paneMode: "",
    alternateOn: false,
    unavailable: true,
  };
}

function parseNonNegativeInt(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

export function parseScrollbarState(raw: string): ScrollbarState {
  const parts = raw.split("\t");
  if (parts.length !== 7) return unavailableScrollbarState();
  const [paneId, paneHeightRaw, historySizeRaw, scrollPositionRaw, paneInModeRaw, paneMode, alternateOnRaw] = parts;
  const paneHeight = parseNonNegativeInt(paneHeightRaw);
  const historySize = parseNonNegativeInt(historySizeRaw);
  const paneInMode = parseNonNegativeInt(paneInModeRaw);
  const scrollPosition = scrollPositionRaw === "" && paneInMode === 0
    ? 0
    : parseNonNegativeInt(scrollPositionRaw);
  if (
    !paneId ||
    paneHeight === null ||
    historySize === null ||
    scrollPosition === null ||
    paneInMode === null ||
    (alternateOnRaw !== "0" && alternateOnRaw !== "1")
  ) {
    return unavailableScrollbarState();
  }
  return {
    paneId,
    paneHeight,
    historySize,
    scrollPosition,
    paneInMode,
    paneMode,
    alternateOn: alternateOnRaw === "1",
  };
}

export function buildScrollbarSubscriptionArgs(name: string): string[] {
  return ["refresh-client", "-B", `${name}:%*:${SCROLLBAR_FORMAT}`];
}

function countFrom(action: { count?: number }, fallback: number): number {
  const n = typeof action.count === "number" && Number.isFinite(action.count) ? Math.round(action.count) : fallback;
  return clampScrollCount(n);
}

function clampScrollCount(n: number): number {
  return Math.max(1, Math.min(n, 500));
}

async function ensureCopyMode(run: RunCmd, paneId: string): Promise<void> {
  await run(["copy-mode", "-e", "-t", paneId]);
}

async function sendCopyScroll(run: RunCmd, paneId: string, count: number, direction: "scroll-up" | "scroll-down-and-cancel"): Promise<void> {
  await run(["send-keys", "-X", "-t", paneId, "-N", String(count), direction]);
}

function canScrollDown(state: ScrollbarState): boolean {
  return state.paneInMode > 0 && state.scrollPosition > 0;
}

export async function applyScrollbarAction(opts: {
  action: ScrollbarAction["action"];
  count?: number;
  position?: number;
  getState: () => Promise<ScrollbarState>;
  run: RunCmd;
}): Promise<void> {
  const state = await opts.getState();
  if (state.unavailable || state.alternateOn || !state.paneId || state.historySize <= 0) return;

  if (opts.action === "line-up") {
    await ensureCopyMode(opts.run, state.paneId);
    await sendCopyScroll(opts.run, state.paneId, countFrom(opts, 1), "scroll-up");
    return;
  }
  if (opts.action === "line-down") {
    if (!canScrollDown(state)) return;
    await sendCopyScroll(opts.run, state.paneId, countFrom(opts, 1), "scroll-down-and-cancel");
    return;
  }
  if (opts.action === "page-up") {
    await ensureCopyMode(opts.run, state.paneId);
    await sendCopyScroll(opts.run, state.paneId, clampScrollCount(state.paneHeight - 1), "scroll-up");
    return;
  }
  if (opts.action === "page-down") {
    if (!canScrollDown(state)) return;
    await sendCopyScroll(opts.run, state.paneId, clampScrollCount(state.paneHeight - 1), "scroll-down-and-cancel");
    return;
  }
  if (opts.action === "drag") {
    const target = typeof opts.position === "number" && Number.isFinite(opts.position)
      ? Math.max(0, Math.min(Math.round(opts.position), state.historySize))
      : state.scrollPosition;
    const delta = target - state.scrollPosition;
    if (delta === 0) return;
    if (delta < 0 && !canScrollDown(state)) return;
    await ensureCopyMode(opts.run, state.paneId);
    await sendCopyScroll(opts.run, state.paneId, clampScrollCount(Math.abs(delta)), delta > 0 ? "scroll-up" : "scroll-down-and-cancel");
  }
}
