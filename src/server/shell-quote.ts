/** POSIX-compliant single-quote shell escape.
 *
 *  The only character that can't appear inside `'...'` is a single quote,
 *  so we close the quoted section, emit a literal quote with `\'`, and
 *  reopen. Handles every other byte including newlines, NUL-free input
 *  from the file-drop layer, UTF-8, and shell metacharacters.
 *
 *  Empty input becomes `''` (valid POSIX empty argument). */
export function shellQuote(s: string): string {
  if (s === '') return "''";
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/** Basename-based heuristic for "is this exe a shell that needs the path
 *  to be shell-quoted before bracketed paste?". List covers the common
 *  login/interactive shells. Anything else — TUIs, editors, claude —
 *  gets the raw path. */
const SHELL_BASENAMES = new Set([
  'bash', 'zsh', 'fish', 'sh', 'dash', 'ksh', 'mksh', 'tcsh', 'csh', 'yash',
  'ash', 'busybox',
]);

export function isShell(exePath: string | null): boolean {
  if (!exePath) return false;
  const slash = exePath.lastIndexOf('/');
  const base = slash >= 0 ? exePath.slice(slash + 1) : exePath;
  return SHELL_BASENAMES.has(base);
}
