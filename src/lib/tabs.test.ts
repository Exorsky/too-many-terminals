import { describe, expect, it } from 'vitest';
import { initialTabsState, tabsReducer, type TabsState } from './tabs';
import type { Tab } from '@/types';

function makeTab(id: string, overrides: Partial<Tab> = {}): Tab {
  return {
    id,
    kind: 'shell',
    name: id,
    shellId: 'powershell',
    cwd: 'C:\\Users\\x',
    resumeSessionId: null,
    exited: false,
    ...overrides,
  };
}

function stateWith(...ids: string[]): TabsState {
  return ids.reduce(
    (state, id) => tabsReducer(state, { type: 'add', tab: makeTab(id) }),
    initialTabsState,
  );
}

describe('tabsReducer', () => {
  it('add appends and activates the new tab', () => {
    const state = stateWith('a', 'b');
    expect(state.tabs.map((t) => t.id)).toEqual(['a', 'b']);
    expect(state.activeTabId).toBe('b');
  });

  it('select switches the active tab, ignoring unknown ids', () => {
    let state = stateWith('a', 'b');
    state = tabsReducer(state, { type: 'select', tabId: 'a' });
    expect(state.activeTabId).toBe('a');
    state = tabsReducer(state, { type: 'select', tabId: 'nope' });
    expect(state.activeTabId).toBe('a');
  });

  it('close of the active tab activates the next tab in its place', () => {
    let state = stateWith('a', 'b', 'c');
    state = tabsReducer(state, { type: 'select', tabId: 'b' });
    state = tabsReducer(state, { type: 'close', tabId: 'b' });
    expect(state.tabs.map((t) => t.id)).toEqual(['a', 'c']);
    expect(state.activeTabId).toBe('c');
  });

  it('close of the last tab falls back to the previous one', () => {
    let state = stateWith('a', 'b');
    state = tabsReducer(state, { type: 'close', tabId: 'b' });
    expect(state.activeTabId).toBe('a');
  });

  it('close of an inactive tab keeps the active one', () => {
    let state = stateWith('a', 'b');
    state = tabsReducer(state, { type: 'close', tabId: 'a' });
    expect(state.activeTabId).toBe('b');
  });

  it('closing the only tab leaves no active tab', () => {
    let state = stateWith('a');
    state = tabsReducer(state, { type: 'close', tabId: 'a' });
    expect(state.tabs).toEqual([]);
    expect(state.activeTabId).toBeNull();
  });

  it('rename changes only the named tab', () => {
    let state = stateWith('a', 'b');
    state = tabsReducer(state, { type: 'rename', tabId: 'a', name: 'renamed' });
    expect(state.tabs[0].name).toBe('renamed');
    expect(state.tabs[1].name).toBe('b');
  });

  it('exited marks the tab without removing it', () => {
    let state = stateWith('a');
    state = tabsReducer(state, { type: 'exited', tabId: 'a' });
    expect(state.tabs[0].exited).toBe(true);
    expect(state.tabs).toHaveLength(1);
  });

  it('sessionResolved records the learned session id on only that tab', () => {
    let state = stateWith('a', 'b');
    state = tabsReducer(state, { type: 'sessionResolved', tabId: 'a', sessionId: 'sess-1' });
    expect(state.tabs[0].resumeSessionId).toBe('sess-1');
    expect(state.tabs[1].resumeSessionId).toBeNull();
  });
});
