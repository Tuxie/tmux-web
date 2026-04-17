/** Lightweight auto-dismissing toast. Inline styled so there's no
 *  theme-CSS dependency; themes can still override via .tw-toast etc.
 *  if they want. Stacks multiple toasts bottom-up. */

const container = (() => {
  const el = document.createElement('div');
  el.className = 'tw-toast-stack';
  Object.assign(el.style, {
    position: 'fixed',
    right: '12px',
    bottom: '12px',
    display: 'flex',
    flexDirection: 'column-reverse',
    gap: '6px',
    zIndex: '9000',
    pointerEvents: 'none',
  } as Partial<CSSStyleDeclaration>);
  return el;
})();
let attached = false;

export interface ToastOpts {
  durationMs?: number;
  variant?: 'info' | 'error';
}

export function showToast(text: string, opts: ToastOpts = {}): void {
  if (!attached) {
    document.body.appendChild(container);
    attached = true;
  }

  const toast = document.createElement('div');
  toast.className = 'tw-toast tw-toast-' + (opts.variant ?? 'info');
  Object.assign(toast.style, {
    background: opts.variant === 'error' ? '#5a2a2a' : '#262626',
    color: '#e0e0e0',
    border: '1px solid ' + (opts.variant === 'error' ? '#a05555' : '#555'),
    borderRadius: '3px',
    padding: '6px 10px',
    fontSize: '12px',
    fontFamily: 'inherit',
    maxWidth: '360px',
    boxShadow: '0 3px 10px rgba(0,0,0,0.4)',
    opacity: '0',
    transform: 'translateY(4px)',
    transition: 'opacity 120ms ease, transform 120ms ease',
    pointerEvents: 'auto',
  } as Partial<CSSStyleDeclaration>);
  toast.textContent = text;
  container.appendChild(toast);

  // Next frame: animate in.
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  });

  const duration = opts.durationMs ?? 3500;
  const dismiss = () => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(4px)';
    setTimeout(() => toast.remove(), 160);
  };
  setTimeout(dismiss, duration);
  toast.addEventListener('click', dismiss);
}

/** Format a byte count as a short human-readable string (KB/MB, 1 dp). */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
