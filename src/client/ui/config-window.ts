import {
  getRemoteServers,
  saveRemoteServers,
  type RemoteServerConfig,
  type RemoteServerProtocol,
} from '../session-settings.js';

type ConfigCategory = 'general' | 'servers' | 'sessions';
type ServerSortKey = 'name' | 'host' | 'protocol' | 'port';

interface ConfigWindowState {
  active: ConfigCategory;
  sortKey: ServerSortKey | null;
  sortDir: 1 | -1;
  editingId: string | null;
}

function validProtocol(value: string): RemoteServerProtocol {
  return value === 'http' || value === 'https' || value === 'ssh' ? value : 'ssh';
}

function defaultPort(protocol: RemoteServerProtocol): number {
  if (protocol === 'ssh') return 22;
  if (protocol === 'https') return 443;
  return 80;
}

function makeServerId(host: string, existing: RemoteServerConfig[], editingId: string | null): string {
  const base = host.trim() || 'server';
  let id = editingId ?? base;
  let n = 2;
  const taken = new Set(existing.filter(s => s.id !== editingId).map(s => s.id));
  while (taken.has(id)) {
    id = `${base}-${n++}`;
  }
  return id;
}

function sortedServers(servers: RemoteServerConfig[], key: ServerSortKey | null, dir: 1 | -1): RemoteServerConfig[] {
  const out = servers.slice();
  if (!key) return out;
  out.sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });
  return out;
}

function button(label: string, className?: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className ?? 'tb-btn';
  btn.textContent = label;
  return btn;
}

function labelledInput(labelText: string, input: HTMLInputElement | HTMLSelectElement): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = 'tw-config-field';
  const span = document.createElement('span');
  span.textContent = labelText;
  label.appendChild(span);
  label.appendChild(input);
  return label;
}

function textInput(name: string, value = '', type = 'text'): HTMLInputElement {
  const input = document.createElement('input');
  input.type = type;
  input.name = name;
  input.value = value;
  input.className = 'tw-menu-input-select';
  return input;
}

function checkboxInput(name: string, checked: boolean): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.name = name;
  input.checked = checked;
  return input;
}

function protocolSelect(value: RemoteServerProtocol): HTMLSelectElement {
  const select = document.createElement('select');
  select.name = 'protocol';
  select.className = 'tw-menu-input-select';
  for (const protocol of ['http', 'https', 'ssh'] as const) {
    const opt = document.createElement('option');
    opt.value = protocol;
    opt.textContent = protocol;
    select.appendChild(opt);
  }
  select.value = value;
  return select;
}

function formValue(form: HTMLFormElement, name: string): HTMLInputElement | HTMLSelectElement {
  let input: HTMLInputElement | HTMLSelectElement | null = null;
  const visit = (node: Element): void => {
    if (input) return;
    const maybe = node as HTMLInputElement | HTMLSelectElement;
    if (maybe.name === name) {
      input = maybe;
      return;
    }
    for (const child of Array.from(node.children)) visit(child);
  };
  visit(form);
  if (!input) throw new Error(`tmux-web: missing config field ${name}`);
  return input;
}

