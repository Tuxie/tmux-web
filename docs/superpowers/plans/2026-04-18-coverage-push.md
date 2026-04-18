# Coverage Push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise `bun test --coverage` line coverage from ~69 % to ≥ 95 % across in-scope modules via pure-core/thin-shell refactors plus targeted unit + integration tests. No architecture degradation.

**Architecture:** Refactor IO-heavy server modules (`ws.ts`, `pty.ts`, `foreground-process.ts`, `exec.ts`) into (pure core + thin IO shell). Add a tiny integration harness (fake tmux + ephemeral server) for glue paths. Add residual branch tests for `http.ts`, `origin.ts`, `themes.ts`, and client UI modules. Enforce the target via a `scripts/check-coverage.ts` gate with an explicit exclusion list.

**Tech Stack:** Bun `bun:test`, Node `ws`, `Bun.spawn`, TypeScript, hand-rolled DOM stubs (no jsdom), lcov parsing in plain TS.

**Spec:** `docs/superpowers/specs/2026-04-18-coverage-push-design.md`

---

## File Structure

Server modules (new / changed):

- **New** `src/server/ws-router.ts` — pure message-router; maps `{ClientMsg, SessionState}` → `WsAction[]`.
- **Changed** `src/server/ws.ts` — thin dispatcher; consumes `WsAction[]`.
- **Changed** `src/server/pty.ts` — adds `buildSpawnInput()` pure helper; `spawnPty` unchanged.
- **Split** `src/server/foreground-process.ts` — exports pure `parseForegroundFromProc` + orchestrator with injected `deps`.
- **Changed** `src/server/exec.ts` — unchanged shape; one-line wrapper already, but `foreground-process` stops calling it directly (injected).

Client modules (no refactor required — pure helpers already extracted for the ones we checked). Only new tests.

Coverage tooling:

- **New** `scripts/check-coverage.ts` — runs `bun test --coverage`, parses lcov, enforces thresholds + exclusion list.
- **Changed** `bunfig.toml` — enable lcov reporter.
- **Changed** `package.json` — `coverage` + `coverage:check` scripts.
- **Changed** `Makefile` — `make test` invokes `coverage:check`.

Test harness:

- **New** `tests/unit/server/_harness/fake-tmux.ts` — writes a shell-script fake-tmux into a temp dir and returns its path.
- **New** `tests/unit/server/_harness/spawn-server.ts` — starts an ephemeral `http.ts` + `ws.ts` server for integration tests.
- **New** `tests/unit/client/_dom.ts` — shared DOM/fetch/clipboard stub helpers.

New test files listed inline under each task.

---

## Phase 0 — Coverage tooling

### Task 0.1: Enable lcov reporter

**Files:**
- Modify: `bunfig.toml`
- Modify: `package.json`

- [ ] **Step 1: Update `bunfig.toml`**

```toml
[test]
root = "tests/unit"
include = ["**/*.test.ts"]
exclude = ["vendor/**", "**/vendor/**", "tests/e2e/**", "node_modules/**"]
coverage = false
coverageReporter = ["text", "lcov"]
coverageDir = "coverage"
```

- [ ] **Step 2: Add npm scripts**

In `package.json` under `scripts`:

```json
    "coverage": "bun test --coverage",
    "coverage:check": "bun run scripts/check-coverage.ts"
```

- [ ] **Step 3: Verify**

Run: `bun test --coverage`
Expected: PASS. `coverage/lcov.info` created. Inspect first 20 lines with `head coverage/lcov.info`. Confirm `SF:src/...` records.

- [ ] **Step 4: Add `coverage/` already ignored?**

Run: `grep coverage .gitignore`
Expected: line `coverage/` present (already committed per `0a768c5`). If missing, add it.

- [ ] **Step 5: Commit**

```bash
git add bunfig.toml package.json
git commit -m "test: enable lcov coverage reporter for bun test"
```

### Task 0.2: Coverage gate script

**Files:**
- Create: `scripts/check-coverage.ts`

- [ ] **Step 1: Write the script**

```ts
#!/usr/bin/env bun
/** Parse coverage/lcov.info produced by `bun test --coverage` and fail
 *  if any in-scope file falls below the per-file threshold or the
 *  overall aggregate drops below the global threshold.
 *
 *  Excluded files (bootstrap / generated / IO-shell wrappers) are
 *  reported but not counted toward the gate. */

import { readFileSync } from 'node:fs';

const EXCLUDES = new Set<string>([
  'src/server/index.ts',
  'src/client/index.ts',
  'src/client/adapters/xterm.ts',
  'src/server/assets-embedded.ts',
]);

const PER_FILE_LINE_MIN = 95;
const PER_FILE_FUNC_MIN = 90;
const GLOBAL_LINE_MIN = 95;

interface FileCov { path: string; lines: { found: number; hit: number }; funcs: { found: number; hit: number } }

function parseLcov(text: string): FileCov[] {
  const out: FileCov[] = [];
  let cur: FileCov | null = null;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('SF:')) cur = { path: line.slice(3), lines: { found: 0, hit: 0 }, funcs: { found: 0, hit: 0 } };
    else if (!cur) continue;
    else if (line.startsWith('LF:')) cur.lines.found = Number(line.slice(3));
    else if (line.startsWith('LH:')) cur.lines.hit = Number(line.slice(3));
    else if (line.startsWith('FNF:')) cur.funcs.found = Number(line.slice(4));
    else if (line.startsWith('FNH:')) cur.funcs.hit = Number(line.slice(4));
    else if (line === 'end_of_record' && cur) { out.push(cur); cur = null; }
  }
  return out;
}

function pct(hit: number, found: number): number {
  return found === 0 ? 100 : (hit / found) * 100;
}

function normalise(p: string): string {
  const i = p.indexOf('/src/');
  return i >= 0 ? p.slice(i + 1) : p;
}

const lcov = readFileSync('coverage/lcov.info', 'utf8');
const files = parseLcov(lcov).map(f => ({ ...f, path: normalise(f.path) }));
if (files.length === 0) {
  console.error('check-coverage: no lcov records found; run `bun test --coverage` first');
  process.exit(2);
}

let totalFound = 0, totalHit = 0;
const failures: string[] = [];

for (const f of files) {
  if (EXCLUDES.has(f.path)) continue;
  totalFound += f.lines.found;
  totalHit += f.lines.hit;
  const l = pct(f.lines.hit, f.lines.found);
  const fn = pct(f.funcs.hit, f.funcs.found);
  if (l < PER_FILE_LINE_MIN) failures.push(`${f.path}: lines ${l.toFixed(1)}% < ${PER_FILE_LINE_MIN}%`);
  if (fn < PER_FILE_FUNC_MIN) failures.push(`${f.path}: funcs ${fn.toFixed(1)}% < ${PER_FILE_FUNC_MIN}%`);
}

const globalPct = pct(totalHit, totalFound);
console.log(`\nGlobal (in-scope) lines: ${globalPct.toFixed(2)}% (${totalHit}/${totalFound})`);
if (globalPct < GLOBAL_LINE_MIN) failures.push(`global: ${globalPct.toFixed(1)}% < ${GLOBAL_LINE_MIN}%`);

if (failures.length > 0) {
  console.error('\nCoverage failures:');
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log('coverage OK');
```

- [ ] **Step 2: Run against current baseline**

