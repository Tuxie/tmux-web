import { formatBytes, showToast } from './toast.js';

/** Wire up the "Dropped files" row in the settings menu. Keeps itself
 *  fresh by polling while the settings dropdown is visible, supports
 *  per-row revoke (✕), bulk purge, and row-click to re-paste a drop's
 *  path into the terminal (in case the original paste-on-drop was
 *  missed). */

export interface DropInfo {
  dropId: string;
  filename: string;
  absolutePath: string;
  size: number;
  mtime: string;
}

export interface DropsPanelOpts {
  getSession: () => string;
  /** Optional: called when something changed on the server side so the
   *  caller can refresh its own state. */
  onChange?: () => void;
}

export function installDropsPanel(opts: DropsPanelOpts): { refresh: () => Promise<void>; dispose: () => void } {
  const list = document.getElementById('drops-list') as HTMLElement | null;
  const count = document.getElementById('drops-count') as HTMLElement | null;
  const refreshBtn = document.getElementById('btn-drops-refresh') as HTMLButtonElement | null;
  const purgeBtn = document.getElementById('btn-drops-purge') as HTMLButtonElement | null;
  if (!list || !count || !refreshBtn || !purgeBtn) {
    return { refresh: async () => {}, dispose: () => {} };
  }

  const render = (drops: DropInfo[]) => {
    count.textContent = String(drops.length);
    list.innerHTML = '';
    if (drops.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'drops-empty';
      empty.textContent = 'No files. Drag one onto the terminal.';
      list.appendChild(empty);
      return;
    }
    for (const d of drops) {
      const row = document.createElement('div');
      row.className = 'drops-row';
      row.title = `Click to paste path into the terminal\n${d.absolutePath}\n${formatBytes(d.size)} · ${d.mtime}`;

      const label = document.createElement('span');
      label.className = 'drops-row-label';
      label.textContent = d.filename;
      row.appendChild(label);

      const meta = document.createElement('span');
      meta.className = 'drops-row-meta';
      meta.textContent = formatBytes(d.size);
      row.appendChild(meta);

      const revoke = document.createElement('button');
      revoke.className = 'tb-btn drops-revoke';
      // Nerd Font nf-cod-trash (U+EA81). Topaz8 NF ships this glyph.
      revoke.textContent = '\uEA81';
      revoke.title = `Remove ${d.filename} from disk`;
      revoke.addEventListener('click', async (ev) => {
        // Prevent the row-click re-paste handler from also firing when
        // the user meant to revoke.
        ev.stopPropagation();
        revoke.disabled = true;
        try {
          const res = await fetch(
            `/api/drops?id=${encodeURIComponent(d.dropId)}`,
            { method: 'DELETE' },
          );
          if (res.ok) {
            await refresh();
            opts.onChange?.();
          } else {
            showToast(`Revoke failed: ${d.filename}`, { variant: 'error' });
            revoke.disabled = false;
          }
        } catch (err) {
          showToast(`Revoke error: ${err}`, { variant: 'error' });
          revoke.disabled = false;
        }
      });
      row.appendChild(revoke);

      row.addEventListener('click', async () => {
        try {
          const res = await fetch(
            `/api/drops/paste?session=${encodeURIComponent(opts.getSession())}&id=${encodeURIComponent(d.dropId)}`,
            { method: 'POST' },
          );
          if (res.ok) {
            showToast(`Pasted ${d.filename}`);
          } else if (res.status === 404) {
            showToast(`${d.filename} is no longer on disk`, { variant: 'error' });
            await refresh();
          } else {
            showToast(`Paste failed: ${d.filename}`, { variant: 'error' });
          }
        } catch (err) {
          showToast(`Paste error: ${err}`, { variant: 'error' });
        }
      });

      list.appendChild(row);
    }
  };

  const refresh = async (): Promise<void> => {
    try {
      const res = await fetch(`/api/drops`);
      if (!res.ok) return;
      const body = await res.json() as { drops: DropInfo[] };
      render(body.drops);
    } catch {
      // Leave the previous render in place on transient errors.
    }
  };

  refreshBtn.addEventListener('click', (ev) => {
    ev.preventDefault();
    void refresh();
  });

  purgeBtn.addEventListener('click', async (ev) => {
    ev.preventDefault();
    purgeBtn.disabled = true;
    try {
      const res = await fetch(`/api/drops`, { method: 'DELETE' });
      if (res.ok) {
        const body = await res.json() as { purged: number };
        showToast(`Purged ${body.purged} drop${body.purged === 1 ? '' : 's'}`);
        await refresh();
        opts.onChange?.();
      } else {
        showToast('Purge failed', { variant: 'error' });
      }
    } catch {
      showToast('Purge error', { variant: 'error' });
    } finally {
      purgeBtn.disabled = false;
    }
  });

  // Refresh whenever the menu opens — the server-side push takes care of
  // in-session updates while the menu is already visible, but we still
  // want a fresh snapshot the first time each open. Watch #menu-dropdown's
  // hidden attribute rather than hooking the button so the behaviour
  // survives programmatic opens (e.g. reopen-after-reload).
  const menuDropdown = document.getElementById('menu-dropdown') as HTMLElement | null;
  let menuObserver: MutationObserver | null = null;
  if (menuDropdown) {
    const maybeRefresh = () => {
      if (!menuDropdown.hidden) void refresh();
    };
    menuObserver = new MutationObserver(maybeRefresh);
    menuObserver.observe(menuDropdown, {
      attributes: true,
      attributeFilter: ['hidden'],
    });
    maybeRefresh();
  }

  // Initial render — empty on cold start, populated on first open.
  render([]);

  return {
    refresh,
    dispose: () => { menuObserver?.disconnect(); },
  };
}
