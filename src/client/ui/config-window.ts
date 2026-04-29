import {
  getRemoteServers,
  saveRemoteServers,
  type RemoteServerConfig,
  type RemoteServerProtocol,
} from '../session-settings.js';

type ConfigCategory = 'general' | 'servers' | 'sessions';

interface ConfigWindowState {
  active: ConfigCategory;
  editingId: string | null;
  error: string | null;
}

function validProtocol(value: string): RemoteServerProtocol {
  return value === 'http' || value === 'https' || value === 'ssh' || value === 'local' ? value : 'ssh';
}

function defaultPort(protocol: RemoteServerProtocol): number {
  if (protocol === 'local') return 0;
  if (protocol === 'ssh') return 22;
  if (protocol === 'https') return 443;
  return 80;
}

function serverListUrl(server: RemoteServerConfig): string {
  const username = server.username.trim();
  if (server.protocol === 'local') return `local://${username || localUsername()}`;
  const displayUsername = server.protocol === 'ssh' ? (username || localUsername()) : username;
  const auth = displayUsername ? `${encodeURIComponent(displayUsername)}@` : '';
  const port = server.port === defaultPort(server.protocol) ? '' : `:${server.port}`;
  return `${server.protocol}://${auth}${server.host}${port}`;
}

function localUsername(): string {
  return window.__TMUX_WEB_CONFIG?.localUsername ?? '';
}

function defaultLocalServer(): RemoteServerConfig {
  return {
    id: 'local',
    name: 'Local',
    host: 'local',
    port: 0,
    protocol: 'local',
    username: '',
    savePassword: false,
    compression: false,
  };
}

function visibleServers(): RemoteServerConfig[] {
  const saved = getRemoteServers();
  const local = saved.find(server => server.protocol === 'local') ?? defaultLocalServer();
  return [local, ...saved.filter(server => server.protocol !== 'local')];
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

function button(label: string, className?: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className ?? 'tw-button';
  btn.textContent = label;
  return btn;
}

function labelledInput(
  labelText: string,
  input: HTMLInputElement | HTMLSelectElement,
  className = '',
): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = `tw-config-field${className ? ` ${className}` : ''}`;
  const span = document.createElement('span');
  span.textContent = `${labelText}:`;
  label.appendChild(span);
  label.appendChild(input);
  return label;
}

function checkboxField(labelText: string, input: HTMLInputElement, className = ''): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = `tw-config-checkbox-field${className ? ` ${className}` : ''}`;
  label.appendChild(input);
  const span = document.createElement('span');
  span.textContent = labelText;
  label.appendChild(span);
  return label;
}

function formRow(className: string, ...children: HTMLElement[]): HTMLDivElement {
  const row = document.createElement('div');
  row.className = `tw-config-form-row ${className}`;
  for (const child of children) row.appendChild(child);
  return row;
}

function formRowLabel(text: string): HTMLSpanElement {
  const label = document.createElement('span');
  label.className = 'tw-config-row-label';
  label.textContent = `${text}:`;
  return label;
}

function insertBeforeChild(parent: HTMLElement, child: HTMLElement, before: HTMLElement): void {
  const anyParent = parent as HTMLElement & { children: HTMLCollection; insertBefore?: (child: HTMLElement, before: HTMLElement) => HTMLElement };
  if (typeof anyParent.insertBefore === 'function') {
    anyParent.insertBefore(child, before);
    return;
  }
  child.remove();
  const children = Array.from(anyParent.children);
  const index = children.indexOf(before);
  if (index < 0) {
    parent.appendChild(child);
    return;
  }
  (child as HTMLElement & { parentNode: HTMLElement }).parentNode = parent;
  (anyParent.children as unknown as HTMLElement[]).splice(index, 0, child);
}

