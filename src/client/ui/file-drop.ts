/** Drag-and-drop files onto the terminal. Dropped files are POSTed to
 *  /api/drop?session=<name>; the server persists under a per-session
 *  tmp dir and injects the absolute path into the focused pane as a
 *  bracketed paste (shell-quoted when the foreground process is a
 *  shell, raw otherwise). Visual overlay highlights the terminal while
 *  a drag is in progress. */

export interface FileDropOptions {
  terminal: HTMLElement;
  /** Pulled at drop time so session changes (URL rewrites) are picked
   *  up without re-binding. */
  getSession: () => string;
  /** Optional callback for a UI toast. Called per file after the server
   *  confirms the drop. */
  onDropped?: (info: { filename: string; size: number; path: string }) => void;
  /** Optional callback on upload failure. */
  onError?: (err: unknown, file: File) => void;
}

export function installFileDropHandler(opts: FileDropOptions): () => void {
  const { terminal, getSession } = opts;

  const overlay = document.createElement('div');
  overlay.className = 'tw-drop-overlay';
  Object.assign(overlay.style, {
    position: 'absolute', inset: '0',
    display: 'none',
    alignItems: 'center', justifyContent: 'center',
    background: 'rgba(40, 80, 140, 0.25)',
    border: '2px dashed #88bbff',
    color: '#eee', fontSize: '14px', fontFamily: 'inherit',
    pointerEvents: 'none', zIndex: '50',
  } as Partial<CSSStyleDeclaration>);
  overlay.textContent = 'Drop to upload';
  // Terminal is absolutely positioned; make its parent the overlay anchor
  // by inserting the overlay as a sibling inside the same container.
  terminal.style.position = terminal.style.position || 'relative';
  terminal.appendChild(overlay);

  // The browser fires dragenter/dragleave on child elements too, which
  // would flicker the overlay. Count enters vs. leaves to get a stable
  // "drag is happening over us" signal.
  let depth = 0;
  const show = () => { overlay.style.display = 'flex'; };
  const hide = () => { overlay.style.display = 'none'; };

  const hasFiles = (dt: DataTransfer | null): boolean => {
    if (!dt) return false;
    // Chromium sets types ['Files'] when files are being dragged. Filter out
    // in-page text selection drags so we don't advertise as a drop target
    // for those.
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
    const session = getSession();
    for (const file of Array.from(files)) {
      try {
        const res = await fetch(`/api/drop?session=${encodeURIComponent(session)}`, {
          method: 'POST',
          headers: { 'X-Filename': encodeURIComponent(file.name) },
          body: file,
        });
        if (!res.ok) {
          opts.onError?.(new Error(`drop upload ${res.status}`), file);
          continue;
        }
        const info = await res.json() as { filename: string; size: number; path: string };
        opts.onDropped?.(info);
      } catch (err) {
        opts.onError?.(err, file);
      }
    }
  };

  terminal.addEventListener('dragenter', onEnter);
  terminal.addEventListener('dragover', onOver);
  terminal.addEventListener('dragleave', onLeave);
  terminal.addEventListener('drop', onDrop);

  return () => {
    terminal.removeEventListener('dragenter', onEnter);
    terminal.removeEventListener('dragover', onOver);
    terminal.removeEventListener('dragleave', onLeave);
    terminal.removeEventListener('drop', onDrop);
    overlay.remove();
  };
}