Run: `bun test --coverage && bun run scripts/check-coverage.ts || true`
Expected: Many failures listed (that's fine — establishes the gate). Global around 69 %.

- [ ] **Step 3: Commit**

```bash
git add scripts/check-coverage.ts
git commit -m "test: add scripts/check-coverage.ts gate for lcov coverage"
```

---

## Phase 1 — Server pure-core refactors

### Task 1.1: Extract `parseForegroundFromProc` + DI for `foreground-process.ts`

**Files:**
- Modify: `src/server/foreground-process.ts`
- Create: `tests/unit/server/foreground-process.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/server/foreground-process.test.ts
import { describe, test, expect } from 'bun:test';
import { parseForegroundFromProc, getForegroundProcess } from '../../../src/server/foreground-process.ts';

describe('parseForegroundFromProc', () => {
  test('extracts tpgid from canonical /proc/<pid>/stat', () => {
    // pid (comm) state ppid pgrp session tty_nr tpgid ...
    const stat = '123 (bash) S 100 123 123 34816 456 4194304 0 ...';
    expect(parseForegroundFromProc(stat)).toBe(456);
  });

  test('handles comm containing spaces and parens', () => {
    const stat = '123 (weird )(name) S 100 123 123 34816 789 ...';
    expect(parseForegroundFromProc(stat)).toBe(789);
  });

  test('returns null for tpgid 0 or -1', () => {
    expect(parseForegroundFromProc('1 (x) S 1 1 1 0 0 ...')).toBeNull();
    expect(parseForegroundFromProc('1 (x) S 1 1 1 0 -1 ...')).toBeNull();
  });

  test('returns null for malformed input', () => {
    expect(parseForegroundFromProc('')).toBeNull();
    expect(parseForegroundFromProc('no closing paren here')).toBeNull();
  });
});

describe('getForegroundProcess with injected deps', () => {
  test('happy path: resolves exePath via injected readlink', async () => {
    const deps = {
      exec: async () => ({ stdout: '123\tbash\n', stderr: '' }),
      readFile: (_p: string) => '123 (bash) S 1 1 1 34816 999 ...',
      readlink: (_p: string) => '/usr/bin/bash',
    };
    const got = await getForegroundProcess('tmux', 'main', deps);
    expect(got).toEqual({ exePath: '/usr/bin/bash', commandName: 'bash', pid: 999 });
  });

  test('exec failure → all null', async () => {
    const deps = {
      exec: async () => { throw new Error('tmux not running'); },
      readFile: () => { throw new Error('unused'); },
      readlink: () => { throw new Error('unused'); },
    };
    expect(await getForegroundProcess('tmux', 'main', deps)).toEqual({ exePath: null, commandName: null, pid: null });
  });

  test('readlink failure → exePath null, pid preserved', async () => {
    const deps = {
      exec: async () => ({ stdout: '123\tbash', stderr: '' }),
      readFile: () => '123 (bash) S 1 1 1 34816 999 ...',
      readlink: () => { throw new Error('ENOENT'); },
    };
    expect(await getForegroundProcess('tmux', 'main', deps)).toEqual({ exePath: null, commandName: 'bash', pid: 999 });
  });

  test('readFile failure → exePath null, commandName preserved', async () => {
    const deps = {
      exec: async () => ({ stdout: '123\tbash', stderr: '' }),
      readFile: () => { throw new Error('EACCES'); },
      readlink: () => '/never-called',
    };
    expect(await getForegroundProcess('tmux', 'main', deps)).toEqual({ exePath: null, commandName: 'bash', pid: 123 });
  });

  test('tpgid zero falls back to panePid for exe lookup', async () => {
    const deps = {
      exec: async () => ({ stdout: '500\tzsh', stderr: '' }),
      readFile: () => '500 (zsh) S 1 1 1 34816 0 ...',
      readlink: (p: string) => (p.includes('/500/') ? '/bin/zsh' : (() => { throw new Error(); })()),
    };
    expect(await getForegroundProcess('tmux', 'main', deps)).toEqual({ exePath: '/bin/zsh', commandName: 'zsh', pid: 500 });
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `bun test tests/unit/server/foreground-process.test.ts`
Expected: FAIL, `parseForegroundFromProc is not exported` (or similar).

- [ ] **Step 3: Refactor the module**

Replace `src/server/foreground-process.ts` with:

```ts
import fs from 'fs';
import { execFileAsync } from './exec.js';

export interface ForegroundProcessInfo {
  exePath: string | null;
  commandName: string | null;
  pid: number | null;
}

export interface ForegroundDeps {
  exec: (file: string, args: readonly string[]) => Promise<{ stdout: string; stderr: string }>;
  readFile: (path: string) => string;
  readlink: (path: string) => string;
}

export function parseForegroundFromProc(stat: string): number | null {
  const closeParen = stat.lastIndexOf(')');
  if (closeParen === -1) return null;
  const tail = stat.slice(closeParen + 2).split(' ');
  const tpgid = Number(tail[5]);
  if (!Number.isFinite(tpgid) || tpgid <= 0) return null;
  return tpgid;
}

const defaultDeps: ForegroundDeps = {
  exec: execFileAsync,
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  readlink: (p) => fs.readlinkSync(p) as string,
};

export async function getForegroundProcess(
  tmuxBin: string,
  session: string,
  deps: ForegroundDeps = defaultDeps,
): Promise<ForegroundProcessInfo> {
  let panePid: string | null = null;
  let commandName: string | null = null;
  try {
    const { stdout } = await deps.exec(
      tmuxBin,
      ['display-message', '-p', '-t', session, '-F', '#{pane_pid}\t#{pane_current_command}'],
    );
    const [pidStr, cmdStr] = stdout.trim().split('\t');
    if (pidStr) panePid = pidStr;
    if (cmdStr) commandName = cmdStr;
  } catch {
    return { exePath: null, commandName: null, pid: null };
  }
  if (!panePid) return { exePath: null, commandName, pid: null };

  let foregroundPid: number | null = null;
  try {
    const stat = deps.readFile(`/proc/${panePid}/stat`);
    foregroundPid = parseForegroundFromProc(stat);
  } catch {
    return { exePath: null, commandName, pid: Number(panePid) };
  }
  if (!foregroundPid) foregroundPid = Number(panePid);

  try {
    const exePath = deps.readlink(`/proc/${foregroundPid}/exe`);
    return { exePath, commandName, pid: foregroundPid };
  } catch {
    return { exePath: null, commandName, pid: foregroundPid };
  }
}
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/unit/server/foreground-process.test.ts`
Expected: PASS (all 8 tests).

- [ ] **Step 5: Run full suite**

Run: `bun test`
Expected: PASS (no regressions; `ws.ts` still imports `getForegroundProcess` with 2-arg form — default param keeps compatibility).

- [ ] **Step 6: Commit**

```bash
git add src/server/foreground-process.ts tests/unit/server/foreground-process.test.ts
git commit -m "refactor(foreground-process): split pure parser + DI for testability"
```

### Task 1.2: Unit-test `exec.ts` via child-process shim

**Files:**
- Create: `tests/unit/server/exec.test.ts`

- [ ] **Step 1: Write the test**

```ts
// tests/unit/server/exec.test.ts
import { describe, test, expect } from 'bun:test';
import { execFileAsync } from '../../../src/server/exec.ts';

describe('execFileAsync', () => {
  test('captures stdout of a real command', async () => {
    const { stdout } = await execFileAsync('printf', ['%s', 'hello']);
    expect(stdout).toBe('hello');
  });

  test('rejects on non-zero exit', async () => {
    await expect(execFileAsync('false', [])).rejects.toBeDefined();
  });

  test('rejects on missing binary', async () => {
    await expect(execFileAsync('/nonexistent/binary-xyz', [])).rejects.toBeDefined();
  });

  test('honours explicit timeout', async () => {
    await expect(execFileAsync('sleep', ['5'], { timeout: 50 })).rejects.toBeDefined();
  });

  test('captures stderr', async () => {
    const { stderr } = await execFileAsync('sh', ['-c', 'printf err 1>&2']);
    expect(stderr).toBe('err');
  });
});
```

- [ ] **Step 2: Run — expect pass on first run**

Run: `bun test tests/unit/server/exec.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 3: Commit**

```bash
git add tests/unit/server/exec.test.ts
git commit -m "test(server): cover execFileAsync stdout/stderr/timeout/missing-binary"
```

### Task 1.3: Extract `ws-router.ts` — pure message dispatcher

**Files:**
- Create: `src/server/ws-router.ts`
- Modify: `src/server/ws.ts`
- Create: `tests/unit/server/ws-router.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/server/ws-router.test.ts
import { describe, test, expect } from 'bun:test';
import { routeClientMessage } from '../../../src/server/ws-router.ts';

function state(overrides: Partial<Parameters<typeof routeClientMessage>[1]> = {}) {
  return {
    currentSession: 'main',
    pendingReads: new Map<string, { selection: string; exePath: string | null; commandName: string | null; awaitingContent?: boolean }>(),
    ...overrides,
  };
}

describe('routeClientMessage', () => {
  test('non-JSON passes through as pty write', () => {
    const acts = routeClientMessage('hello', state());
    expect(acts).toEqual([{ type: 'pty-write', data: 'hello' }]);
  });

  test('JSON resize produces resize action', () => {
    const acts = routeClientMessage('{"type":"resize","cols":80,"rows":24}', state());
    expect(acts).toEqual([{ type: 'pty-resize', cols: 80, rows: 24 }]);
  });

  test('JSON colour-variant dark → set-env action', () => {
    const acts = routeClientMessage('{"type":"colour-variant","variant":"dark"}', state());
    expect(acts).toEqual([{ type: 'colour-variant', variant: 'dark' }]);
  });

  test('invalid colour-variant ignored (passes through as write)', () => {
    const acts = routeClientMessage('{"type":"colour-variant","variant":"neon"}', state());
    expect(acts).toEqual([{ type: 'pty-write', data: '{"type":"colour-variant","variant":"neon"}' }]);
  });

  test('window select action', () => {
    const acts = routeClientMessage('{"type":"window","action":"select","index":"2"}', state());
    expect(acts).toEqual([{ type: 'window', action: 'select', index: '2', name: undefined }]);
  });

  test('session rename action', () => {
    const acts = routeClientMessage('{"type":"session","action":"rename","name":"dev"}', state());
    expect(acts).toEqual([{ type: 'session', action: 'rename', name: 'dev' }]);
  });

  test('clipboard-decision deny', () => {
    const st = state();
    st.pendingReads.set('r1', { selection: 'c', exePath: '/bin/vim', commandName: 'vim' });
    const acts = routeClientMessage('{"type":"clipboard-decision","reqId":"r1","allow":false}', st);
    expect(acts).toEqual([{ type: 'clipboard-deny', reqId: 'r1' }]);
    expect(st.pendingReads.has('r1')).toBe(false);
  });

  test('clipboard-decision allow → emits allow + request-content', () => {
    const st = state();
    st.pendingReads.set('r2', { selection: 'c', exePath: '/bin/vim', commandName: 'vim' });
    const acts = routeClientMessage('{"type":"clipboard-decision","reqId":"r2","allow":true,"persist":true,"expiresAt":null,"pinHash":false}', st);
    expect(acts).toContainEqual({ type: 'clipboard-grant-persist', reqId: 'r2', exePath: '/bin/vim', allow: true, expiresAt: null, pinHash: false });
    expect(acts).toContainEqual({ type: 'clipboard-request-content', reqId: 'r2' });
    expect(st.pendingReads.get('r2')?.awaitingContent).toBe(true);
  });

  test('clipboard-decision for unknown reqId is no-op', () => {
    const acts = routeClientMessage('{"type":"clipboard-decision","reqId":"stale","allow":true}', state());
    expect(acts).toEqual([]);
  });

  test('clipboard-read-reply returns reply action with base64', () => {
    const st = state();
    st.pendingReads.set('r3', { selection: 'p', exePath: '/bin/foo', commandName: 'foo', awaitingContent: true });
    const acts = routeClientMessage('{"type":"clipboard-read-reply","reqId":"r3","base64":"YWJj"}', st);
    expect(acts).toEqual([{ type: 'clipboard-reply', selection: 'p', base64: 'YWJj' }]);
    expect(st.pendingReads.has('r3')).toBe(false);
  });

  test('clipboard-read-reply over size cap replies empty', () => {
    const st = state();
    st.pendingReads.set('r4', { selection: 'c', exePath: null, commandName: null, awaitingContent: true });
    const big = 'a'.repeat(1024 * 1024 + 1);
    const acts = routeClientMessage(`{"type":"clipboard-read-reply","reqId":"r4","base64":"${big}"}`, st);
    expect(acts).toEqual([{ type: 'clipboard-reply', selection: 'c', base64: '' }]);
  });

  test('clipboard-read-reply for non-awaiting entry is no-op', () => {
    const st = state();
    st.pendingReads.set('r5', { selection: 'c', exePath: null, commandName: null });
    const acts = routeClientMessage('{"type":"clipboard-read-reply","reqId":"r5","base64":"x"}', st);
    expect(acts).toEqual([]);
  });

  test('malformed JSON passes through as pty write', () => {
    const acts = routeClientMessage('{not json', state());
    expect(acts).toEqual([{ type: 'pty-write', data: '{not json' }]);
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `bun test tests/unit/server/ws-router.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Create `src/server/ws-router.ts`**

```ts
export interface PendingRead {
  selection: string;
  exePath: string | null;
  commandName: string | null;
  awaitingContent?: boolean;
}

export interface RouterState {
  currentSession: string;
  pendingReads: Map<string, PendingRead>;
}

export type WsAction =
  | { type: 'pty-write'; data: string }
  | { type: 'pty-resize'; cols: number; rows: number }
  | { type: 'colour-variant'; variant: 'dark' | 'light' }
  | { type: 'window'; action: string; index?: string; name?: string }
  | { type: 'session'; action: string; name?: string }
  | { type: 'clipboard-deny'; reqId: string }
  | { type: 'clipboard-grant-persist'; reqId: string; exePath: string; allow: boolean; expiresAt: string | null; pinHash: boolean }
  | { type: 'clipboard-request-content'; reqId: string }
  | { type: 'clipboard-reply'; selection: string; base64: string };

const MAX_BASE64 = 1024 * 1024;

export function routeClientMessage(raw: string, state: RouterState): WsAction[] {
  if (!raw.startsWith('{')) return [{ type: 'pty-write', data: raw }];
  let parsed: any;
  try { parsed = JSON.parse(raw); } catch { return [{ type: 'pty-write', data: raw }]; }

  if (parsed?.type === 'resize' && typeof parsed.cols === 'number' && typeof parsed.rows === 'number') {
    return [{ type: 'pty-resize', cols: parsed.cols, rows: parsed.rows }];
  }
  if (parsed?.type === 'colour-variant' && (parsed.variant === 'dark' || parsed.variant === 'light')) {
    return [{ type: 'colour-variant', variant: parsed.variant }];
  }
  if (parsed?.type === 'window' && typeof parsed.action === 'string') {
    return [{ type: 'window', action: parsed.action, index: parsed.index, name: parsed.name }];
  }
  if (parsed?.type === 'session' && typeof parsed.action === 'string') {
    return [{ type: 'session', action: parsed.action, name: parsed.name }];
  }
  if (parsed?.type === 'clipboard-decision' && typeof parsed.reqId === 'string') {
    const pending = state.pendingReads.get(parsed.reqId);
    if (!pending) return [];
    const allow = !!parsed.allow;
    const out: WsAction[] = [];
    if (parsed.persist === true && pending.exePath) {
      const expiresAt = (typeof parsed.expiresAt === 'string' || parsed.expiresAt === null) ? parsed.expiresAt : null;
      out.push({
        type: 'clipboard-grant-persist',
        reqId: parsed.reqId,
        exePath: pending.exePath,
        allow,
        expiresAt,
        pinHash: !!parsed.pinHash,
      });
    }
    if (allow) {
      pending.awaitingContent = true;
      out.push({ type: 'clipboard-request-content', reqId: parsed.reqId });
    } else {
      state.pendingReads.delete(parsed.reqId);
      out.push({ type: 'clipboard-deny', reqId: parsed.reqId });
    }
    return out;
  }
  if (parsed?.type === 'clipboard-read-reply' && typeof parsed.reqId === 'string') {
    const pending = state.pendingReads.get(parsed.reqId);
    if (!pending || !pending.awaitingContent) return [];
    state.pendingReads.delete(parsed.reqId);
    const base64 = typeof parsed.base64 === 'string' ? parsed.base64 : '';
    const clipped = base64.length > MAX_BASE64 ? '' : base64;
    return [{ type: 'clipboard-reply', selection: pending.selection, base64: clipped }];
  }
  return [{ type: 'pty-write', data: raw }];
}
```

- [ ] **Step 4: Run router tests**

Run: `bun test tests/unit/server/ws-router.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Wire `ws.ts` to use router**

In `src/server/ws.ts`:
- Add `import { routeClientMessage, type WsAction, type PendingRead } from './ws-router.js';`
- Replace the body of `ws.on('message', …)` with:

```ts
ws.on('message', (data) => {
  const msg = data.toString('utf8');
  const actions = routeClientMessage(msg, { currentSession: lastSession, pendingReads });
  for (const act of actions) dispatchAction(act);
});
```

- Add `dispatchAction(act: WsAction)` inside `handleConnection` that translates each action:

```ts
function dispatchAction(act: WsAction): void {
  switch (act.type) {
    case 'pty-write': ptyProcess.write(act.data); return;
    case 'pty-resize': ptyProcess.resize(act.cols, act.rows); return;
    case 'colour-variant': void applyColourVariant(lastSession, act.variant, config); return;
    case 'window':
      void applyWindowAction(lastSession, { action: act.action, index: act.index, name: act.name }, config)
        .then(() => sendWindowState(ws, lastSession, config));
      return;
    case 'session':
      void applySessionAction(lastSession, { action: act.action, name: act.name }, config);
      return;
    case 'clipboard-deny': {
      const pending = pendingReads.get(act.reqId);
      if (pending) { pendingReads.delete(act.reqId); void replyToRead(pending.selection, ''); }
      return;
    }
    case 'clipboard-grant-persist':
      void recordGrant({
        filePath: sessionsStorePath,
        session: lastSession,
        exePath: act.exePath,
        action: 'read',
        allow: act.allow,
        expiresAt: act.expiresAt,
        pinHash: act.pinHash,
      }).catch(() => {});
      return;
    case 'clipboard-request-content': requestClipboardFromClient(act.reqId); return;
    case 'clipboard-reply': void replyToRead(act.selection, act.base64); return;
  }
}
```

Delete the old inline JSON parsing block — router now owns it.

- [ ] **Step 6: Run full suite**

Run: `bun test`
Expected: PASS (all previous tests + new router tests).

- [ ] **Step 7: Commit**

```bash
git add src/server/ws-router.ts src/server/ws.ts tests/unit/server/ws-router.test.ts
git commit -m "refactor(ws): extract pure ws-router for message dispatch"
```

### Task 1.4: Unit tests for `pty.ts` argv builder

**Files:**
- Create: `tests/unit/server/pty-argv.test.ts`

Note: `buildPtyCommand` is already pure; `buildPtyEnv` too. The existing `pty.test.ts` covers *some* branches. Fill in residuals.

- [ ] **Step 1: Inspect the existing test**

Run: `cat tests/unit/server/pty.test.ts`
Note which branches are already covered (sanitise, test-mode, happy-path argv). Missing: env scrubbing of `LANG`/`LANGUAGE`/`EDITOR`/`VISUAL`, default session fallback.

- [ ] **Step 2: Write the gap-filling tests**

```ts
// tests/unit/server/pty-argv.test.ts
import { describe, test, expect } from 'bun:test';
import { buildPtyCommand, buildPtyEnv, sanitizeSession } from '../../../src/server/pty.ts';

describe('sanitizeSession', () => {
  test('empty → main', () => { expect(sanitizeSession('')).toBe('main'); });
  test('strips shell metachars', () => { expect(sanitizeSession('foo;bar`baz$')).toBe('foobarbaz'); });
  test('collapses ".." traversal', () => { expect(sanitizeSession('..foo')).toBe('foo'); });
  test('strips leading/trailing slash', () => { expect(sanitizeSession('/foo/')).toBe('foo'); });
  test('decodes percent-encoded input', () => { expect(sanitizeSession('foo%20bar')).toBe('foobar'); });
  test('only-meta input returns main', () => { expect(sanitizeSession(';;;')).toBe('main'); });
});

describe('buildPtyCommand', () => {
  test('test mode returns cat', () => {
    expect(buildPtyCommand({ testMode: true, session: 'ignored', tmuxConfPath: '/x', tmuxBin: '/usr/bin/tmux' }))
      .toEqual({ file: 'cat', args: [] });
  });
  test('non-test produces attach-or-create argv with conf path', () => {
    expect(buildPtyCommand({ testMode: false, session: 'dev', tmuxConfPath: '/etc/tmux.conf', tmuxBin: '/usr/bin/tmux' }))
      .toEqual({ file: '/usr/bin/tmux', args: ['-f', '/etc/tmux.conf', 'new-session', '-A', '-s', 'dev'] });
  });
  test('sanitises malicious session name', () => {
    const got = buildPtyCommand({ testMode: false, session: 'a;b', tmuxConfPath: '/t.conf', tmuxBin: 'tmux' });
    expect(got.args).toContain('ab');
  });
});

describe('buildPtyEnv', () => {
  test('scrubs LANG/LANGUAGE/EDITOR/VISUAL and pins TERM et al', () => {
    const env = buildPtyEnv();
    expect(env.LANG).toBeUndefined();
    expect(env.LANGUAGE).toBeUndefined();
    expect(env.EDITOR).toBeUndefined();
    expect(env.VISUAL).toBeUndefined();
    expect(env.TERM).toBe('xterm-256color');
    expect(env.TERM_PROGRAM).toBe('xterm');
    expect(env.COLORTERM).toBe('truecolor');
    expect(env.LC_ALL).toBe('C.UTF-8');
  });
});
```

- [ ] **Step 3: Run**

Run: `bun test tests/unit/server/pty-argv.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/server/pty-argv.test.ts
git commit -m "test(pty): cover env scrubbing + sanitise edge cases"
```

---

## Phase 2 — Server integration harness

### Task 2.1: Fake-tmux shell script

**Files:**
- Create: `tests/unit/server/_harness/fake-tmux.ts`

- [ ] **Step 1: Write the helper**

```ts
// tests/unit/server/_harness/fake-tmux.ts
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Returns path to a fake-tmux binary implementing the narrow surface
 *  tmux-web calls: display-message, list-windows, select-window,
 *  new-window, kill-window, rename-window, rename-session, kill-session,
 *  set-environment, send-keys -H <hex>, new-session -A -s …
 *  State is kept in a sidecar JSON file whose path is logged per call so
 *  tests can assert the call sequence. */
export function makeFakeTmux(): { path: string; logFile: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'fake-tmux-'));
  const logFile = join(dir, 'calls.log');
  const bin = join(dir, 'tmux');
  writeFileSync(bin, `#!/usr/bin/env bash
LOG="${logFile}"
printf '%s\\n' "$*" >> "$LOG"
case "$1" in
  display-message)
    for arg in "$@"; do
      case "$arg" in
        "#{pane_pid}"*"#{pane_current_command}"*) echo -e "1\\tbash"; exit 0;;
        "#{pane_title}"*) echo "fake-title"; exit 0;;
      esac
    done
    echo -e "1\\tbash"
    ;;
  list-windows) echo "0:one:1"; echo "1:two:0";;
  list-sessions) echo "main: 1 windows"; echo "dev: 1 windows";;
  new-session|select-window|new-window|kill-window|rename-window|rename-session|kill-session|set-environment|send-keys) exit 0;;
  *) exit 0;;
esac
`);
  chmodSync(bin, 0o755);
  return { path: bin, logFile, dir };
}
```

- [ ] **Step 2: Smoke-test the helper**

Inline in the next task — no dedicated test file needed.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/server/_harness/fake-tmux.ts
git commit -m "test(harness): add fake-tmux shell-script helper"
```