function textInput(name: string, value = '', type = 'text', placeholder = ''): HTMLInputElement {
  const input = document.createElement('input');
  input.type = type;
  input.name = name;
  input.value = value;
  input.placeholder = placeholder;
  input.className = type === 'number' ? 'tw-input-number' : 'tw-input-text';
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
  select.className = 'tw-input-select';
  for (const protocol of ['local', 'ssh', 'http', 'https'] as const) {
    const opt = document.createElement('option');
    opt.value = protocol;
    opt.textContent = protocol === 'local' ? 'Local' : protocol;
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

function isDuplicateServerName(name: string, servers: RemoteServerConfig[], editingId: string | null): boolean {
  const key = name.trim().toLowerCase();
  return servers.some(server => server.id !== editingId && server.name.trim().toLowerCase() === key);
}

function moveServerAfter(servers: RemoteServerConfig[], draggedId: string, targetId: string): RemoteServerConfig[] {
  if (draggedId === targetId) return servers;
  const dragged = servers.find(server => server.id === draggedId);
  if (!dragged) return servers;
  const withoutDragged = servers.filter(server => server.id !== draggedId);
  const targetIndex = withoutDragged.findIndex(server => server.id === targetId);
  if (targetIndex < 0) return servers;
  const next = withoutDragged.slice();
  next.splice(targetIndex + 1, 0, dragged);
  return next;
}

function renderServersPane(main: HTMLElement, state: ConfigWindowState): void {
  const servers = visibleServers();
  const selected = servers.find(s => s.id === state.editingId) ?? null;
  const isLocal = selected?.protocol === 'local';
  const pane = document.createElement('div');
  pane.className = 'tw-config-pane tw-config-pane-servers';
  const title = document.createElement('h2');
  title.className = 'tw-config-pane-title';
  title.textContent = 'Servers';
  pane.appendChild(title);

  const sidebar = document.createElement('div');
  sidebar.className = 'tw-config-server-sidebar';

  const list = document.createElement('div');
  list.className = 'tw-config-server-list';

  const header = document.createElement('div');
  header.className = 'tw-config-server-header';
  header.textContent = 'Servers';
  list.appendChild(header);

  for (const server of servers) {
    const row = document.createElement('div');
    row.className = 'tw-config-server-row' + (server.id === state.editingId ? ' selected' : '');
    if (server.protocol !== 'local') {
      row.draggable = true;
      row.setAttribute('draggable', 'true');
    }
    const name = document.createElement('span');
    name.className = 'tw-config-server-name';
    name.textContent = server.name;
    const host = document.createElement('span');
    host.className = 'tw-config-server-host';
    host.textContent = serverListUrl(server);
    row.appendChild(name);
    row.appendChild(host);
    row.addEventListener('click', () => {
      state.editingId = server.id;
      state.error = null;
      renderServersPane(main, state);
    });
    row.addEventListener('dragstart', (ev) => {
      if (server.protocol === 'local') return;
      ev.dataTransfer?.setData('text/plain', server.id);
      if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragover', (ev) => {
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
    });
    row.addEventListener('drop', (ev) => {
      ev.preventDefault();
      const draggedId = ev.dataTransfer?.getData('text/plain') ?? '';
      const next = moveServerAfter(getRemoteServers(), draggedId, server.id);
      saveRemoteServers(next);
      state.editingId = draggedId || state.editingId;
      state.error = null;
      renderServersPane(main, state);
    });
    list.appendChild(row);
  }

  const newServerBtn = button('New server', 'tw-button tw-config-server-new-button' + (state.editingId === null ? ' selected' : ''));
  newServerBtn.addEventListener('click', () => {
    state.editingId = null;
    state.error = null;
    renderServersPane(main, state);
  });
  sidebar.appendChild(list);
  sidebar.appendChild(newServerBtn);
  pane.appendChild(sidebar);

  const form = document.createElement('form');
  form.className = 'tw-config-server-form';
  form.addEventListener('submit', ev => ev.preventDefault());
  const protocol = selected?.protocol ?? 'ssh';
  const protocolInput = protocolSelect(protocol);
  const portInput = textInput('port', String(selected?.port ?? defaultPort(protocol)), 'number');
  portInput.className += ' tw-config-port-input';
  const nameInput = textInput('name', selected?.name ?? '');
  const hostInput = textInput('host', selected?.host ?? '');
  const usernameInput = textInput('username', selected?.username ?? '', 'text', isLocal || protocol === 'ssh' ? '(current user)' : '');
  const passwordInput = textInput('password', selected?.password ?? '', 'password', '(prompt)');
  const savePasswordInput = checkboxInput('savePassword', selected?.savePassword ?? false);
  const compressionInput = checkboxInput('compression', selected?.compression ?? false);
  const tmuxCommandInput = textInput('tmuxCommand', selected?.tmuxCommand ?? 'tmux');
  const tmuxWebCommandInput = textInput('tmuxWebCommand', selected?.tmuxWebCommand ?? 'tmux-web');
  const socketNameInput = textInput('socketName', selected?.socketName ?? '', 'text', '(default)');
  const socketPathInput = textInput('socketPath', selected?.socketPath ?? '', 'text', '(default)');
  const sshCommandOptionsRow = formRow(
    'tw-config-form-row-command-options',
    labelledInput('tmux', tmuxCommandInput, 'tw-config-field-tmux-command'),
    labelledInput('tmux-web', tmuxWebCommandInput, 'tw-config-field-tmux-web-command'),
  );
  const sshSocketOptionsRow = formRow(
    'tw-config-form-row-local-options',
    labelledInput('Socket name', socketNameInput, 'tw-config-field-socket-name'),
    labelledInput('Socket path', socketPathInput, 'tw-config-field-socket-path'),
  );
  nameInput.required = true;
  form.appendChild(formRow(
    'tw-config-form-row-name',
    labelledInput('Name', nameInput, 'tw-config-field-name'),
  ));
  if (isLocal) {
    form.appendChild(formRow(
      'tw-config-form-row-connection',
      labelledInput('Protocol', protocolInput, 'tw-config-field-protocol'),
    ));
    form.appendChild(formRow(
      'tw-config-form-row-credentials',
      labelledInput('Username', usernameInput, 'tw-config-field-username'),
    ));
    form.appendChild(formRow(
      'tw-config-form-row-command-options',
      labelledInput('tmux', tmuxCommandInput, 'tw-config-field-tmux-command'),
    ));
    form.appendChild(formRow(
      'tw-config-form-row-local-options',
      labelledInput('Socket name', socketNameInput, 'tw-config-field-socket-name'),
      labelledInput('Socket path', socketPathInput, 'tw-config-field-socket-path'),
    ));
  } else {
    form.appendChild(formRow(
      'tw-config-form-row-connection',
      labelledInput('Protocol', protocolInput, 'tw-config-field-protocol'),
      portInput,
      labelledInput('Hostname', hostInput, 'tw-config-field-host'),
    ));
    form.appendChild(formRow(
      'tw-config-form-row-credentials',
      labelledInput('Username', usernameInput, 'tw-config-field-username'),
      labelledInput('Password', passwordInput, 'tw-config-field-password'),
      checkboxField('Save password', savePasswordInput, 'tw-config-save-password'),
    ));
    form.appendChild(formRow(
      'tw-config-form-row-options',
      formRowLabel('Options'),
      checkboxField('Compression', compressionInput),
    ));
    if (protocol === 'ssh') {
      form.appendChild(sshCommandOptionsRow);
      form.appendChild(sshSocketOptionsRow);
    }
  }
  const error = document.createElement('div');
  error.className = 'tw-config-form-error';
  error.setAttribute('role', 'alert');
  error.textContent = state.error ?? '';
  form.appendChild(error);
  protocolInput.addEventListener('change', () => {
    const nextProtocol = validProtocol(protocolInput.value);
    if (nextProtocol === 'local' || protocol === 'local') {
      state.editingId = nextProtocol === 'local' ? 'local' : null;
      state.error = null;
      renderServersPane(main, state);
      return;
    }
    portInput.value = String(defaultPort(nextProtocol));
    if (nextProtocol === 'ssh') {
      if (!sshCommandOptionsRow.parentNode) insertBeforeChild(form, sshCommandOptionsRow, error);
      if (!sshSocketOptionsRow.parentNode) insertBeforeChild(form, sshSocketOptionsRow, error);
    } else {
      sshCommandOptionsRow.remove();
      sshSocketOptionsRow.remove();
    }
    usernameInput.placeholder = nextProtocol === 'ssh' ? '(current user)' : '';
  });

  const formActions = document.createElement('div');
  formActions.className = 'tw-config-form-actions';
  const removeBtn = button('Remove server');
  removeBtn.disabled = !selected || isLocal;
  removeBtn.addEventListener('click', () => {
    if (!state.editingId) return;
    saveRemoteServers(getRemoteServers().filter(s => s.id !== state.editingId));
    state.editingId = null;
    state.error = null;
    renderServersPane(main, state);
  });
  const saveBtn = button('Save server');
  saveBtn.addEventListener('click', () => {
    const nextServers = getRemoteServers();
    const protocolValue = validProtocol(formValue(form, 'protocol').value);
    const host = protocolValue === 'local' ? 'local' : formValue(form, 'host').value.trim();
    const serverName = formValue(form, 'name').value.trim();
    if (!serverName) {
      state.error = 'Server name is required.';
      renderServersPane(main, state);
      return;
    }
    if (isDuplicateServerName(serverName, nextServers, state.editingId)) {
      state.error = 'Server name must be unique.';
      renderServersPane(main, state);
      return;
    }
    if (!host) {
      state.error = 'Hostname / IP is required.';
      renderServersPane(main, state);
      return;
    }
    const savePassword = protocolValue === 'local' ? false : (formValue(form, 'savePassword') as HTMLInputElement).checked;
    const password = protocolValue === 'local' ? '' : savePassword ? formValue(form, 'password').value : '';
    const next: RemoteServerConfig = {
      id: protocolValue === 'local' ? 'local' : makeServerId(host, nextServers, state.editingId),
      name: serverName,
      host,
      port: protocolValue === 'local' ? 0 : Number.parseInt(formValue(form, 'port').value, 10) || defaultPort(protocolValue),
      protocol: protocolValue,
      username: formValue(form, 'username').value.trim(),
      savePassword,
      compression: protocolValue === 'local' ? false : (formValue(form, 'compression') as HTMLInputElement).checked,
    };
    if (password) next.password = password;
    if (protocolValue === 'local' || protocolValue === 'ssh') {
      const tmuxCommand = formValue(form, 'tmuxCommand').value.trim();
      const socketName = formValue(form, 'socketName').value.trim();
      const socketPath = formValue(form, 'socketPath').value.trim();
      next.tmuxCommand = tmuxCommand || 'tmux';
      if (socketName) next.socketName = socketName;
      if (socketPath) next.socketPath = socketPath;
    }
    if (protocolValue === 'ssh') {
      const tmuxWebCommand = formValue(form, 'tmuxWebCommand').value.trim();
      next.tmuxWebCommand = tmuxWebCommand || 'tmux-web';
    }
    const index = nextServers.findIndex(s => s.id === state.editingId);
    if (index >= 0) nextServers[index] = next;
    else nextServers.push(next);
    saveRemoteServers(nextServers);
    state.editingId = next.id;
    state.error = null;
    renderServersPane(main, state);
  });
  formActions.appendChild(removeBtn);
  formActions.appendChild(saveBtn);
  form.appendChild(formActions);
  pane.appendChild(form);

  main.replaceChildren(pane);
}

function renderPlaceholder(main: HTMLElement, title: string): void {
  const pane = document.createElement('div');
  pane.className = 'tw-config-pane';
  const h = document.createElement('h2');
  h.className = 'tw-config-pane-title';
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
  dialog.className = 'tw-config-window tw-menu-surface';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');

  const closeBtn = button('Close', 'tw-config-close tw-button');
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