function renderServersPane(main: HTMLElement, state: ConfigWindowState): void {
  const servers = getRemoteServers();
  const selected = servers.find(s => s.id === state.editingId) ?? null;
  const pane = document.createElement('div');
  pane.className = 'tw-config-pane tw-config-pane-servers';

  const list = document.createElement('div');
  list.className = 'tw-config-server-list';

  const header = document.createElement('div');
  header.className = 'tw-config-server-header';
  for (const [key, label] of [
    ['name', 'Name'],
    ['host', 'Host'],
    ['protocol', 'Protocol'],
    ['port', 'Port'],
  ] as Array<[ServerSortKey, string]>) {
    const sortBtn = button(label, 'tw-config-server-sort');
    sortBtn.addEventListener('click', () => {
      if (state.sortKey === key) state.sortDir = state.sortDir === 1 ? -1 : 1;
      else {
        state.sortKey = key;
        state.sortDir = 1;
      }
      renderServersPane(main, state);
    });
    header.appendChild(sortBtn);
  }
  const actionHead = document.createElement('span');
  actionHead.textContent = '';
  header.appendChild(actionHead);
  list.appendChild(header);

  for (const server of sortedServers(servers, state.sortKey, state.sortDir)) {
    const row = document.createElement('div');
    row.className = 'tw-config-server-row' + (server.id === state.editingId ? ' selected' : '');
    row.appendChild(Object.assign(document.createElement('span'), { textContent: server.name }));
    row.appendChild(Object.assign(document.createElement('span'), { textContent: server.host }));
    row.appendChild(Object.assign(document.createElement('span'), { textContent: server.protocol }));
    row.appendChild(Object.assign(document.createElement('span'), { textContent: String(server.port) }));

    const actions = document.createElement('div');
    actions.className = 'tw-config-server-actions';
    const editBtn = button('Edit');
    editBtn.addEventListener('click', () => {
      state.editingId = server.id;
      renderServersPane(main, state);
    });
    const removeBtn = button('Remove');
    removeBtn.addEventListener('click', () => {
      saveRemoteServers(getRemoteServers().filter(s => s.id !== server.id));
      if (state.editingId === server.id) state.editingId = null;
      renderServersPane(main, state);
    });
    actions.appendChild(editBtn);
    actions.appendChild(removeBtn);
    row.appendChild(actions);
    list.appendChild(row);
  }
  pane.appendChild(list);

  const form = document.createElement('form');
  form.className = 'tw-config-server-form';
  const protocol = selected?.protocol ?? 'ssh';
  form.appendChild(labelledInput('Name', textInput('name', selected?.name ?? '')));
  form.appendChild(labelledInput('Hostname / IP', textInput('host', selected?.host ?? '')));
  form.appendChild(labelledInput('Port', textInput('port', String(selected?.port ?? defaultPort(protocol)), 'number')));
  form.appendChild(labelledInput('Protocol', protocolSelect(protocol)));
  form.appendChild(labelledInput('Username', textInput('username', selected?.username ?? '')));
  form.appendChild(labelledInput('Password', textInput('password', selected?.password ?? '', 'password')));
  form.appendChild(labelledInput('Save Password', checkboxInput('savePassword', selected?.savePassword ?? false)));
  form.appendChild(labelledInput('Compression', checkboxInput('compression', selected?.compression ?? false)));

  const formActions = document.createElement('div');
  formActions.className = 'tw-config-form-actions';
  const addBtn = button('Add server');
  addBtn.addEventListener('click', () => {
    state.editingId = null;
    renderServersPane(main, state);
  });
  const saveBtn = button('Save server');
  saveBtn.addEventListener('click', () => {
    const nextServers = getRemoteServers();
    const protocolValue = validProtocol(formValue(form, 'protocol').value);
    const host = formValue(form, 'host').value.trim();
    if (!host) return;
    const savePassword = (formValue(form, 'savePassword') as HTMLInputElement).checked;
    const password = savePassword ? formValue(form, 'password').value : '';
    const next: RemoteServerConfig = {
      id: makeServerId(host, nextServers, state.editingId),
      name: formValue(form, 'name').value.trim() || host,
      host,
      port: Number.parseInt(formValue(form, 'port').value, 10) || defaultPort(protocolValue),
      protocol: protocolValue,
      username: formValue(form, 'username').value.trim(),
      savePassword,
      compression: (formValue(form, 'compression') as HTMLInputElement).checked,
    };
    if (password) next.password = password;
    const index = nextServers.findIndex(s => s.id === state.editingId);
    if (index >= 0) nextServers[index] = next;
    else nextServers.push(next);
    saveRemoteServers(nextServers);
    state.editingId = next.id;
    renderServersPane(main, state);
  });
  formActions.appendChild(addBtn);
  formActions.appendChild(saveBtn);
  form.appendChild(formActions);
  pane.appendChild(form);

  main.replaceChildren(pane);
}

function renderPlaceholder(main: HTMLElement, title: string): void {
  const pane = document.createElement('div');
  pane.className = 'tw-config-pane';
  const h = document.createElement('h2');
  h.textContent = title;
  pane.appendChild(h);
  main.replaceChildren(pane);
}

function renderWindow(nav: HTMLElement, main: HTMLElement, state: ConfigWindowState): void {
  nav.replaceChildren();
  for (const [key, label] of [
    ['general', 'General'],
    ['servers', 'Servers'],
    ['sessions', 'Sessions'],
  ] as Array<[ConfigCategory, string]>) {
    const item = button(label, 'tw-config-nav-item' + (state.active === key ? ' selected' : ''));
    item.addEventListener('click', () => {
      state.active = key;
      renderWindow(nav, main, state);
    });
    nav.appendChild(item);
  }
  if (state.active === 'servers') renderServersPane(main, state);
  else renderPlaceholder(main, state.active === 'general' ? 'General' : 'Sessions');
}

export function installConfigurationWindow(trigger: HTMLElement): void {
  const state: ConfigWindowState = { active: 'servers', sortKey: null, sortDir: 1, editingId: null };
  const overlay = document.createElement('div');
  overlay.className = 'tw-config-overlay';
  overlay.hidden = true;

  const dialog = document.createElement('div');
  dialog.className = 'tw-config-window';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');

  const closeBtn = button('Close', 'tw-config-close');
  closeBtn.addEventListener('click', () => { overlay.hidden = true; });
  dialog.appendChild(closeBtn);

  const nav = document.createElement('nav');
  nav.className = 'tw-config-nav';
  dialog.appendChild(nav);

  const main = document.createElement('div');
  main.className = 'tw-config-main';
  dialog.appendChild(main);

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  renderWindow(nav, main, state);

  trigger.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    overlay.hidden = false;
    renderWindow(nav, main, state);
  });
}
