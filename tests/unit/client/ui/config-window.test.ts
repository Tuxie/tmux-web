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
  (globalThis as any).window = { innerWidth: 1200, innerHeight: 900 };
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

    buttons(dialog).find((b: any) => b.textContent === 'Add server')!.click();
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

  it('rejects empty and duplicate server names', async () => {
    const doc = makeDoc();
    const calls = stubFetch(async () => ({ ok: true, json: async () => ({}) }) as any).calls;
    const trigger = ext(doc.createElement('button'));
    doc.body.appendChild(trigger);
    const { installConfigurationWindow } = await import('../../../../src/client/ui/config-window.ts');
    installConfigurationWindow(trigger as any);
    trigger.click();

    const dialog = queryOne(doc.body, '.tw-config-window');
    buttons(dialog).find((b: any) => b.textContent === 'Add server')!.click();
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
    rows[0].dispatch('dragstart', { dataTransfer, preventDefault() {}, stopPropagation() {} });
    rows[1].dispatch('drop', { dataTransfer, preventDefault() {}, stopPropagation() {} });

    const latest = JSON.parse(calls.at(-1)!.init!.body as string);
    expect(latest.servers.map((s: any) => s.name)).toEqual(['Alpha', 'Beta']);
  });

  it('places the server list to the left of the server editor', () => {
    const css = fs.readFileSync('src/client/base.css', 'utf-8');
    const match = /\.tw-config-pane-servers\s*\{(?<body>[^}]+)\}/.exec(css);
    expect(match?.groups?.body).toContain('display: grid');
    expect(match?.groups?.body).toContain('grid-template-columns');
  });
});