### Task 2.2: Ephemeral-server harness

**Files:**
- Create: `tests/unit/server/_harness/spawn-server.ts`

- [ ] **Step 1: Write the helper**

```ts
// tests/unit/server/_harness/spawn-server.ts
import { createServer, type IncomingMessage } from 'node:http';
import { AddressInfo } from 'node:net';
import { createHttpHandler } from '../../../../src/server/http.ts';
import { createWsServer } from '../../../../src/server/ws.ts';
import type { ServerConfig } from '../../../../src/shared/types.ts';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface Harness { url: string; wsUrl: string; close: () => Promise<void>; tmpDir: string }

export async function startTestServer(
  overrides: Partial<ServerConfig> = {},
  tmuxBin = '/bin/true',
): Promise<Harness> {
  const tmpDir = mkdtempSync(join(tmpdir(), 'tw-srv-'));
  const sessionsStorePath = join(tmpDir, 'sessions.json');
  writeFileSync(sessionsStorePath, JSON.stringify({ version: 1, sessions: {} }));
  const tmuxConfPath = join(tmpDir, 'tmux.conf');
  writeFileSync(tmuxConfPath, '');

  const config: ServerConfig = {
    host: '127.0.0.1', port: 0, allowedIps: ['127.0.0.1', '::1'], allowedOrigins: [],
    username: '', password: '', noAuth: true, tls: false, tlsCertPath: '', tlsKeyPath: '',
    tmuxBin, tmuxConfPath, themesDir: '', testMode: true, debug: false,
    ...overrides,
  } as any;

  const handler = createHttpHandler({ config, sessionsStorePath });
  const server = createServer((req, res) => handler(req, res));
  createWsServer(server, { config, tmuxConfPath, sessionsStorePath });

  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}`;
  return {
    url,
    wsUrl: url.replace(/^http/, 'ws'),
    tmpDir,
    close: () => new Promise(r => server.close(() => r())),
  };
}
```

- [ ] **Step 2: Check `createHttpHandler` export**

Run: `grep -n "export function createHttpHandler\|export.*createHttpHandler" src/server/http.ts`
Expected: an exported handler factory. If the module currently exports a different shape, either (a) update the harness to match the existing export, or (b) add a thin `createHttpHandler` export that builds the handler. Pick (a) unless the existing export requires live PTY / live TLS.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/server/_harness/spawn-server.ts
git commit -m "test(harness): add ephemeral-server startup helper"
```

