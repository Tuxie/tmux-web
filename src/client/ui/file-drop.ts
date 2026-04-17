/** Drag-and-drop AND clipboard-paste of files onto the terminal.
 *  Both paths POST to /api/drop?session=<name>; the server persists
 *  under a per-session tmp dir and injects the absolute path into the
 *  focused pane as a bracketed paste (shell-quoted when the foreground
 *  process is a shell, raw otherwise).
 *
 *  Firefox + macOS Finder caveat: pasting *multiple* files exposes only
 *  the first file to JS. The clipboard advertises just
 *  `application/x-moz-file` + `Files` — no uri-list, no promise URLs —
 *  so we can't even detect that the user tried to paste more. Chrome
 *  and Safari expose all files correctly. Workaround in Firefox: use
 *  drag-and-drop for multi-file, or paste one at a time. */

export interface UploadedInfo { filename: string; size: number; path: string }

export interface FileDropOptions {
  terminal: HTMLElement;
  /** Pulled at drop time so session changes (URL rewrites) are picked
   *  up without re-binding. */
  getSession: () => string;
  /** Optional callback for a UI toast. Called per file after the server
   *  confirms the drop. */
  onDropped?: (info: UploadedInfo) => void;
  /** Optional callback on upload failure. */
  onError?: (err: unknown, file: File) => void;
}

export async function uploadFile(
  session: string,
  file: File,
  fetchImpl: typeof fetch = fetch,
): Promise<UploadedInfo> {
  const res = await fetchImpl(`/api/drop?session=${encodeURIComponent(session)}`, {
    method: 'POST',
    headers: { 'X-Filename': encodeURIComponent(file.name) },
    body: file,
  });
  if (!res.ok) throw new Error(`drop upload ${res.status}`);
  return await res.json() as UploadedInfo;
}

async function uploadAll(
  files: Iterable<File>,
  session: string,
  opts: Pick<FileDropOptions, 'onDropped' | 'onError'>,
): Promise<void> {
  for (const file of files) {
    try {
      const info = await uploadFile(session, file);
      opts.onDropped?.(info);
    } catch (err) {
      opts.onError?.(err, file);
    }
  }
}

export function installFileDropHandler(opts: FileDropOptions): () => void {
  const { terminal, getSession } = opts;

  const overlay = document.createElement('div');
  overlay.className = 'tw-drop-overlay';
  overlay.textContent = 'Drop to upload';
  terminal.appendChild(overlay);

  let depth = 0;
  const show = () => { overlay.classList.add('visible'); };
  const hide = () => { overlay.classList.remove('visible'); };

  const hasFiles = (dt: DataTransfer | null): boolean => {
    if (!dt) return false;
    return Array.from(dt.types).includes('Files');
  };

  const onEnter = (ev: DragEvent): void => {
    if (!hasFiles(ev.dataTransfer)) return;
    ev.preventDefault();
    depth++;
    show();
  };
  const onOver = (ev: DragEvent): void => {
    if (!hasFiles(ev.dataTransfer)) return;
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
  };
  const onLeave = (ev: DragEvent): void => {
    if (!hasFiles(ev.dataTransfer)) return;
    ev.preventDefault();
    depth = Math.max(0, depth - 1);
    if (depth === 0) hide();
  };
  const onDrop = async (ev: DragEvent): Promise<void> => {
    if (!hasFiles(ev.dataTransfer)) return;
    ev.preventDefault();
    depth = 0;
    hide();
    const files = ev.dataTransfer?.files;
    if (!files || files.length === 0) return;
    await uploadAll(Array.from(files), getSession(), opts);
  };

  // Clipboard paste: DataTransfer may include files (image copy, file
  // manager "copy"). Handled on the document so it works regardless of
  // which element holds focus — xterm swallows paste events itself.
  const onPaste = async (ev: ClipboardEvent): Promise<void> => {
    const cd = ev.clipboardData;
    if (!cd) return;
    const files = filesFromClipboard(cd);
    if (files.length === 0) return;
    // Only pre-empt the terminal's own paste when we actually have files;
    // plain-text paste must still reach xterm.
    ev.preventDefault();
    ev.stopPropagation();
    await uploadAll(files, getSession(), opts);
  };

  terminal.addEventListener('dragenter', onEnter);
  terminal.addEventListener('dragover', onOver);
  terminal.addEventListener('dragleave', onLeave);
  terminal.addEventListener('drop', onDrop);
  // Capture phase so we run before xterm's textarea paste handler.
  document.addEventListener('paste', onPaste, true);

  return () => {
    terminal.removeEventListener('dragenter', onEnter);
    terminal.removeEventListener('dragover', onOver);
    terminal.removeEventListener('dragleave', onLeave);
    terminal.removeEventListener('drop', onDrop);
    document.removeEventListener('paste', onPaste, true);
    overlay.remove();
  };
}

/** Extract File objects from a ClipboardEvent's DataTransfer.
 *
 *  Multi-file paste is messy across browsers:
 *    - Chromium paste from OS file manager: all files land in both
 *      `cd.files` and `cd.items[kind=file]`.
 *    - Some browsers / some sources populate only `cd.items` (e.g.
 *      image paste) and leave `cd.files` empty.
 *    - Occasionally `cd.files` only has the first item while `items[]`
 *      has all of them.
 *
 *  So: collect from BOTH sources and dedupe by identity, preferring
 *  whichever gives us more files. Dropping the early-return means we
 *  never silently discard trailing files because one source was short. */
export function filesFromClipboard(cd: DataTransfer): File[] {
  const fromFiles: File[] = cd.files ? Array.from(cd.files) : [];
  const fromItems: File[] = [];
  if (cd.items) {
    for (const item of Array.from(cd.items)) {
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f) fromItems.push(f);
      }
    }
  }
  // Pick the larger set; if equal, prefer files[] (more canonical).
  const base = fromItems.length > fromFiles.length ? fromItems : fromFiles;
  const other = base === fromItems ? fromFiles : fromItems;
  const seen = new Set<File>(base);
  for (const f of other) if (!seen.has(f)) { base.push(f); seen.add(f); }
  return base;
}
