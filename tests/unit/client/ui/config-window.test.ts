import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import fs from 'fs';
import { setupDocument, stubFetch, type StubDoc, type StubElement } from '../_dom.js';
import { _resetSessionStore } from '../../../../src/client/session-settings.ts';

const origDocument = (globalThis as any).document;
const origWindow = (globalThis as any).window;
const origEvent = (globalThis as any).Event;
const origFetch = (globalThis as any).fetch;

afterAll(() => {
  (globalThis as any).document = origDocument;
  (globalThis as any).window = origWindow;
  (globalThis as any).Event = origEvent;
  (globalThis as any).fetch = origFetch;
});

function ext(e: StubElement): any {
  const any = e as any;
  if (!('dataset' in any)) any.dataset = {};
  if (!('hidden' in any)) any.hidden = false;
  if (!('value' in any)) any.value = '';
  if (!('checked' in any)) any.checked = false;
  if (!('type' in any)) any.type = '';
  if (!('name' in any)) any.name = '';
  if (!('disabled' in any)) any.disabled = false;
  if (!any.style.setProperty) any.style.setProperty = (k: string, v: string) => { any.style[k] = v; };
  if (!any.dispatchEvent) any.dispatchEvent = (ev: any) => any.dispatch(ev.type, ev);
  if (!any.replaceChildren) any.replaceChildren = (...kids: any[]) => {
    any.children.length = 0;
    for (const k of kids) any.appendChild(k);
  };
  const origAppend = any.appendChild;
  any.appendChild = (child: StubElement) => {
    ext(child);
    return origAppend.call(any, child);
  };
  any.click = () => any.dispatch('click', { target: any, preventDefault() {}, stopPropagation() {} });
  any.querySelector = (selector: string) => queryOne(any, selector);
  any.querySelectorAll = (selector: string) => queryAll(any, selector);
  return any;
}

function walk(root: any, visit: (node: any) => void): void {
  visit(root);
  for (const child of root.children ?? []) walk(child, visit);
}

function makeDoc(): StubDoc {
  const doc = setupDocument();
  ext(doc.body);
  const origCreate = doc.createElement;
  doc.createElement = (tag: string) => ext(origCreate.call(doc, tag));
  (doc as any).querySelector = (selector: string) => queryOne(doc.body, selector);
  (doc as any).querySelectorAll = (selector: string) => queryAll(doc.body, selector);
  (globalThis as any).Event = class { type: string; constructor(type: string) { this.type = type; } };
  (globalThis as any).window = {
    innerWidth: 1200,
    innerHeight: 900,
    __TMUX_WEB_CONFIG: { version: 'test', localUsername: 'per' },
  };
  return doc;
}

function classTokens(node: any): string[] {
  return String(node.className ?? '').split(/\s+/).filter(Boolean);
}

function queryAll(root: any, selector: string): any[] {
  const out: any[] = [];
  walk(root, (node) => {
    if (selector.startsWith('.')) {
      const token = selector.slice(1);
      if (classTokens(node).includes(token)) out.push(node);
    } else if (selector.startsWith('#')) {
      if (node.id === selector.slice(1)) out.push(node);
    } else if (node.tagName?.toLowerCase?.() === selector.toLowerCase()) {
      out.push(node);
    }
  });
  return out;
}

function queryOne(root: any, selector: string): any | null {
  return queryAll(root, selector)[0] ?? null;
}

function textOf(root: any): string {
  let text = root.textContent ?? '';
  for (const child of root.children ?? []) text += textOf(child);
  return text;
}

function inputByName(root: any, name: string): any {
  let found: any = null;
  walk(root, (node) => {
    if (!found && node.name === name) found = node;
  });
  if (!found) throw new Error(`missing input ${name}`);
  return found;
}

function maybeInputByName(root: any, name: string): any | null {
  let found: any = null;
  walk(root, (node) => {
    if (!found && node.name === name) found = node;
  });
  return found;
}