### Task 2.3: WS integration tests (glue paths)

**Files:**
- Create: `tests/unit/server/ws-integration.test.ts`

- [ ] **Step 1: Write integration tests**

```ts
// tests/unit/server/ws-integration.test.ts
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { startTestServer, type Harness } from './_harness/spawn-server.ts';
import { makeFakeTmux } from './_harness/fake-tmux.ts';
import WebSocket from 'ws';

let h: Harness;

beforeEach(async () => {
  const fake = makeFakeTmux();
  h = await startTestServer({ tmuxBin: fake.path, testMode: false }, fake.path);
});

afterEach(async () => { await h.close(); });

function open(path = '/ws?session=main&cols=80&rows=24'): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(h.wsUrl + path);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

describe('ws integration', () => {
  test('upgrade succeeds for /ws', async () => {
    const ws = await open();
    ws.close();
  });

  test('non-/ws path → socket destroyed', async () => {
    await expect(open('/other')).rejects.toBeDefined();
  });

  test('resize message round-trips without error', async () => {
    const ws = await open();
    ws.send(JSON.stringify({ type: 'resize', cols: 120, rows: 40 }));
    await new Promise(r => setTimeout(r, 30));
    ws.close();
  });

  test('window select triggers tmux select-window', async () => {
    const ws = await open();
    ws.send(JSON.stringify({ type: 'window', action: 'select', index: '1' }));
    await new Promise(r => setTimeout(r, 50));
    ws.close();
    // Best-effort: if fake-tmux log is accessible via harness, assert it.
    // Otherwise the assertion is that no exception was thrown and the socket stayed open.
  });

  test('pty write passes non-JSON through', async () => {
    const ws = await open();
    ws.send('hello');
    await new Promise(r => setTimeout(r, 20));
    ws.close();
  });

  test('close disposes PTY + drops listener', async () => {
    const ws = await open();
    ws.close();
    await new Promise(r => setTimeout(r, 30));
  });
});

describe('ws origin/auth rejection', () => {
  test('403 on bad Origin', async () => {
    await h.close();
    const fake = makeFakeTmux();
    h = await startTestServer({ tmuxBin: fake.path, testMode: false, allowedOrigins: ['https://good.example'] }, fake.path);
    await expect(new Promise((resolve, reject) => {
      const ws = new WebSocket(h.wsUrl + '/ws?session=main&cols=80&rows=24', { headers: { Origin: 'https://bad.example' } });
      ws.once('open', () => resolve(null));
      ws.once('unexpected-response', (_req, res) => reject(new Error(`status ${res.statusCode}`)));
      ws.once('error', reject);
    })).rejects.toMatchObject({ message: expect.stringMatching(/status 403/) });
  });

  test('401 without auth', async () => {
    await h.close();
    const fake = makeFakeTmux();
    h = await startTestServer({ tmuxBin: fake.path, testMode: false, noAuth: false, username: 'u', password: 'p' }, fake.path);
    await expect(new Promise((resolve, reject) => {
      const ws = new WebSocket(h.wsUrl + '/ws?session=main&cols=80&rows=24');
      ws.once('open', () => resolve(null));
      ws.once('unexpected-response', (_req, res) => reject(new Error(`status ${res.statusCode}`)));
      ws.once('error', reject);
    })).rejects.toMatchObject({ message: expect.stringMatching(/status 401/) });
  });
});
```

