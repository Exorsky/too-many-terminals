import { describe, expect, it } from 'vitest';
import { activeTabId, initialTabsState, learnSessionNames, tabBarTabs, tabsReducer, type TabsState } from './tabs';
import { focusedPane, panesOf, paneOfTab, visibleTabIds } from './panes';
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
    expect(activeTabId(state)).toBe('b');
  });

  it('select switches the active tab, ignoring unknown ids', () => {
    let state = stateWith('a', 'b');
    state = tabsReducer(state, { type: 'select', tabId: 'a' });
    expect(activeTabId(state)).toBe('a');
    state = tabsReducer(state, { type: 'select', tabId: 'nope' });
    expect(activeTabId(state)).toBe('a');
  });

  it('close of the active tab activates the next tab in its place', () => {
    let state = stateWith('a', 'b', 'c');
    state = tabsReducer(state, { type: 'select', tabId: 'b' });
    state = tabsReducer(state, { type: 'close', tabId: 'b' });
    expect(state.tabs.map((t) => t.id)).toEqual(['a', 'c']);
    expect(activeTabId(state)).toBe('c');
  });

  it('close of the last tab falls back to the previous one', () => {
    let state = stateWith('a', 'b');
    state = tabsReducer(state, { type: 'close', tabId: 'b' });
    expect(activeTabId(state)).toBe('a');
  });

  it('close of an inactive tab keeps the active one', () => {
    let state = stateWith('a', 'b');
    state = tabsReducer(state, { type: 'close', tabId: 'a' });
    expect(activeTabId(state)).toBe('b');
  });

  it('closing the only tab leaves no active tab', () => {
    let state = stateWith('a');
    state = tabsReducer(state, { type: 'close', tabId: 'a' });
    expect(state.tabs).toEqual([]);
    expect(activeTabId(state)).toBeNull();
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
});

describe('tabBarTabs', () => {
  const claudeTab = makeTab('claude-1', { kind: 'claude' });
  const shellTab = makeTab('shell-1', { kind: 'shell' });
  const fileA = makeTab('file-a', { kind: 'file', path: '/proj/a.md' });

  it('shows nothing until a tab has been opened', () => {
    expect(tabBarTabs([claudeTab, shellTab], [])).toEqual([]);
  });

  it('keeps the order tabs were opened in, not the sidebar order', () => {
    expect(tabBarTabs([claudeTab, shellTab, fileA], ['file-a', 'claude-1'])).toEqual([fileA, claudeTab]);
  });

  it('drops an id whose tab is gone', () => {
    expect(tabBarTabs([claudeTab], ['claude-1', 'closed-one'])).toEqual([claudeTab]);
  });
});

describe('tabsReducer pane grid', () => {
  it('add drops the new tab into the focused pane', () => {
    const state = stateWith('a', 'b');
    expect(focusedPane(state.layout).tabIds).toEqual(['a', 'b']);
    expect(focusedPane(state.layout).activeTabId).toBe('b');
  });

  it('splitTab puts the tab alone in a new pane and focuses it', () => {
    let state = stateWith('a', 'b');
    const pane = state.layout.focusedPaneId;
    state = tabsReducer(state, { type: 'splitTab', tabId: 'b', paneId: pane, edge: 'right' });
    expect(panesOf(state.layout.grid)).toHaveLength(2);
    expect(focusedPane(state.layout).tabIds).toEqual(['b']);
    // Both panes are on screen now, not just the focused one.
    expect(visibleTabIds(state.layout)).toEqual(new Set(['a', 'b']));
  });

  it('select focuses the pane a tab already lives in rather than moving it', () => {
    let state = stateWith('a', 'b');
    const left = state.layout.focusedPaneId;
    state = tabsReducer(state, { type: 'splitTab', tabId: 'b', paneId: left, edge: 'right' });
    const right = state.layout.focusedPaneId;

    state = tabsReducer(state, { type: 'select', tabId: 'a' });
    expect(state.layout.focusedPaneId).toBe(left);
    expect(paneOfTab(state.layout, 'a')?.id).toBe(left);

    state = tabsReducer(state, { type: 'select', tabId: 'b' });
    expect(state.layout.focusedPaneId).toBe(right);
  });

  it('closing the last tab in a pane collapses it', () => {
    let state = stateWith('a', 'b');
    state = tabsReducer(state, { type: 'splitTab', tabId: 'b', paneId: state.layout.focusedPaneId, edge: 'right' });
    expect(panesOf(state.layout.grid)).toHaveLength(2);

    state = tabsReducer(state, { type: 'close', tabId: 'b' });
    expect(panesOf(state.layout.grid)).toHaveLength(1);
    expect(state.tabs.map((t) => t.id)).toEqual(['a']);
  });

  it('removeFromPane takes a tab off the grid but keeps it open', () => {
    let state = stateWith('a', 'b');
    state = tabsReducer(state, { type: 'removeFromPane', tabId: 'b' });
    expect(focusedPane(state.layout).tabIds).toEqual(['a']);
    expect(state.tabs.map((t) => t.id)).toEqual(['a', 'b']); // still open
  });

  it('seam clamps so a pane never vanishes', () => {
    let state = stateWith('a');
    state = tabsReducer(state, { type: 'seam', axis: 'col', frac: 0.99 });
    expect(state.layout.colFrac).toBe(0.85);
  });
});

describe('learnSessionNames', () => {
  const named = makeTab('t1', { kind: 'claude', name: 'Отладка settings', resumeSessionId: 'sess-1' });

  it('records a claude tab\'s name against its session id', () => {
    expect(learnSessionNames({}, [named])).toEqual({ 'sess-1': 'Отладка settings' });
  });

  it('keeps names of sessions whose tabs are gone', () => {
    // The whole reason this lives outside the tab list: History still has to
    // name a session hours after its tab was closed.
    expect(learnSessionNames({ 'sess-old': 'A closed session' }, [named])).toEqual({
      'sess-old': 'A closed session',
      'sess-1': 'Отладка settings',
    });
  });

  it('ignores the unnamed placeholder, shell tabs, and tabs with no session yet', () => {
    const fresh = makeTab('t2', { kind: 'claude', name: 'Claude', resumeSessionId: 'sess-2' });
    const shell = makeTab('t3', { name: 'PowerShell', resumeSessionId: 'sess-3' });
    const pending = makeTab('t4', { kind: 'claude', name: 'Real name', resumeSessionId: null });
    expect(learnSessionNames({}, [fresh, shell, pending])).toEqual({});
  });

  it('returns the same object when nothing is new, so state does not churn', () => {
    const prev = { 'sess-1': 'Отладка settings' };
    expect(learnSessionNames(prev, [named])).toBe(prev);
  });

  it('a rename overwrites the old name', () => {
    const renamed = makeTab('t1', { kind: 'claude', name: 'New name', resumeSessionId: 'sess-1' });
    expect(learnSessionNames({ 'sess-1': 'Old name' }, [renamed])).toEqual({ 'sess-1': 'New name' });
  });
});
