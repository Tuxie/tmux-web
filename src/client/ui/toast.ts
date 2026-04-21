/** Lightweight auto-dismissing toast. Inline styled so there's no
 *  theme-CSS dependency; themes can still override via .tw-toast etc.
 *  if they want. Stacks multiple toasts bottom-up. */

const container = (() => {
  const el = document.createElement('div');
  el.className = 'tw-toast-stack';
  return el;
})();

export interface ToastOpts {
  durationMs?: number;
  variant?: 'info' | 'error';
}

export function showToast(text: string, opts: ToastOpts = {}): void {
  // Re-attach on every call if needed, rather than caching a boolean
  // `attached` flag. The flag loses sync when document.body is replaced
  // (which never happens in production but does in tests / SPAs that
  // rewrite the body) — checking parentNode is cheap and self-heals.
  if (container.parentNode !== document.body) {
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = 'tw-toast tw-toast-' + (opts.variant ?? 'info');
  toast.textContent = text;
  container.appendChild(toast);

  // Next frame: animate in (triggers the .visible CSS transition).
  requestAnimationFrame(() => { toast.classList.add('visible'); });

  const duration = opts.durationMs ?? 3500;
  const dismiss = () => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 160);
  };
  setTimeout(dismiss, duration);
  toast.addEventListener('click', dismiss);
}

/** Test-only: detach the container and clear its children. Production
 *  code never calls this; unit tests that re-stub `document` between
 *  cases invoke it so the module-level container starts fresh. */
export function _resetForTest(): void {
  while (container.children.length > 0) container.children[0]!.remove();
  if (container.parentNode) container.remove();
}

/** Format a byte count as a short human-readable string (KB/MB, 1 dp). */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
