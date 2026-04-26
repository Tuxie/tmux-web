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
    st.pendingReads.set('r1', { selection: 'c', exePath: '/bin/vim', commandName: 'vim' });
    expect(routeClientMessage('{"type":"clipboard-decision","reqId":"r1","allow":false}', st))
      .toEqual([{ type: 'clipboard-deny', reqId: 'r1', selection: 'c' }]);
    expect(st.pendingReads.has('r1')).toBe(false);
  });

  test('clipboard-decision allow+persist emits grant + request-content', () => {
    const st = state();
    st.pendingReads.set('r2', { selection: 'c', exePath: '/bin/vim', commandName: 'vim' });
    const acts = routeClientMessage(
      '{"type":"clipboard-decision","reqId":"r2","allow":true,"persist":true,"expiresAt":null,"pinHash":false}', st);
    expect(acts).toContainEqual({ type: 'clipboard-grant-persist', reqId: 'r2', exePath: '/bin/vim', allow: true, expiresAt: null, pinHash: false });
    expect(acts).toContainEqual({ type: 'clipboard-request-content', reqId: 'r2' });
    expect(st.pendingReads.get('r2')?.awaitingContent).toBe(true);
  });

  test('clipboard-decision allow without persist only emits request-content', () => {
    const st = state();
    st.pendingReads.set('r2b', { selection: 'c', exePath: '/bin/vim', commandName: 'vim' });
    const acts = routeClientMessage(
      '{"type":"clipboard-decision","reqId":"r2b","allow":true}', st);
    expect(acts).toEqual([{ type: 'clipboard-request-content', reqId: 'r2b' }]);
  });

  test('clipboard-decision persist with no exePath skips persist', () => {
    const st = state();
    st.pendingReads.set('r2c', { selection: 'c', exePath: null, commandName: null });
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
    st.pendingReads.set('r3', { selection: 'p', exePath: '/bin/foo', commandName: 'foo', awaitingContent: true });
    expect(routeClientMessage('{"type":"clipboard-read-reply","reqId":"r3","base64":"YWJj"}', st))
      .toEqual([{ type: 'clipboard-reply', selection: 'p', base64: 'YWJj' }]);
    expect(st.pendingReads.has('r3')).toBe(false);
  });

  test('clipboard-read-reply above the 64 KiB decoded cap is silently clipped to empty', () => {
    // Cap is on the base64 *string* length, picked so the decoded payload
    // stays ≤ 64 KiB (`4 * ceil(64*1024 / 3)` = 87384 chars). One char
    // beyond that must trip the silent-drop semantics — see cluster 03
    // (docs/code-analysis/2026-04-26).
    const st = state();
    st.pendingReads.set('r4', { selection: 'c', exePath: null, commandName: null, awaitingContent: true });
    const cap = 4 * Math.ceil((64 * 1024) / 3);
    const big = 'a'.repeat(cap + 1);
    expect(routeClientMessage(`{"type":"clipboard-read-reply","reqId":"r4","base64":"${big}"}`, st))
      .toEqual([{ type: 'clipboard-reply', selection: 'c', base64: '' }]);
  });

  test('clipboard-read-reply at the 64 KiB decoded cap is delivered untouched', () => {
    // Boundary: exactly at the cap → not clipped. Confirms the inequality
    // is strict (`> MAX_BASE64`) and the typical interactive clipboard
    // payload survives.
    const st = state();
    st.pendingReads.set('r4b', { selection: 'c', exePath: null, commandName: null, awaitingContent: true });
    const cap = 4 * Math.ceil((64 * 1024) / 3);
    const big = 'a'.repeat(cap);
    expect(routeClientMessage(`{"type":"clipboard-read-reply","reqId":"r4b","base64":"${big}"}`, st))
      .toEqual([{ type: 'clipboard-reply', selection: 'c', base64: big }]);
  });

  test('clipboard-read-reply for non-awaiting entry is no-op', () => {
    const st = state();
    st.pendingReads.set('r5', { selection: 'c', exePath: null, commandName: null });
    expect(routeClientMessage('{"type":"clipboard-read-reply","reqId":"r5","base64":"x"}', st))
      .toEqual([]);
  });

  test('malformed JSON passes through as pty write', () => {
    expect(routeClientMessage('{not json', state())).toEqual([{ type: 'pty-write', data: '{not json' }]);
  });

  test('unknown JSON type passes through as pty write', () => {
    const raw = '{"type":"unknown"}';
    expect(routeClientMessage(raw, state())).toEqual([{ type: 'pty-write', data: raw }]);
  });
});
