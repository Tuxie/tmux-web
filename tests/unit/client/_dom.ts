// tests/unit/client/_dom.ts
export interface StubElement {
  tagName: string;
  children: StubElement[];
  classList: Set<string> & { add: (c: string) => void; remove: (c: string) => void; contains: (c: string) => boolean };
  listeners: Record<string, ((ev: any) => void)[]>;
  attrs: Record<string, string>;
  textContent: string;
  style: Record<string, string>;
  parentNode?: StubElement | null;
  appendChild(child: StubElement): StubElement;
  removeChild(child: StubElement): void;
  addEventListener(t: string, fn: (ev: any) => void, capture?: boolean): void;
  removeEventListener(t: string, fn: (ev: any) => void, capture?: boolean): void;
  dispatch(t: string, ev: any): void;
  setAttribute(k: string, v: string): void;
  getAttribute(k: string): string | null;
  removeAttribute(k: string): void;
  remove(): void;
  contains(node: any): boolean;
  querySelector(sel: string): StubElement | null;
  querySelectorAll(sel: string): StubElement[];
  click(): void;
  focus(): void;
}

export function el(tag = 'div'): StubElement {
  const listeners: Record<string, ((ev: any) => void)[]> = {};
  const classes = new Set<string>();
  const self: any = {
    tagName: tag.toUpperCase(),
    children: [],
    listeners,
    attrs: {},
    textContent: '',
    style: {},
    parentNode: null,
    appendChild(child: StubElement) { self.children.push(child); (child as any).parentNode = self; return child; },
    removeChild(child: StubElement) {
      const i = self.children.indexOf(child);
      if (i >= 0) self.children.splice(i, 1);
      (child as any).parentNode = null;
    },
    addEventListener(t: string, fn: (ev: any) => void) { (listeners[t] ??= []).push(fn); },
    removeEventListener(t: string, fn: (ev: any) => void) { listeners[t] = (listeners[t] || []).filter(f => f !== fn); },
    dispatch(t: string, ev: any) { (listeners[t] || []).slice().forEach(f => f(ev)); },
    setAttribute(k: string, v: string) { self.attrs[k] = v; },
    getAttribute(k: string) { return self.attrs[k] ?? null; },
    removeAttribute(k: string) { delete self.attrs[k]; },
    remove() { self.parentNode?.removeChild(self); },
    contains() { return true; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    click() { self.dispatch('click', { target: self, preventDefault() {}, stopPropagation() {} }); },
    focus() {},
  };
  const setAdd = Set.prototype.add.bind(classes);
  const setDelete = Set.prototype.delete.bind(classes);
  const setHas = Set.prototype.has.bind(classes);
  self.classList = Object.assign(classes, {
    add: (c: string) => { setAdd(c); },
    remove: (c: string) => { setDelete(c); },
    contains: (c: string) => setHas(c),
    toggle: (c: string) => (setHas(c) ? setDelete(c) : setAdd(c)),
  });
  return self as StubElement;
}

export interface StubDoc {
  body: StubElement;
  __byId: Record<string, StubElement>;
  createElement(t: string): StubElement;
  createTextNode(text: string): StubElement;
  getElementById(id: string): StubElement | null;
  addEventListener(t: string, fn: any, capture?: boolean): void;
  removeEventListener(t: string, fn: any, capture?: boolean): void;
  dispatch(t: string, ev: any): void;
  documentElement: StubElement;
  head: StubElement;
  fonts?: { add(): void };
}

export function setupDocument(): StubDoc {
  const listeners: Record<string, ((ev: any) => void)[]> = {};
  const byId: Record<string, StubElement> = {};
  const body = el('body');
  const head = el('head');
  const docEl = el('html');
  const doc: StubDoc = {
    body,
    __byId: byId,
    head,
    documentElement: docEl,
    fonts: { add() {} },
    createElement: (t: string) => el(t),
    createTextNode: (text: string) => {
      const node = el('#text');
      node.textContent = text;
      return node;
    },
    getElementById: (id: string) => byId[id] ?? null,
    addEventListener: (t: string, fn: any) => { (listeners[t] ??= []).push(fn); },
    removeEventListener: (t: string, fn: any) => { listeners[t] = (listeners[t] || []).filter(f => f !== fn); },
    dispatch: (t: string, ev: any) => (listeners[t] || []).slice().forEach(f => f(ev)),
  };
  (globalThis as any).document = doc;
  (globalThis as any).getComputedStyle = () => ({ cursor: 'default', getPropertyValue: () => '' });
  return doc;
}

export interface FetchCall { url: string; init?: RequestInit }

export function stubFetch(
  impl: (url: string, init?: RequestInit) => Promise<any>,
): { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  (globalThis as any).fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return await impl(url, init);
  };
  return { calls };
}
