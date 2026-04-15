const KEY = 'tmux-web-topbar-autohide';

export function getTopbarAutohide(): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === null ? true : raw === '1';
  } catch {
    return true;
  }
}

export function setTopbarAutohide(value: boolean): void {
  try {
    localStorage.setItem(KEY, value ? '1' : '0');
  } catch {}
}