function fieldLabels(root: any): string[] {
  return queryAll(root, '.tw-config-field').map((field: any) => field.children[0]?.textContent);
}

function formRows(root: any): string[] {
  return queryAll(root, '.tw-config-form-row').map((row: any) => textOf(row));
}

function buttons(root: any): any[] {
  return queryAll(root, 'button');
}

beforeEach(() => {
  _resetSessionStore({
    sessions: {},
    knownServers: [],
    servers: [{
      id: 'b',
      name: 'Beta',
      host: 'beta.example.com',
      port: 22,
      protocol: 'ssh',
      username: 'per',
      savePassword: false,
      compression: true,
    }, {
      id: 'a',
      name: 'Alpha',
      host: 'alpha.example.com',
      port: 443,
      protocol: 'https',
      username: 'root',
      password: 'saved',
      savePassword: true,
      compression: false,
    }],
  });
  stubFetch(async () => ({ ok: true, json: async () => ({}) }) as any);
});

describe('configuration window', () => {
  it('opens as a centered 90 percent overlay with the requested categories', async () => {
    const doc = makeDoc();
    const trigger = ext(doc.createElement('button'));
    doc.body.appendChild(trigger);
    const { installConfigurationWindow } = await import('../../../../src/client/ui/config-window.ts');
    installConfigurationWindow(trigger as any);

    trigger.click();

    const dialog = queryOne(doc.body, '.tw-config-window');
    expect(dialog).not.toBeNull();
    expect(dialog.hidden).toBe(false);
    expect(dialog.attrs.role).toBe('dialog');
    expect(textOf(dialog)).toContain('General');
    expect(textOf(dialog)).toContain('Servers');
    expect(textOf(dialog)).toContain('Sessions');
  });

  it('shows a selectable server list beside the editor and persists added and removed servers', async () => {
    const doc = makeDoc();
    const calls = stubFetch(async () => ({ ok: true, json: async () => ({}) }) as any).calls;
    const trigger = ext(doc.createElement('button'));
    doc.body.appendChild(trigger);
    const { installConfigurationWindow } = await import('../../../../src/client/ui/config-window.ts');
    installConfigurationWindow(trigger as any);
    trigger.click();

    const dialog = queryOne(doc.body, '.tw-config-window');
    expect(textOf(dialog)).toContain('Beta');
    expect(textOf(dialog)).toContain('Alpha');

    const alphaRow = queryAll(dialog, '.tw-config-server-row').find((row: any) => textOf(row).includes('Alpha'))!;
    alphaRow.click();
    expect(inputByName(dialog, 'name').value).toBe('Alpha');
    expect(inputByName(dialog, 'host').value).toBe('alpha.example.com');

    const newServerRow = queryAll(dialog, '.tw-config-server-row').find((row: any) => textOf(row).includes('New Server'))!;
    expect(newServerRow.getAttribute('draggable')).toBeNull();
    newServerRow.click();
    inputByName(dialog, 'name').value = 'Gamma';
    inputByName(dialog, 'host').value = 'gamma.example.com';
    inputByName(dialog, 'port').value = '4022';
    inputByName(dialog, 'protocol').value = 'http';
    inputByName(dialog, 'username').value = 'per';
    inputByName(dialog, 'password').value = 'temporary';
    inputByName(dialog, 'savePassword').checked = false;
    inputByName(dialog, 'compression').checked = true;
    buttons(dialog).find((b: any) => b.textContent === 'Save server')!.click();

    expect(JSON.parse(calls.at(-1)!.init!.body as string).servers.at(-1)).toEqual({
      id: 'gamma.example.com',
      name: 'Gamma',
      host: 'gamma.example.com',
      port: 4022,
      protocol: 'http',
      username: 'per',
      savePassword: false,
      compression: true,
    });

    const gammaRow = queryAll(dialog, '.tw-config-server-row').find((row: any) => textOf(row).includes('Gamma'))!;
    gammaRow.click();
    buttons(dialog).find((b: any) => b.textContent === 'Remove server')!.click();

    const latest = JSON.parse(calls.at(-1)!.init!.body as string);
    expect(latest.servers.some((s: any) => s.host === 'gamma.example.com')).toBe(false);
  });

  it('keeps New Server as the non-sortable last list item and selects the saved server', async () => {
    const doc = makeDoc();
    const trigger = ext(doc.createElement('button'));
    doc.body.appendChild(trigger);
    const { installConfigurationWindow } = await import('../../../../src/client/ui/config-window.ts');
    installConfigurationWindow(trigger as any);
    trigger.click();

    const dialog = queryOne(doc.body, '.tw-config-window');
    let rows = queryAll(dialog, '.tw-config-server-row');
    expect(textOf(rows.at(-1))).toBe('New Server');
    expect(rows.at(-1).getAttribute('draggable')).toBeNull();

    rows.at(-1).click();
    inputByName(dialog, 'name').value = 'Gamma';
    inputByName(dialog, 'host').value = 'gamma.example.com';
    buttons(dialog).find((b: any) => b.textContent === 'Save server')!.click();

    rows = queryAll(dialog, '.tw-config-server-row');
    expect(rows.map((row: any) => textOf(row))).toEqual([
      'Locallocal://per',
      'Betassh://per@beta.example.com',
      'Alphahttps://root@alpha.example.com',
      'Gammassh://gamma.example.com',
      'New Server',
    ]);
    expect(classTokens(rows[3])).toContain('selected');
    expect(classTokens(rows.at(-1))).toContain('tw-config-server-new');
  });

  it('rejects empty and duplicate server names', async () => {
    const doc = makeDoc();
    const calls = stubFetch(async () => ({ ok: true, json: async () => ({}) }) as any).calls;
    const trigger = ext(doc.createElement('button'));
    doc.body.appendChild(trigger);
    const { installConfigurationWindow } = await import('../../../../src/client/ui/config-window.ts');
    installConfigurationWindow(trigger as any);
    trigger.click();

    const dialog = queryOne(doc.body, '.tw-config-window');
    queryAll(dialog, '.tw-config-server-row').find((row: any) => textOf(row).includes('New Server'))!.click();
    inputByName(dialog, 'name').value = '';
    inputByName(dialog, 'host').value = 'gamma.example.com';
    buttons(dialog).find((b: any) => b.textContent === 'Save server')!.click();
    expect(calls.filter(c => c.init?.method === 'PUT')).toHaveLength(0);
    expect(textOf(dialog)).toContain('Server name is required.');

    inputByName(dialog, 'name').value = 'Alpha';
    buttons(dialog).find((b: any) => b.textContent === 'Save server')!.click();
    expect(calls.filter(c => c.init?.method === 'PUT')).toHaveLength(0);
    expect(textOf(dialog)).toContain('Server name must be unique.');
  });

  it('lays out server fields in grouped rows and updates port to the selected protocol default', async () => {
    const doc = makeDoc();
    const trigger = ext(doc.createElement('button'));
    doc.body.appendChild(trigger);
    const { installConfigurationWindow } = await import('../../../../src/client/ui/config-window.ts');
    installConfigurationWindow(trigger as any);
    trigger.click();

    const dialog = queryOne(doc.body, '.tw-config-window');
    queryAll(dialog, '.tw-config-server-row').find((row: any) => textOf(row).includes('New Server'))!.click();
    expect(fieldLabels(dialog).slice(0, 5)).toEqual([
      'Name:',
      'Protocol:',
      'Port:',
      'Hostname:',
      'Username:',
    ]);
    const rows = formRows(dialog).slice(0, 4);
    expect(rows[0]).toBe('Name:');
    expect(rows[1].startsWith('Protocol:')).toBe(true);
    expect(rows[1]).toContain('Port:');
    expect(rows[1]).toContain('Hostname:');
    expect(rows.slice(2)).toEqual([
      'Username:Password:Save password',
      'Options:Compression',
    ]);
    expect(inputByName(dialog, 'port').value).toBe('22');
    expect(inputByName(dialog, 'password').placeholder).toBe('(prompt)');

    inputByName(dialog, 'protocol').value = 'http';
    inputByName(dialog, 'protocol').dispatch('change', { target: inputByName(dialog, 'protocol') });
    expect(inputByName(dialog, 'port').value).toBe('80');

    inputByName(dialog, 'protocol').value = 'https';
    inputByName(dialog, 'protocol').dispatch('change', { target: inputByName(dialog, 'protocol') });
    expect(inputByName(dialog, 'port').value).toBe('443');
  });

  it('shows Local as a server with local-only options', async () => {
    const doc = makeDoc();
    const calls = stubFetch(async () => ({ ok: true, json: async () => ({}) }) as any).calls;
    const trigger = ext(doc.createElement('button'));
    doc.body.appendChild(trigger);
    const { installConfigurationWindow } = await import('../../../../src/client/ui/config-window.ts');
    installConfigurationWindow(trigger as any);
    trigger.click();

    const dialog = queryOne(doc.body, '.tw-config-window');
    const localRow = queryAll(dialog, '.tw-config-server-row').find((row: any) => textOf(row).includes('Local'))!;
    expect(textOf(localRow)).toContain('local://per');
    localRow.click();

    expect(inputByName(dialog, 'protocol').value).toBe('local');
    expect(inputByName(dialog, 'username').value).toBe('per');
    expect(inputByName(dialog, 'socketName').placeholder).toBe('(default)');
    expect(inputByName(dialog, 'socketPath').placeholder).toBe('(default)');
    expect(formRows(dialog).find((row: string) => row.includes('Socket name'))).toBe('Socket name:Socket path:');
    expect(maybeInputByName(dialog, 'port')).toBeNull();
    expect(maybeInputByName(dialog, 'host')).toBeNull();
    expect(maybeInputByName(dialog, 'password')).toBeNull();
    expect(maybeInputByName(dialog, 'savePassword')).toBeNull();
    expect(maybeInputByName(dialog, 'compression')).toBeNull();

    inputByName(dialog, 'socketName').value = 'work';
    inputByName(dialog, 'socketPath').value = '/tmp/tmux-web.sock';
    buttons(dialog).find((b: any) => b.textContent === 'Save server')!.click();
    const savedLocal = JSON.parse(calls.at(-1)!.init!.body as string)
      .servers.find((server: any) => server.protocol === 'local');
    expect(savedLocal).toEqual({
      id: 'local',
      name: 'Local',
      host: 'local',
      port: 0,
      protocol: 'local',
      username: 'per',
      savePassword: false,
      compression: false,
      socketName: 'work',
      socketPath: '/tmp/tmux-web.sock',
    });
  });

  it('persists server order changed by dragging list rows', async () => {
    const doc = makeDoc();
    const calls = stubFetch(async () => ({ ok: true, json: async () => ({}) }) as any).calls;
    const trigger = ext(doc.createElement('button'));
    doc.body.appendChild(trigger);
    const { installConfigurationWindow } = await import('../../../../src/client/ui/config-window.ts');
    installConfigurationWindow(trigger as any);
    trigger.click();

    const dialog = queryOne(doc.body, '.tw-config-window');
    const rows = queryAll(dialog, '.tw-config-server-row');
    const dataTransfer = {
      value: '',
      setData(_type: string, value: string) { this.value = value; },
      getData() { return this.value; },
      effectAllowed: '',
      dropEffect: '',
    };
    const remoteRows = rows.filter((row: any) => !textOf(row).includes('Local') && !textOf(row).includes('New Server'));
    remoteRows[0].dispatch('dragstart', { dataTransfer, preventDefault() {}, stopPropagation() {} });
    remoteRows[1].dispatch('drop', { dataTransfer, preventDefault() {}, stopPropagation() {} });

    const latest = JSON.parse(calls.at(-1)!.init!.body as string);
    expect(latest.servers.map((s: any) => s.name)).toEqual(['Alpha', 'Beta']);
  });

  it('formats server list URLs with username and omits default ports', async () => {
    _resetSessionStore({
      sessions: {},
      knownServers: [],
      servers: [{
        id: 'ssh-default',
        name: 'SSH Default',
        host: 'ssh.example.com',
        port: 22,
        protocol: 'ssh',
        username: 'per',
        savePassword: false,
        compression: false,
      }, {
        id: 'http-default',
        name: 'HTTP Default',
        host: 'web.example.com',
        port: 80,
        protocol: 'http',
        username: 'alice',
        savePassword: false,
        compression: false,
      }, {
        id: 'https-default',
        name: 'HTTPS Default',
        host: 'secure.example.com',
        port: 443,
        protocol: 'https',
        username: 'root',
        savePassword: false,
        compression: false,
      }, {
        id: 'ssh-custom',
        name: 'SSH Custom',
        host: 'custom.example.com',
        port: 2200,
        protocol: 'ssh',
        username: 'deploy',
        savePassword: false,
        compression: true,
      }],
    });
    const doc = makeDoc();
    const trigger = ext(doc.createElement('button'));
    doc.body.appendChild(trigger);
    const { installConfigurationWindow } = await import('../../../../src/client/ui/config-window.ts');
    installConfigurationWindow(trigger as any);
    trigger.click();

    const urls = queryAll(doc.body, '.tw-config-server-host').map((node: any) => node.textContent);
    expect(urls).toEqual([
      'local://per',
      'ssh://per@ssh.example.com',
      'http://alice@web.example.com',
      'https://root@secure.example.com',
      'ssh://deploy@custom.example.com:2200',
    ]);
  });

  it('places the server list to the left of the server editor', () => {
    const css = fs.readFileSync('src/client/base.css', 'utf-8');
    const match = /\.tw-config-pane-servers\s*\{(?<body>[^}]+)\}/.exec(css);
    expect(match?.groups?.body).toContain('display: grid');
    expect(match?.groups?.body).toContain('grid-template-columns');
  });

  it('uses an eight-section aligned grid for server connection and credential rows', () => {
    const css = fs.readFileSync('src/client/base.css', 'utf-8');
    expect(css).toContain('grid-template-columns: repeat(8, minmax(0, 1fr));');
    expect(css).toContain('.tw-config-field-protocol > span { grid-column: 1; }');
    expect(css).toContain('.tw-config-field-protocol > select { grid-column: 2; }');
    expect(css).toContain('.tw-config-field-port > span { grid-column: 3; }');
    expect(css).toContain('.tw-config-field-port > input { grid-column: 4; }');
    expect(css).toContain('.tw-config-field-host > span { grid-column: 5; }');
    expect(css).toContain('.tw-config-field-host > input { grid-column: 6 / 9; }');
    expect(css).toContain('.tw-config-field-username > input { grid-column: 2 / 4; }');
    expect(css).toContain('.tw-config-field-password > span { grid-column: 4; }');
    expect(css).toContain('.tw-config-field-password > input { grid-column: 5 / 7; }');
    expect(css).toContain('.tw-config-save-password { grid-column: 7 / 9; }');
    expect(css).toContain('.tw-config-form-row-local-options {\n  grid-template-columns: repeat(8, minmax(0, 1fr));');
    expect(css).toContain('.tw-config-field-socket-name > span { grid-column: 1; }');
    expect(css).toContain('.tw-config-field-socket-name > input { grid-column: 2 / 4; }');
    expect(css).toContain('.tw-config-field-socket-path > span { grid-column: 4; }');
    expect(css).toContain('.tw-config-field-socket-path > input { grid-column: 5 / 9; }');
    expect(css).toContain('.tw-config-field > span,\n.tw-config-row-label {\n  text-align: right;');
    expect(css).toContain('.tw-menu-input-select::placeholder');
    expect(css).toContain('font-style: italic;');
  });
});
