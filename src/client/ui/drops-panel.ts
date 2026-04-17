import { formatBytes, showToast } from './toast.js';

/** Wire up the "Dropped files" row in the settings menu. Refreshes the
 *  list on demand (opens the settings dropdown / refresh button / after
 *  a successful upload), supports per-row revoke and bulk purge. */

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

export function installDropsPanel(opts: DropsPanelOpts): { refresh: () => Promise<void> } {
  const list = document.getElementById('drops-list') as HTMLElement | null;
  const count = document.getElementById('drops-count') as HTMLElement | null;
  const refreshBtn = document.getElementById('btn-drops-refresh') as HTMLButtonElement | null;
  const purgeBtn = document.getElementById('btn-drops-purge') as HTMLButtonElement | null;
  if (!list || !count || !refreshBtn || !purgeBtn) {
    return { refresh: async () => {} };
  }

  const render = (drops: DropInfo[]) => {
    count.textContent = String(drops.length);
    list.innerHTML = '';
    if (drops.length === 0) {
      const empty = document.createElement('div');
      empty.style.color = '#777';
      empty.style.fontStyle = 'italic';
      empty.style.padding = '4px 0';
      empty.textContent = 'No files. Drag one onto the terminal.';
      list.appendChild(empty);
      return;
    }
    for (const d of drops) {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '6px';
      row.style.padding = '2px 0';

      const label = document.createElement('span');
      label.style.flex = '1';
      label.style.overflow = 'hidden';
      label.style.textOverflow = 'ellipsis';
      label.style.whiteSpace = 'nowrap';
      label.title = `${d.absolutePath}\n${formatBytes(d.size)} · ${d.mtime}`;
      label.textContent = d.filename;
      row.appendChild(label);

      const meta = document.createElement('span');
      meta.style.color = '#777';
      meta.style.fontSize = '10px';
      meta.textContent = formatBytes(d.size);
      row.appendChild(meta);

      const revoke = document.createElement('button');
      revoke.className = 'tb-btn';
      revoke.textContent = '✕';
      revoke.title = `Remove ${d.filename} from disk`;
      revoke.style.padding = '0 6px';
      revoke.addEventListener('click', async () => {
        revoke.disabled = true;
        try {
          const res = await fetch(
            `/api/drops?session=${encodeURIComponent(opts.getSession())}&id=${encodeURIComponent(d.dropId)}`,
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
      list.appendChild(row);
    }
  };

  const refresh = async (): Promise<void> => {
    try {
      const res = await fetch(`/api/drops?session=${encodeURIComponent(opts.getSession())}`);
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
      const res = await fetch(
        `/api/drops?session=${encodeURIComponent(opts.getSession())}`,
        { method: 'DELETE' },
      );
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

  // Initial render — empty on cold start, populated on first open.
  render([]);

  return { refresh };
}
