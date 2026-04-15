import { TOML } from "bun";
import type { ITheme } from '../shared/types.js';

export type { ITheme };

function normalize(c: unknown): string | undefined {
  if (typeof c !== "string") return undefined;
  const trimmed = c.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("#")) return trimmed.toLowerCase();
  if (trimmed.startsWith("0x") || trimmed.startsWith("0X")) return "#" + trimmed.slice(2).toLowerCase();
  return "#" + trimmed.toLowerCase();
}

const NORMAL_KEYS = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"] as const;

export function alacrittyTomlToITheme(src: string): ITheme {
  const parsed = TOML.parse(src) as any;
  const colors = parsed?.colors ?? {};
  const primary = colors.primary ?? {};
  const fg = normalize(primary.foreground);
  const bg = normalize(primary.background);
  if (!fg && !bg) {
    throw new Error("alacritty theme missing [colors.primary] foreground/background");
  }
  const out: ITheme = {};
  if (fg) out.foreground = fg;
  if (bg) out.background = bg;

  for (const key of NORMAL_KEYS) {
    const n = normalize(colors.normal?.[key]);
    if (n) (out as any)[key] = n;
    const b = normalize(colors.bright?.[key]);
    if (b) (out as any)["bright" + key[0]!.toUpperCase() + key.slice(1)] = b;
  }

  const cur = normalize(colors.cursor?.cursor);
  if (cur) out.cursor = cur;
  const curTxt = normalize(colors.cursor?.text);
  if (curTxt) out.cursorAccent = curTxt;

  const selBg = normalize(colors.selection?.background);
  if (selBg) out.selectionBackground = selBg;
  const selFg = normalize(colors.selection?.text);
  if (selFg) out.selectionForeground = selFg;

  return out;
}
