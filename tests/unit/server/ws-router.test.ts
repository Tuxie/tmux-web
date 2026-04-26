import { describe, test, expect } from 'bun:test';
import { routeClientMessage, type RouterState } from '../../../src/server/ws-router.js';

function state(overrides: Partial<RouterState> = {}): RouterState {
  return {
    currentSession: 'main',
    pendingReads: new Map(),
    ...overrides,
  };
}

describe('routeClientMessage', () => {
  test('non-JSON passes through as pty write', () => {
    expect(routeClientMessage('hello', state())).toEqual([{ type: 'pty-write', data: 'hello' }]);
  });

  test('JSON resize produces resize action', () => {
    expect(routeClientMessage('{"type":"resize","cols":80,"rows":24}', state()))
      .toEqual([{ type: 'pty-resize', cols: 80, rows: 24 }]);
  });

  test('JSON colour-variant dark → set-env action', () => {
    expect(routeClientMessage('{"type":"colour-variant","variant":"dark"}', state()))
      .toEqual([{ type: 'colour-variant', variant: 'dark' }]);
  });

  test('invalid colour-variant passes through as pty write', () => {
    const raw = '{"type":"colour-variant","variant":"neon"}';
    expect(routeClientMessage(raw, state())).toEqual([{ type: 'pty-write', data: raw }]);
  });

  test('window select action', () => {
    expect(routeClientMessage('{"type":"window","action":"select","index":"2"}', state()))
      .toEqual([{ type: 'window', action: 'select', index: '2', name: undefined }]);
  });

  test('session rename action', () => {
    expect(routeClientMessage('{"type":"session","action":"rename","name":"dev"}', state()))
      .toEqual([{ type: 'session', action: 'rename', name: 'dev' }]);
  });

  test('scrollbar line and page actions validate action and numeric count', () => {
    expect(routeClientMessage('{"type":"scrollbar","action":"line-up","count":3}', state()))
      .toEqual([{ type: 'scrollbar', action: 'line-up', count: 3, position: undefined }]);
    expect(routeClientMessage('{"type":"scrollbar","action":"line-down"}', state()))
      .toEqual([{ type: 'scrollbar', action: 'line-down', count: undefined, position: undefined }]);
    expect(routeClientMessage('{"type":"scrollbar","action":"page-up","count":12}', state()))
      .toEqual([{ type: 'scrollbar', action: 'page-up', count: 12, position: undefined }]);
    expect(routeClientMessage('{"type":"scrollbar","action":"page-down","count":"12"}', state()))
      .toEqual([{ type: 'scrollbar', action: 'page-down', count: undefined, position: undefined }]);
  });

  test('scrollbar drag validates numeric position', () => {
    expect(routeClientMessage('{"type":"scrollbar","action":"drag","position":41}', state()))
      .toEqual([{ type: 'scrollbar', action: 'drag', count: undefined, position: 41 }]);
    expect(routeClientMessage('{"type":"scrollbar","action":"drag","position":"41"}', state()))
      .toEqual([{ type: 'scrollbar', action: 'drag', count: undefined, position: undefined }]);
  });

  test('invalid scrollbar action passes through as pty write', () => {
    const raw = '{"type":"scrollbar","action":"jump","position":41}';
    expect(routeClientMessage(raw, state())).toEqual([{ type: 'pty-write', data: raw }]);
  });

  test('switch-session action', () => {
    expect(routeClientMessage('{"type":"switch-session","name":"dev"}', state()))
      .toEqual([{ type: 'switch-session', name: 'dev' }]);
  });

  test('switch-session with invalid name falls through as pty write', () => {
    const raw = '{"type":"switch-session","name":123}';
    expect(routeClientMessage(raw, state())).toEqual([{ type: 'pty-write', data: raw }]);
  });

  test('clipboard-decision deny removes pending and emits deny', () => {
    const st = state();
    st.pendingReads.set('r1', { selection: 'c', exePath: '/bin/vim', commandName: 'vim', session: 'main' });
    expect(routeClientMessage('{"type":"clipboard-decision","reqId":"r1","allow":false}', st))
      .toEqual([{ type: 'clipboard-deny', reqId: 'r1', selection: 'c', session: 'main' }]);
    expect(st.pendingReads.has('r1')).toBe(false);
  });

  test('clipboard-decision allow+persist emits grant + request-content', () => {
    const st = state();
    st.pendingReads.set('r2', { selection: 'c', exePath: '/bin/vim', commandName: 'vim', session: 'main' });
    const acts = routeClientMessage(
      '{"type":"clipboard-decision","reqId":"r2","allow":true,"persist":true,"expiresAt":null,"pinHash":false}', st);
    expect(acts).toContainEqual({ type: 'clipboard-grant-persist', reqId: 'r2', exePath: '/bin/vim', allow: true, expiresAt: null, pinHash: false, session: 'main' });
    expect(acts).toContainEqual({ type: 'clipboard-request-content', reqId: 'r2' });
    expect(st.pendingReads.get('r2')?.awaitingContent).toBe(true);
  });

  test('clipboard-decision allow without persist only emits request-content', () => {
    const st = state();
    st.pendingReads.set('r2b', { selection: 'c', exePath: '/bin/vim', commandName: 'vim', session: 'main' });
    const acts = routeClientMessage(
      '{"type":"clipboard-decision","reqId":"r2b","allow":true}', st);
    expect(acts).toEqual([{ type: 'clipboard-request-content', reqId: 'r2b' }]);
  });

  test('clipboard-decision persist with no exePath skips persist', () => {
    const st = state();
    st.pendingReads.set('r2c', { selection: 'c', exePath: null, commandName: null, session: 'main' });
    const acts = routeClientMessage(
      '{"type":"clipboard-decision","reqId":"r2c","allow":true,"persist":true}', st);
    expect(acts).toEqual([{ type: 'clipboard-request-content', reqId: 'r2c' }]);
  });

  test('clipboard-decision unknown reqId → empty actions', () => {
    expect(routeClientMessage('{"type":"clipboard-decision","reqId":"stale","allow":true}', state()))
      .toEqual([]);
  });

  test('clipboard-read-reply returns reply action with base64', () => {
    const st = state();
    st.pendingReads.set('r3', { selection: 'p', exePath: '/bin/foo', commandName: 'foo', session: 'main', awaitingContent: true });
    expect(routeClientMessage('{"type":"clipboard-read-reply","reqId":"r3","base64":"YWJj"}', st))
      .toEqual([{ type: 'clipboard-reply', selection: 'p', base64: 'YWJj', session: 'main' }]);
    expect(st.pendingReads.has('r3')).toBe(false);
  });

  test('clipboard-read-reply above the 64 KiB decoded cap is silently clipped to empty', () => {
    // Cap is on the base64 *string* length, picked so the decoded payload
    // stays ≤ 64 KiB (`4 * ceil(64*1024 / 3)` = 87384 chars). One char
    // beyond that must trip the silent-drop semantics — see cluster 03
    // (docs/code-analysis/2026-04-26).
    const st = state();
    st.pendingReads.set('r4', { selection: 'c', exePath: null, commandName: null, session: 'main', awaitingContent: true });
    const cap = 4 * Math.ceil((64 * 1024) / 3);
    const big = 'a'.repeat(cap + 1);
    expect(routeClientMessage(`{"type":"clipboard-read-reply","reqId":"r4","base64":"${big}"}`, st))
      .toEqual([{ type: 'clipboard-reply', selection: 'c', base64: '', session: 'main' }]);
  });

  test('clipboard-read-reply at the 64 KiB decoded cap is delivered untouched', () => {
    // Boundary: exactly at the cap → not clipped. Confirms the inequality
    // is strict (`> MAX_BASE64`) and the typical interactive clipboard
    // payload survives.
    const st = state();
    st.pendingReads.set('r4b', { selection: 'c', exePath: null, commandName: null, session: 'main', awaitingContent: true });
    const cap = 4 * Math.ceil((64 * 1024) / 3);
    const big = 'a'.repeat(cap);
    expect(routeClientMessage(`{"type":"clipboard-read-reply","reqId":"r4b","base64":"${big}"}`, st))
      .toEqual([{ type: 'clipboard-reply', selection: 'c', base64: big, session: 'main' }]);
  });

  test('clipboard-read-reply for non-awaiting entry is no-op', () => {
    const st = state();
    st.pendingReads.set('r5', { selection: 'c', exePath: null, commandName: null, session: 'main' });
    expect(routeClientMessage('{"type":"clipboard-read-reply","reqId":"r5","base64":"x"}', st))
      .toEqual([]);
  });

  test('OSC 52 read reply is delivered to the snapshotted session even after currentSession rotates mid-flight', () => {
    // Cluster 04, finding F2 (docs/code-analysis/2026-04-26):
    // an OSC title emitted between the read-request being recorded and
    // the client sending its base64 reply must NOT divert the bytes to
    // the rotated session's active pane. The router pins the delivery
    // target to `pending.session`, the snapshot taken at request-creation
    // time. This test simulates the race by rotating currentSession after
    // pendingReads.set but before the reply arrives, and asserts the
    // emitted clipboard-reply still carries the original session.
    const st = state({ currentSession: 'A' });
    st.pendingReads.set('rRace', {
      selection: 'c',
      exePath: '/bin/foo',
      commandName: 'foo',
      session: 'A',           // snapshot at request creation
      awaitingContent: true,
    });
    // Mid-flight rotation: an OSC title moved currentSession to B.
    st.currentSession = 'B';
    const acts = routeClientMessage(
      '{"type":"clipboard-read-reply","reqId":"rRace","base64":"aGk="}', st);
    expect(acts).toEqual([
      { type: 'clipboard-reply', selection: 'c', base64: 'aGk=', session: 'A' },
    ]);
  });

  test('clipboard-decision deny snapshots session at creation, not at decision time', () => {
    // F2 (deny path): even when the user denies the consent prompt, the
    // empty-reply OSC 52 response must hit the original session, not a
    // rotated one. Otherwise the deny would surface the empty-clipboard
    // sequence to a different pane than the one that requested it.
    const st = state({ currentSession: 'A' });
    st.pendingReads.set('rDenyRace', {
      selection: 'c',
      exePath: '/bin/foo',
      commandName: 'foo',
      session: 'A',
    });
    st.currentSession = 'B';
    const acts = routeClientMessage(
      '{"type":"clipboard-decision","reqId":"rDenyRace","allow":false}', st);
    expect(acts).toEqual([
      { type: 'clipboard-deny', reqId: 'rDenyRace', selection: 'c', session: 'A' },
    ]);
  });

  test('clipboard-decision allow+persist snapshots session for grant-persist action', () => {
    // F2 (persist path): an allow+persist decision must record the grant
    // against the snapshotted session — recording it against the rotated
    // currentSession would let an OSC title hijack a "persist forever for
    // session A" decision into "persist forever for session B".
    const st = state({ currentSession: 'A' });
    st.pendingReads.set('rPersistRace', {
      selection: 'c',
      exePath: '/bin/vim',
      commandName: 'vim',
      session: 'A',
    });
    st.currentSession = 'B';
    const acts = routeClientMessage(
      '{"type":"clipboard-decision","reqId":"rPersistRace","allow":true,"persist":true,"expiresAt":null,"pinHash":false}', st);
    expect(acts).toContainEqual({
      type: 'clipboard-grant-persist',
      reqId: 'rPersistRace',
      exePath: '/bin/vim',
      allow: true,
      expiresAt: null,
      pinHash: false,
      session: 'A',
    });
  });

  test('malformed JSON passes through as pty write', () => {
    expect(routeClientMessage('{not json', state())).toEqual([{ type: 'pty-write', data: '{not json' }]);
  });

  test('unknown JSON type passes through as pty write', () => {
    const raw = '{"type":"unknown"}';
    expect(routeClientMessage(raw, state())).toEqual([{ type: 'pty-write', data: raw }]);
  });
});
