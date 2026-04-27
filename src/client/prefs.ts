const SHOW_WINDOW_TABS_KEY = 'tmux-web-show-window-tabs';

/** Default: true (classic one-button-per-window tab strip). */
export function getShowWindowTabs(): boolean {
  try {
    const raw = localStorage.getItem(SHOW_WINDOW_TABS_KEY);
    if (raw === '0') return false;
    return true;
  } catch {
    return true;
  }
}

export function setShowWindowTabs(value: boolean): void {
  try {
    localStorage.setItem(SHOW_WINDOW_TABS_KEY, value ? '1' : '0');
  } catch {}
}
