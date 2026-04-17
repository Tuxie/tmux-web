import { isShell, shellQuote } from './shell-quote.js';

/** Pure helper for formatting a dropped file's path into the bytes we
 *  inject into the pane. Extracted so it can be unit-tested without
 *  spinning up an HTTP handler.
 *
 *  Rules (re)established:
 *    - Raw path for Claude / TUIs / unknown foreground.
 *    - Single-quoted path for shells so spaces / metacharacters don't
 *      split the argument.
 *    - Wrapped in bracketed paste so shells don't auto-execute on Enter
 *      mid-stream.
 *    - Trailing space so multi-file drops concatenate into
 *      `path1 path2 …` (each drop arrives as its own bracketed paste;
 *      the trailing space is just an extra byte inside the paste). */
export function formatBracketedPasteForDrop(
  foregroundExePath: string | null,
  absolutePath: string,
): string {
  const quoted = isShell(foregroundExePath) ? shellQuote(absolutePath) : absolutePath;
  return `\x1b[200~${quoted} \x1b[201~`;
}