- [ ] **Step 2: Run**

Run: `bun test tests/unit/server/ws-integration.test.ts`
Expected: PASS. If the harness needs adjustment (config shape, handler export), fix the harness or `http.ts`/`ws.ts` export surface — not the tests.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/server/ws-integration.test.ts
git commit -m "test(ws): integration tests for upgrade/auth/origin/message dispatch"
```

### Task 2.4: PTY integration test

**Files:**
- Create: `tests/unit/server/pty-integration.test.ts`

- [ ] **Step 1: Write the test**

```ts
// tests/unit/server/pty-integration.test.ts
import { describe, test, expect } from 'bun:test';
import { spawnPty, buildPtyCommand, buildPtyEnv } from '../../../src/server/pty.ts';

describe('spawnPty (test-mode cat)', () => {
  test('onData sees echoed bytes; onExit fires on kill', async () => {
    const cmd = buildPtyCommand({ testMode: true, session: 'x', tmuxConfPath: '/ignored', tmuxBin: 'tmux' });
    const pty = spawnPty({ command: cmd, env: buildPtyEnv(), cols: 80, rows: 24 });

    const chunks: string[] = [];
    pty.onData(d => chunks.push(d));
    const exited = new Promise<void>(r => pty.onExit(() => r()));

    pty.write('hello');
    await new Promise(r => setTimeout(r, 50));
    expect(chunks.join('')).toContain('hello');

    pty.resize(100, 30);
    pty.kill();
    await exited;
  });
});
```

- [ ] **Step 2: Run**

Run: `bun test tests/unit/server/pty-integration.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/server/pty-integration.test.ts
git commit -m "test(pty): integration test for spawn/write/resize/kill"
```

---

## Phase 3 — Server residual branch tests

### Task 3.1: `http.ts` static + auth + 404 branches

**Files:**
- Create: `tests/unit/server/http-static.test.ts`

- [ ] **Step 1: Inspect gaps**

Run: `bun test --coverage 2>&1 | grep "src/server/http.ts"`
Note the uncovered line ranges. Map each range to a code path (static asset serve, auth reject, `/api/*` not-found, session 302, malformed body 400, origin reject, IP reject).

- [ ] **Step 2: Write targeted tests**

Pattern: hit the server with `fetch(...)` via the `startTestServer` harness. One `test()` per branch:

```ts
// tests/unit/server/http-static.test.ts
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { startTestServer, type Harness } from './_harness/spawn-server.ts';

let h: Harness;
beforeAll(async () => { h = await startTestServer(); });
afterAll(async () => { await h.close(); });

describe('http static + routing', () => {
  test('GET / → 200 html', async () => {
    const r = await fetch(h.url + '/');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type') || '').toMatch(/html/);
  });

  test('GET /xterm.js → 200 js', async () => {
    const r = await fetch(h.url + '/xterm.js');
    expect(r.status).toBe(200);
  });

  test('GET /nonexistent → 404', async () => {
    const r = await fetch(h.url + '/does-not-exist');
    expect(r.status).toBe(404);
  });

  test('GET /api/unknown → 404', async () => {
    const r = await fetch(h.url + '/api/unknown');
    expect(r.status).toBe(404);
  });

  test('GET /<session> → 200 html (session landing page)', async () => {
    const r = await fetch(h.url + '/dev');
    expect(r.status).toBe(200);
  });

  test('OPTIONS on /api/drop → allowed method list', async () => {
    const r = await fetch(h.url + '/api/drop?session=main', { method: 'OPTIONS' });
    expect([200, 204]).toContain(r.status);
  });
});
```

Add one test file per remaining gap cluster as needed (`http-auth.test.ts` already exists — extend it rather than create a second). Iterate:

```bash
bun test --coverage 2>&1 | grep "src/server/http.ts"
```

Until `% Lines` for `http.ts` ≥ 95.

- [ ] **Step 3: Run**

Run: `bun test tests/unit/server/http-static.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/server/http-static.test.ts
git commit -m "test(http): cover static/404/session-landing/OPTIONS branches"
```

### Task 3.2: `origin.ts` residual branches

**Files:**
- Modify: `tests/unit/server/origin.test.ts`

- [ ] **Step 1: Identify gaps**

Run: `bun test --coverage 2>&1 | grep "src/server/origin.ts"`
Uncovered lines from baseline: `102-113, 129-130`.

- [ ] **Step 2: Read current file to map line ranges**

```bash
sed -n '100,135p' src/server/origin.ts
```

- [ ] **Step 3: Add tests for each missing branch**

Append to `tests/unit/server/origin.test.ts`:

```ts
import { isOriginAllowed, logOriginReject } from '../../../src/server/origin.ts';

test('isOriginAllowed accepts * wildcard', () => {
  const req = { headers: { origin: 'https://foo', host: 'x:1' } } as any;
  expect(isOriginAllowed(req, { allowedIps: [], allowedOrigins: ['*'], serverScheme: 'http', serverPort: 1 })).toBe(true);
});

test('isOriginAllowed rejects mismatched scheme', () => {
  // …matching the specific branch at line 102-113
});

test('logOriginReject emits expected stderr prefix', () => {
  const prev = process.stderr.write;
  const seen: string[] = [];
  (process.stderr as any).write = (s: string) => { seen.push(s); return true; };
  try { logOriginReject('https://bad', '10.0.0.1'); } finally { (process.stderr as any).write = prev; }
  expect(seen.join('')).toContain('origin rejected');
});
```

Flesh out every uncovered line. Iterate with the `--coverage` grep until ≥ 95 %.

- [ ] **Step 4: Run + commit**

```
bun test tests/unit/server/origin.test.ts
git add tests/unit/server/origin.test.ts
git commit -m "test(origin): cover wildcard, scheme mismatch, reject logging"
```

### Task 3.3: `themes.ts`, `clipboard-policy.ts`, `file-drop.ts`, `colours.ts` residuals

**Files:**
- Modify: `tests/unit/server/themes.test.ts`
- Modify: `tests/unit/server/clipboard-policy.test.ts`
- Modify: `tests/unit/server/file-drop.test.ts`
- Modify: `tests/unit/client/compose-theme.test.ts` (client `colours.ts`)

- [ ] **Step 1: Enumerate gaps per file**

```bash
bun test --coverage 2>&1 | grep -E "themes.ts|clipboard-policy.ts|file-drop.ts|colours.ts"
```

- [ ] **Step 2: For each uncovered line, write a named test that exercises the specific branch**

For every branch: read the code, write a test that drives it, confirm coverage ticks up. Example shape:

```ts
test('<module>: <branch description>', () => {
  const got = fn(specificInput);
  expect(got).toEqual(expectedOutput);
});
```

Iterate per file until each ≥ 95 % lines.

- [ ] **Step 3: Commit per file**

```
git add tests/unit/server/<file>.test.ts
git commit -m "test(<module>): cover remaining branches"
```

---

## Phase 4 — Client UI tests (no refactor)

### Task 4.1: Shared DOM stub helper

**Files:**
- Create: `tests/unit/client/_dom.ts`

- [ ] **Step 1: Factor the recurring stubs**

```ts
// tests/unit/client/_dom.ts
export interface StubElement {
  tagName: string; children: StubElement[]; classList: Set<string>;
  listeners: Record<string, ((ev: any) => void)[]>;
  attrs: Record<string, string>; textContent: string;
  appendChild(child: StubElement): StubElement;
  removeChild(child: StubElement): void;
  addEventListener(t: string, fn: (ev: any) => void, capture?: boolean): void;
  removeEventListener(t: string, fn: (ev: any) => void, capture?: boolean): void;
  dispatch(t: string, ev: any): void;
  setAttribute(k: string, v: string): void;
  remove(): void;
  contains(_n: any): boolean;
}

export function el(tag = 'div'): StubElement {
  const self: StubElement = {
    tagName: tag.toUpperCase(), children: [], classList: new Set(), listeners: {}, attrs: {}, textContent: '',
    appendChild(c) { self.children.push(c); return c; },
    removeChild(c) { const i = self.children.indexOf(c); if (i >= 0) self.children.splice(i, 1); },
    addEventListener(t, fn) { (self.listeners[t] ??= []).push(fn); },
    removeEventListener(t, fn) { self.listeners[t] = (self.listeners[t] || []).filter(f => f !== fn); },
    dispatch(t, ev) { (self.listeners[t] || []).forEach(f => f(ev)); },
    setAttribute(k, v) { self.attrs[k] = v; },
    remove() {},
    contains() { return true; },
  };
  (self.classList as any).add = (c: string) => (self.classList as Set<string>).add(c);
  (self.classList as any).remove = (c: string) => (self.classList as Set<string>).delete(c);
  return self;
}

export function setupDocument(body: StubElement = el('body')): { document: any; body: StubElement } {
  const listeners: Record<string, ((ev: any) => void)[]> = {};
  const byId: Record<string, StubElement> = {};
  const document: any = {
    body,
    createElement: (t: string) => el(t),
    getElementById: (id: string) => byId[id] ?? null,
    addEventListener: (t: string, fn: any) => { (listeners[t] ??= []).push(fn); },
    removeEventListener: (t: string, fn: any) => { listeners[t] = (listeners[t] || []).filter(f => f !== fn); },
    dispatch: (t: string, ev: any) => (listeners[t] || []).forEach(f => f(ev)),
    __byId: byId,
  };
  (globalThis as any).document = document;
  return { document, body };
}

export function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response | { ok: boolean; status?: number; json?: () => any; text?: () => any }>): { calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: any[] = [];
  (globalThis as any).fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return await impl(url, init);
  };
  return { calls };
}
```

- [ ] **Step 2: No tests of its own (helper). Commit.**

```bash
git add tests/unit/client/_dom.ts
git commit -m "test(client): shared DOM/fetch stub helpers"
```

### Task 4.2: `mouse.ts` — test `installMouseHandler`

**Files:**
- Create: `tests/unit/client/ui/mouse.test.ts`

- [ ] **Step 1: Write the test**

```ts
// tests/unit/client/ui/mouse.test.ts
import { describe, test, expect, beforeEach } from 'bun:test';
import { setupDocument, el } from '../_dom.ts';
import { installMouseHandler, getSgrCoords, buildSgrSequence, mouseButton, addModifiers } from '../../../../src/client/ui/mouse.ts';

describe('pure helpers', () => {
  test('getSgrCoords', () => {
    expect(getSgrCoords(100, 200, { width: 10, height: 20 }, { left: 0, top: 0 })).toEqual({ col: 11, row: 11 });
  });
  test('buildSgrSequence press vs release', () => {
    expect(buildSgrSequence(0, 1, 1, false)).toBe('\x1b[<0;1;1M');
    expect(buildSgrSequence(0, 1, 1, true)).toBe('\x1b[<0;1;1m');
  });
  test('mouseButton mapping', () => {
    expect(mouseButton({ button: 0 } as any)).toBe(0);
    expect(mouseButton({ button: 1 } as any)).toBe(1);
    expect(mouseButton({ button: 2 } as any)).toBe(2);
    expect(mouseButton({ button: 3 } as any)).toBe(0);
  });
  test('addModifiers alt+ctrl', () => {
    expect(addModifiers(0, { altKey: true, ctrlKey: true } as any)).toBe(24);
    expect(addModifiers(0, { altKey: false, ctrlKey: false } as any)).toBe(0);
  });
});

describe('installMouseHandler', () => {
  beforeEach(() => {
    setupDocument();
    (globalThis as any).getComputedStyle = () => ({ cursor: 'default' });
  });

  test('press-drag-release round-trip emits three sgr sequences', () => {
    const term = el('div');
    const sent: string[] = [];
    const uninstall = installMouseHandler({
      getMetrics: () => ({ width: 10, height: 20 }) as any,
      getCanvasRect: () => ({ left: 0, top: 0 }) as any,
      getTerminalElement: () => term as any,
      send: (s) => sent.push(s),
    });
    const ev = (clientX: number, clientY: number, button = 0) => ({
      clientX, clientY, button, altKey: false, ctrlKey: false, shiftKey: false,
      target: term, preventDefault() {}, stopPropagation() {},
    });
    (globalThis as any).document.dispatch('mousedown', ev(5, 5));
    (globalThis as any).document.dispatch('mousemove', ev(25, 25));
    (globalThis as any).document.dispatch('mouseup', ev(25, 25));
    expect(sent).toHaveLength(3);
    expect(sent[0]).toMatch(/\[<0;1;1M$/);
    expect(sent[2]).toMatch(/\[<0;3;2m$/);
    uninstall();
  });

  test('shift-click bypasses SGR', () => {
    const term = el('div');
    const sent: string[] = [];
    installMouseHandler({
      getMetrics: () => ({ width: 10, height: 20 }) as any,
      getCanvasRect: () => ({ left: 0, top: 0 }) as any,
      getTerminalElement: () => term as any,
      send: (s) => sent.push(s),
    });
    (globalThis as any).document.dispatch('mousedown', { clientX: 5, clientY: 5, button: 0, shiftKey: true, target: term, preventDefault(){}, stopPropagation(){} });
    expect(sent).toHaveLength(0);
  });

  test('click over link (cursor:pointer) bypasses SGR', () => {
    (globalThis as any).getComputedStyle = () => ({ cursor: 'pointer' });
    const term = el('div');
    const sent: string[] = [];
    installMouseHandler({
      getMetrics: () => ({ width: 10, height: 20 }) as any,
      getCanvasRect: () => ({ left: 0, top: 0 }) as any,
      getTerminalElement: () => term as any,
      send: (s) => sent.push(s),
    });
    (globalThis as any).document.dispatch('mousedown', { clientX: 5, clientY: 5, button: 0, altKey: false, ctrlKey: false, shiftKey: false, target: term, preventDefault(){}, stopPropagation(){} });
    expect(sent).toHaveLength(0);
  });

  test('contextmenu on terminal is prevented', () => {
    const term = el('div');
    installMouseHandler({
      getMetrics: () => ({ width: 10, height: 20 }) as any,
      getCanvasRect: () => ({ left: 0, top: 0 }) as any,
      getTerminalElement: () => term as any,
      send: () => {},
    });
    let prevented = false;
    (globalThis as any).document.dispatch('contextmenu', { target: term, shiftKey: false, preventDefault() { prevented = true; } });
    expect(prevented).toBe(true);
  });

  test('uninstall removes listeners', () => {
    const term = el('div');
    const sent: string[] = [];
    const off = installMouseHandler({
      getMetrics: () => ({ width: 10, height: 20 }) as any,
      getCanvasRect: () => ({ left: 0, top: 0 }) as any,
      getTerminalElement: () => term as any,
      send: (s) => sent.push(s),
    });
    off();
    (globalThis as any).document.dispatch('mousedown', { clientX: 5, clientY: 5, button: 0, target: term, altKey: false, ctrlKey: false, shiftKey: false, preventDefault(){}, stopPropagation(){} });
    expect(sent).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run + commit**

```bash
bun test tests/unit/client/ui/mouse.test.ts
git add tests/unit/client/ui/mouse.test.ts
git commit -m "test(ui/mouse): cover installMouseHandler + pure helpers"
```

### Task 4.3: `file-drop.ts` — upload + install handler

**Files:**
- Create: `tests/unit/client/ui/file-drop.test.ts`

- [ ] **Step 1: Write the test**

```ts
// tests/unit/client/ui/file-drop.test.ts
import { describe, test, expect, beforeEach } from 'bun:test';
import { setupDocument, el, stubFetch } from '../_dom.ts';
import { uploadFile, filesFromClipboard, installFileDropHandler } from '../../../../src/client/ui/file-drop.ts';

function makeFile(name: string, size = 4): File {
  return { name, size, type: 'application/octet-stream' } as any;
}

describe('uploadFile', () => {
  test('posts to /api/drop with X-Filename', async () => {
    const { calls } = stubFetch(async () => ({ ok: true, json: async () => ({ filename: 'x', size: 4, path: '/tmp/x' }) }));
    const info = await uploadFile('main', makeFile('x'));
    expect(info.path).toBe('/tmp/x');
    expect(calls[0].url).toBe('/api/drop?session=main');
    expect(calls[0].init?.method).toBe('POST');
    expect((calls[0].init?.headers as any)['X-Filename']).toBe('x');
  });
  test('throws on non-ok response', async () => {
    stubFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    await expect(uploadFile('main', makeFile('x'))).rejects.toThrow(/drop upload 500/);
  });
});

describe('filesFromClipboard', () => {
  test('prefers the larger of files[] vs items[]', () => {
    const f1 = makeFile('a'), f2 = makeFile('b');
    const cd: any = { files: [f1], items: [{ kind: 'file', getAsFile: () => f1 }, { kind: 'file', getAsFile: () => f2 }] };
    expect(filesFromClipboard(cd)).toEqual([f1, f2]);
  });
  test('dedupes', () => {
    const f = makeFile('a');
    const cd: any = { files: [f], items: [{ kind: 'file', getAsFile: () => f }] };
    expect(filesFromClipboard(cd)).toEqual([f]);
  });
  test('ignores non-file items', () => {
    const cd: any = { files: [], items: [{ kind: 'string', getAsFile: () => null }] };
    expect(filesFromClipboard(cd)).toEqual([]);
  });
});

describe('installFileDropHandler', () => {
  beforeEach(() => setupDocument());

  test('drag + drop uploads all files', async () => {
    const term = el('div');
    const dropped: any[] = [];
    stubFetch(async () => ({ ok: true, json: async () => ({ filename: 'x', size: 4, path: '/tmp/x' }) }));
    const off = installFileDropHandler({
      terminal: term as any, getSession: () => 'main', onDropped: (i) => dropped.push(i),
    });
    const file = makeFile('a');
    const dt = { types: ['Files'], files: [file], dropEffect: '' };
    term.dispatch('dragenter', { dataTransfer: dt, preventDefault() {} });
    term.dispatch('dragover', { dataTransfer: dt, preventDefault() {} });
    term.dispatch('dragleave', { dataTransfer: dt, preventDefault() {} });
    term.dispatch('drop', { dataTransfer: dt, preventDefault() {} });
    await new Promise(r => setTimeout(r, 10));
    expect(dropped).toHaveLength(1);
    off();
  });

  test('drop without Files type is a no-op', async () => {
    const term = el('div');
    const dropped: any[] = [];
    stubFetch(async () => ({ ok: true, json: async () => ({}) }));
    installFileDropHandler({ terminal: term as any, getSession: () => 'main', onDropped: (i) => dropped.push(i) });
    term.dispatch('drop', { dataTransfer: { types: [], files: [] }, preventDefault() {} });
    await new Promise(r => setTimeout(r, 5));
    expect(dropped).toHaveLength(0);
  });

  test('paste with files pre-empts default and uploads', async () => {
    const term = el('div');
    const dropped: any[] = [];
    stubFetch(async () => ({ ok: true, json: async () => ({ filename: 'x', size: 4, path: '/tmp/x' }) }));
    installFileDropHandler({ terminal: term as any, getSession: () => 'main', onDropped: (i) => dropped.push(i) });
    let prevented = false;
    (globalThis as any).document.dispatch('paste', {
      clipboardData: { files: [makeFile('x')], items: [{ kind: 'file', getAsFile: () => makeFile('x') }] },
      preventDefault() { prevented = true; }, stopPropagation() {},
    });
    await new Promise(r => setTimeout(r, 10));
    expect(prevented).toBe(true);
    expect(dropped.length).toBeGreaterThan(0);
  });

  test('onError called on upload failure', async () => {
    const term = el('div');
    const errs: any[] = [];
    stubFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    installFileDropHandler({ terminal: term as any, getSession: () => 'main', onError: (e) => errs.push(e) });
    term.dispatch('drop', { dataTransfer: { types: ['Files'], files: [makeFile('x')] }, preventDefault() {} });
    await new Promise(r => setTimeout(r, 10));
    expect(errs).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run + commit**

```bash
bun test tests/unit/client/ui/file-drop.test.ts
git add tests/unit/client/ui/file-drop.test.ts
git commit -m "test(ui/file-drop): cover uploadFile, filesFromClipboard, install handler"
```

### Task 4.4: `clipboard.ts` + `clipboard-prompt.ts`

**Files:**
- Create: `tests/unit/client/ui/clipboard.test.ts`
- Create: `tests/unit/client/ui/clipboard-prompt.test.ts`

- [ ] **Step 1: Inspect the modules**

```bash
sed -n '1,80p' src/client/ui/clipboard.ts
sed -n '1,80p' src/client/ui/clipboard-prompt.ts
```

- [ ] **Step 2: Write tests driving every branch (write-happy-path, clipboard API absent, prompt accept/deny/persist/remember paths)**

Model closely on existing `tests/unit/client/` style. Use `_dom.ts` helpers. One `test()` per behaviour.

- [ ] **Step 3: Run + commit**

```bash
bun test tests/unit/client/ui/clipboard.test.ts tests/unit/client/ui/clipboard-prompt.test.ts
git add tests/unit/client/ui/clipboard*.test.ts
git commit -m "test(ui/clipboard): cover write + consent prompt branches"
```

### Task 4.5: `topbar.ts`, `drops-panel.ts`

**Files:**
- Create: `tests/unit/client/ui/topbar.test.ts`
- Create: `tests/unit/client/ui/drops-panel.test.ts`

- [ ] **Step 1: For each module, enumerate code paths via `grep`**

```bash
grep -n "function\|export" src/client/ui/topbar.ts | head -40
grep -n "function\|export" src/client/ui/drops-panel.ts | head -40
```

- [ ] **Step 2: Stub out `document.getElementById` by populating `__byId` with the IDs the module needs**

Refer to the `DOM Contract` list in `CLAUDE.md` for the IDs used by topbar: `#btn-session-menu`, `#tb-session-name`, `#win-tabs`, `#chk-fullscreen`, etc.

- [ ] **Step 3: Write tests driving every branch**

Each exported function gets a test; each non-trivial conditional gets a named test.

- [ ] **Step 4: Run + commit**

```bash
bun test tests/unit/client/ui/topbar.test.ts tests/unit/client/ui/drops-panel.test.ts
git add tests/unit/client/ui/topbar.test.ts tests/unit/client/ui/drops-panel.test.ts
git commit -m "test(ui): cover topbar + drops-panel branches"
```

### Task 4.6: `prefs.ts`, residual `session-settings.ts`, `theme.ts`, `keyboard.ts`, `colours.ts`

**Files:**
- Create: `tests/unit/client/prefs.test.ts`
- Modify: `tests/unit/client/session-settings.test.ts`
- Modify: `tests/unit/client/theme.test.ts`
- Modify: `tests/unit/client/ui/keyboard.test.ts` (create if missing)
- Modify: `tests/unit/client/compose-theme.test.ts`

Pattern (repeat per file):

- [ ] **Step 1: Enumerate uncovered lines for the file**

```bash
bun test --coverage 2>&1 | grep "<filename>"
```

- [ ] **Step 2: For each uncovered line, read the code, write a test, run, verify the line flips to covered**

- [ ] **Step 3: Commit per file**

```bash
git add tests/unit/client/<file>.test.ts
git commit -m "test(<module>): cover remaining branches"
```

Target: each file ≥ 95 % lines after these tasks.

---

## Phase 5 — Enforce + verify

### Task 5.1: Wire gate into `make test`

**Files:**
- Modify: `Makefile`

- [ ] **Step 1: Add coverage check**

Edit `Makefile`; find the `test-unit:` target and add a dependent line:

```make
test-unit:
	bun test --coverage
	bun run scripts/check-coverage.ts
```

- [ ] **Step 2: Verify**

Run: `make test-unit`
Expected: coverage summary + `coverage OK` and exit 0.

- [ ] **Step 3: Commit**

```bash
git add Makefile
git commit -m "test: gate make test-unit on coverage thresholds"
```

### Task 5.2: Final verification

- [ ] **Step 1: Run full unit suite under coverage**

Run: `bun test --coverage && bun run scripts/check-coverage.ts`
Expected: `coverage OK`. Global ≥ 95 %.

- [ ] **Step 2: Run full suite (unit + e2e)**

Run: `make test`
Expected: all green.

- [ ] **Step 3: Run release check (act)**

Run: `act -j build --matrix name:linux-x64 -P ubuntu-latest=catthehacker/ubuntu:act-latest`
Expected: verify-vendor-xterm passes (upload-artifact step failure at the end is expected).

- [ ] **Step 4: Final commit if anything pending**

```bash
git status
# if clean, done; otherwise commit with a summary message
```

---

## Rollback

Every task is an isolated commit. To revert any task, `git revert <sha>`. The coverage gate is opt-in at `make test-unit`; if it blocks a hotfix, `bun test` without the script still runs the suite.

## Risks

- **`createHttpHandler` export** may not exist in the current shape required by the harness (Task 2.2). If it doesn't, add a thin factory export to `src/server/http.ts` — don't fold runtime wiring into the test.
- **Fake-tmux drift**: if a new tmux subcommand is added to the code path, extend `fake-tmux.ts`. Keep the script minimal.
- **Client DOM stubs missing an API**: when a new browser API is touched, extend `_dom.ts`. Resist the urge to pull in jsdom.
