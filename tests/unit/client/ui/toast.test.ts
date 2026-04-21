import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'bun:test';
import { setupDocument } from '../_dom.js';

/** The `toast.ts` module evaluates `document.createElement` at import
 *  time, so `document` must be stubbed before the first import.
 *  `beforeEach` also re-stubs inside the interactive tests so each
 *  case sees a clean container. */

// Module-load-time document stub. formatBytes tests don't hit the DOM
// but the module eval does, so the stub has to exist before any
// freshModule() call.
beforeAll(() => { setupDocument(); });

// Save globals we mutate so other test files' tests see the real APIs.
const origSetTimeout = globalThis.setTimeout;
const origRAF = (globalThis as any).requestAnimationFrame;
afterAll(() => {
  (globalThis as any).setTimeout = origSetTimeout;
  (globalThis as any).requestAnimationFrame = origRAF;
});

async function freshModule() {
  // `toast.ts` now self-repairs its container attachment on every call
  // (see `showToast`), so a plain cached import is fine. This also
  // keeps Bun's coverage instrumentation attached to the canonical
  // module path.
  return await import('../../../../src/client/ui/toast.ts');
}

describe('formatBytes', () => {
  it('renders < 1024 as bytes', async () => {
    const { formatBytes } = await freshModule();
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('renders KB boundary at 1024', async () => {
    const { formatBytes } = await freshModule();
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(2560)).toBe('2.5 KB');
    expect(formatBytes(1024 * 1024 - 1)).toMatch(/KB$/);
  });

  it('renders MB boundary at 1 MiB', async () => {
    const { formatBytes } = await freshModule();
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(1024 * 1024 * 3 + 512 * 1024)).toBe('3.5 MB');
  });

  it('renders GB above 1 GiB', async () => {
    const { formatBytes } = await freshModule();
    expect(formatBytes(1024 ** 3)).toBe('1.0 GB');
    expect(formatBytes(1024 ** 3 * 2 + 1024 ** 2 * 512)).toBe('2.5 GB');
  });
});

describe('showToast', () => {
  let doc: ReturnType<typeof setupDocument>;
  let rafQueued: Array<() => void>;
  let timeouts: Array<{ fn: () => void; ms: number }>;

  beforeEach(async () => {
    doc = setupDocument();
    rafQueued = [];
    timeouts = [];
    (globalThis as any).requestAnimationFrame = (fn: () => void) => {
      rafQueued.push(fn);
      return rafQueued.length;
    };
    (globalThis as any).setTimeout = ((fn: () => void, ms: number) => {
      timeouts.push({ fn, ms });
      return timeouts.length;
    }) as any;
    // The module-level toast container is cached across tests; reset its
    // state so each case starts with an empty, unattached stack.
    const mod = await freshModule() as any;
    if (typeof mod._resetForTest === 'function') mod._resetForTest();
  });

  it('attaches the container to document.body on first call', async () => {
    const { showToast } = await freshModule();
    expect(doc.body.children.length).toBe(0);
    showToast('hello');
    expect(doc.body.children.length).toBe(1);
    expect((doc.body.children[0] as any).className).toBe('tw-toast-stack');
  });

  it('appends a toast child with the info variant by default', async () => {
    const { showToast } = await freshModule();
    showToast('hi');
    const stack = doc.body.children[0]!;
    expect(stack.children.length).toBe(1);
    const toast = stack.children[0]! as any;
    expect(toast.className).toBe('tw-toast tw-toast-info');
    expect(toast.textContent).toBe('hi');
  });

  it('honours the error variant', async () => {
    const { showToast } = await freshModule();
    showToast('boom', { variant: 'error' });
    const toast = doc.body.children[0]!.children[0]! as any;
    expect(toast.className).toBe('tw-toast tw-toast-error');
  });

  it('stacks multiple toasts without re-attaching the container', async () => {
    const { showToast } = await freshModule();
    showToast('one');
    showToast('two');
    showToast('three');
    expect(doc.body.children.length).toBe(1); // single stack
    expect(doc.body.children[0]!.children.length).toBe(3);
  });

  it('queues a requestAnimationFrame to add the .visible class', async () => {
    const { showToast } = await freshModule();
    showToast('x');
    const toast = doc.body.children[0]!.children[0]!;
    expect(toast.classList.has('visible')).toBe(false);
    expect(rafQueued.length).toBe(1);
    rafQueued[0]!();
    expect(toast.classList.has('visible')).toBe(true);
  });

  it('schedules a default 3500 ms dismissal', async () => {
    const { showToast } = await freshModule();
    showToast('x');
    expect(timeouts.some(t => t.ms === 3500)).toBe(true);
  });

  it('honours custom durationMs', async () => {
    const { showToast } = await freshModule();
    showToast('x', { durationMs: 9999 });
    expect(timeouts.some(t => t.ms === 9999)).toBe(true);
  });

  it('click on the toast removes it after the animation window', async () => {
    const { showToast } = await freshModule();
    showToast('x');
    const toast = doc.body.children[0]!.children[0]!;
    rafQueued[0]!();
    expect(toast.classList.has('visible')).toBe(true);
    toast.click();
    expect(toast.classList.has('visible')).toBe(false);
    // The 160 ms remove() timeout is the second scheduled one after click.
    const removeTimer = timeouts.find(t => t.ms === 160)!;
    expect(removeTimer).toBeDefined();
    removeTimer.fn();
    expect(doc.body.children[0]!.children.length).toBe(0);
  });

  it('auto-dismiss timer removes the toast after durationMs + 160 ms', async () => {
    const { showToast } = await freshModule();
    showToast('x', { durationMs: 1000 });
    const toast = doc.body.children[0]!.children[0]!;
    const dismissTimer = timeouts.find(t => t.ms === 1000)!;
    dismissTimer.fn();
    expect(toast.classList.has('visible')).toBe(false);
    const removeTimer = timeouts.find(t => t.ms === 160)!;
    removeTimer.fn();
    expect(doc.body.children[0]!.children.length).toBe(0);
  });
});
