import { describe, expect, it } from 'vitest';
import { initialTabsState, tabBarTabs, tabsReducer, type TabsState } from './tabs';
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
    status: 'new',
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

  it('status updates only the named tab, leaving others untouched', () => {
    let state = stateWith('a', 'b');
    state = tabsReducer(state, { type: 'status', tabId: 'a', status: 'working' });
    expect(state.tabs[0].status).toBe('working');
    expect(state.tabs[1].status).toBe('new');

    state = tabsReducer(state, { type: 'status', tabId: 'a', status: 'requires_response' });
    expect(state.tabs[0].status).toBe('requires_response');
  });

  it('status stamps statusChangedAt on every transition', () => {
    let state = stateWith('a');
    const before = Date.now();
    state = tabsReducer(state, { type: 'status', tabId: 'a', status: 'working' });
    expect(state.tabs[0].statusChangedAt).toBeGreaterThanOrEqual(before);
  });

  it('status marks justFinished only on a working -> idle transition', () => {
    let state = stateWith('a');
    // new -> idle isn't a completion (no work happened).
    state = tabsReducer(state, { type: 'status', tabId: 'a', status: 'idle' });
    expect(state.tabs[0].justFinished).toBe(false);

    state = tabsReducer(state, { type: 'status', tabId: 'a', status: 'working' });
    state = tabsReducer(state, { type: 'status', tabId: 'a', status: 'idle' });
    expect(state.tabs[0].justFinished).toBe(true);

    // Starting new work clears it again.
    state = tabsReducer(state, { type: 'status', tabId: 'a', status: 'working' });
    expect(state.tabs[0].justFinished).toBe(false);
  });

  it('interrupt flips a working claude tab to requires_response', () => {
    let state = initialTabsState;
    state = tabsReducer(state, { type: 'add', tab: makeTab('a', { kind: 'claude', status: 'working' }) });
    state = tabsReducer(state, { type: 'interrupt', tabId: 'a' });
    expect(state.tabs[0].status).toBe('requires_response');
    expect(state.tabs[0].statusChangedAt).toBeDefined();
  });

  it('interrupt is a no-op on a tab that is not a working claude tab', () => {
    let state = initialTabsState;
    state = tabsReducer(state, { type: 'add', tab: makeTab('shell', { kind: 'shell', status: 'working' }) });
    state = tabsReducer(state, { type: 'add', tab: makeTab('idle-claude', { kind: 'claude', status: 'idle' }) });
    state = tabsReducer(state, { type: 'interrupt', tabId: 'shell' });
    state = tabsReducer(state, { type: 'interrupt', tabId: 'idle-claude' });
    expect(state.tabs[0].status).toBe('working'); // shell untouched
    expect(state.tabs[1].status).toBe('idle'); // already-idle claude untouched
  });

  it('select clears justFinished on the tab it activates (seen)', () => {
    let state = stateWith('a');
    state = tabsReducer(state, { type: 'status', tabId: 'a', status: 'working' });
    state = tabsReducer(state, { type: 'status', tabId: 'a', status: 'idle' });
    expect(state.tabs[0].justFinished).toBe(true);

    state = tabsReducer(state, { type: 'select', tabId: 'a' });
    expect(state.tabs[0].justFinished).toBe(false);
  });

  it('wake clears the dormant flag on only the named tab', () => {
    let state = initialTabsState;
    state = tabsReducer(state, { type: 'add', tab: makeTab('a', { dormant: true }) });
    state = tabsReducer(state, { type: 'add', tab: makeTab('b', { dormant: true }) });
    state = tabsReducer(state, { type: 'wake', tabId: 'a' });
    expect(state.tabs[0].dormant).toBe(false);
    expect(state.tabs[1].dormant).toBe(true);
  });

  it('sleep marks the tab dormant and clears any exited flag', () => {
    let state = initialTabsState;
    state = tabsReducer(state, { type: 'add', tab: makeTab('a', { kind: 'claude', status: 'idle', exited: true }) });
    state = tabsReducer(state, { type: 'sleep', tabId: 'a' });
    expect(state.tabs[0].dormant).toBe(true);
    expect(state.tabs[0].exited).toBe(false);
  });

  it('dirty updates only the named tab', () => {
    let state = stateWith('a', 'b');
    state = tabsReducer(state, { type: 'dirty', tabId: 'a', dirty: true });
    expect(state.tabs[0].dirty).toBe(true);
    expect(state.tabs[1].dirty).toBeUndefined();

    state = tabsReducer(state, { type: 'dirty', tabId: 'a', dirty: false });
    expect(state.tabs[0].dirty).toBe(false);
  });

  it('pin updates only the named tab, leaving others untouched', () => {
    let state = stateWith('a', 'b');
    state = tabsReducer(state, { type: 'pin', tabId: 'a', pinned: true });
    expect(state.tabs[0].pinned).toBe(true);
    expect(state.tabs[1].pinned).toBeUndefined();

    state = tabsReducer(state, { type: 'pin', tabId: 'a', pinned: false });
    expect(state.tabs[0].pinned).toBe(false);
  });

  it('reorderTab drops before or after the target within its folder', () => {
    let state = stateWith('a', 'b', 'c');
    // "after c" lands a at the end — a plain insert-before couldn't reach it.
    state = tabsReducer(state, { type: 'reorderTab', tabId: 'a', targetId: 'c', position: 'after' });
    expect(state.tabs.map((t) => t.id)).toEqual(['b', 'c', 'a']);

    state = tabsReducer(state, { type: 'reorderTab', tabId: 'a', targetId: 'b', position: 'before' });
    expect(state.tabs.map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('reorderTab is a no-op onto itself or unknown ids', () => {
    const state = stateWith('a', 'b');
    expect(tabsReducer(state, { type: 'reorderTab', tabId: 'a', targetId: 'a', position: 'before' })).toBe(state);
    expect(tabsReducer(state, { type: 'reorderTab', tabId: 'a', targetId: 'nope', position: 'after' })).toBe(state);
  });

  it('reorderTab never moves a tab across folders', () => {
    let state = initialTabsState;
    state = tabsReducer(state, { type: 'add', tab: makeTab('a', { cwd: '/one' }) });
    state = tabsReducer(state, { type: 'add', tab: makeTab('b', { cwd: '/two' }) });
    // Dropping a (/one) onto b (/two) is refused — order is unchanged.
    const next = tabsReducer(state, { type: 'reorderTab', tabId: 'a', targetId: 'b', position: 'before' });
    expect(next).toBe(state);
    expect(next.tabs.map((t) => t.id)).toEqual(['a', 'b']);
  });
});

describe('tabBarTabs', () => {
  const claudeTab = makeTab('claude-1', { kind: 'claude' });
  const shellTab = makeTab('shell-1', { kind: 'shell' });
  const fileA = makeTab('file-a', { kind: 'file', path: '/proj/a.md' });
  const fileB = makeTab('file-b', { kind: 'file', path: '/proj/b.md' });

  it('lists every file tab when there is no last session', () => {
    expect(tabBarTabs([fileA, fileB, claudeTab], null)).toEqual([fileA, fileB]);
  });

  it('puts the last session tab first, ahead of the file tabs', () => {
    expect(tabBarTabs([fileA, claudeTab, fileB], 'claude-1')).toEqual([claudeTab, fileA, fileB]);
  });

  it('drops the session slot once that tab is closed', () => {
    expect(tabBarTabs([fileA, shellTab], 'claude-1')).toEqual([fileA]);
  });

  it('never shows a file tab in the session slot', () => {
    expect(tabBarTabs([fileA], 'file-a')).toEqual([fileA]);
  });
});
