import { describe, expect, it } from 'vitest';
import { activeTabId, initialTabsState, sessionModeOf, tabsReducer, type TabsState } from './tabs';
import { activeContent, contentKey, findPane, panesOf, sessionContent, visibleSessionIds } from './panes';

/** Every tab on the grid, as keys, in pane order. */
function tabKeys(layout: Parameters<typeof panesOf>[0] extends never ? never : TabsState['layout']): string[] {
  return layout.panes.flatMap((p) => p.contents.map((c) => contentKey(c)!));
}
import type { SessionMode, Tab } from '@/types';

function makeTab(id: string, overrides: Partial<Tab> = {}): Tab {
  return {
    id,
    kind: 'shell',
    name: id,
    shellId: 'powershell',
    cwd: 'C:\\Users\\x',
    projectDir: null,
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
  it('add appends and selects the new session', () => {
    const state = stateWith('a', 'b');
    expect(state.tabs.map((t) => t.id)).toEqual(['a', 'b']);
    expect(activeTabId(state)).toBe('b');
  });

  it('add with select:false leaves the selection alone', () => {
    // How a restored workspace arrives: many sessions, none selected, so a
    // launch opens on Home rather than on whichever was saved last.
    const state = [makeTab('a'), makeTab('b')].reduce(
      (s, tab) => tabsReducer(s, { type: 'add', tab, select: false }),
      initialTabsState,
    );
    expect(state.tabs).toHaveLength(2);
    expect(activeTabId(state)).toBeNull();
  });

  it('closing a session takes its tab out and promotes the neighbour', () => {
    // A strip behaves the same whether a tab was closed or dragged away:
    // "next, else previous".
    const state = stateWith('a', 'b', 'c');
    const after = tabsReducer(tabsReducer(state, { type: 'select', tabId: 'b' }), { type: 'close', tabId: 'b' });
    expect(after.tabs.map((t) => t.id)).toEqual(['a', 'c']);
    expect(tabKeys(after.layout)).toEqual(['session:a:claude', 'session:c:claude']);
    expect(activeTabId(after)).toBe('c');
  });

  it('closing the last session leaves an empty pane showing Home', () => {
    const after = tabsReducer(stateWith('a'), { type: 'close', tabId: 'a' });
    expect(activeTabId(after)).toBeNull();
    expect(panesOf(after.layout.grid)).toHaveLength(1);
    expect(after.layout.panes[0].contents).toEqual([]);
  });

  it('closing a session that is not on screen changes nothing on screen', () => {
    const state = stateWith('a', 'b');
    const after = tabsReducer(state, { type: 'close', tabId: 'a' });
    expect(activeTabId(after)).toBe('b');
  });

  it('selecting an unknown id is a no-op', () => {
    const state = stateWith('a');
    expect(tabsReducer(state, { type: 'select', tabId: 'nope' })).toBe(state);
  });

  it('selecting a just-finished session clears the mark', () => {
    let state = stateWith('a');
    state = tabsReducer(state, { type: 'status', tabId: 'a', status: 'working' });
    state = tabsReducer(state, { type: 'status', tabId: 'a', status: 'idle' });
    expect(state.tabs[0].justFinished).toBe(true);
    state = tabsReducer(state, { type: 'select', tabId: 'a' });
    expect(state.tabs[0].justFinished).toBe(false);
  });

  it('only working -> idle counts as just finished', () => {
    let state = stateWith('a');
    state = tabsReducer(state, { type: 'status', tabId: 'a', status: 'idle' });
    expect(state.tabs[0].justFinished).toBe(false);
  });

  it('an activity detail is dropped as soon as the session stops working', () => {
    let state = stateWith('a');
    state = tabsReducer(state, { type: 'status', tabId: 'a', status: 'working', detail: 'editing x.ts' });
    expect(state.tabs[0].statusDetail).toBe('editing x.ts');
    state = tabsReducer(state, { type: 'status', tabId: 'a', status: 'idle' });
    expect(state.tabs[0].statusDetail).toBeUndefined();
  });

  it('an interrupt only moves a working claude session', () => {
    let state = tabsReducer(initialTabsState, { type: 'add', tab: makeTab('c', { kind: 'claude' }) });
    state = tabsReducer(state, { type: 'status', tabId: 'c', status: 'working' });
    state = tabsReducer(state, { type: 'interrupt', tabId: 'c' });
    expect(state.tabs[0].status).toBe('requires_response');

    // A shell session has no Claude status to reinterpret.
    let shell = stateWith('s');
    shell = tabsReducer(shell, { type: 'status', tabId: 's', status: 'working' });
    shell = tabsReducer(shell, { type: 'interrupt', tabId: 's' });
    expect(shell.tabs[0].status).toBe('working');
  });

  it('setProject files a session without touching its working directory', () => {
    // The whole point of the two fields: moving a scratch session into a
    // project must never move the directory a live Claude process is in.
    let state = tabsReducer(initialTabsState, {
      type: 'add',
      tab: makeTab('a', { kind: 'claude', cwd: '/home/u/.tmt/scratch/abc' }),
    });
    state = tabsReducer(state, { type: 'setProject', tabId: 'a', projectDir: '/proj' });
    expect(state.tabs[0].projectDir).toBe('/proj');
    expect(state.tabs[0].cwd).toBe('/home/u/.tmt/scratch/abc');

    state = tabsReducer(state, { type: 'setProject', tabId: 'a', projectDir: null });
    expect(state.tabs[0].projectDir).toBeNull();
    expect(state.tabs[0].cwd).toBe('/home/u/.tmt/scratch/abc');
  });

  it('archiving sleeps the session and takes its tabs off the grid', () => {
    const state = stateWith('a', 'b');
    const after = tabsReducer(state, { type: 'archive', tabId: 'b', archived: true });
    expect(after.tabs[1].archived).toBe(true);
    expect(after.tabs[1].dormant).toBe(true);
    expect(tabKeys(after.layout)).toEqual(['session:a:claude']);
    // The session itself is still there — archive is not close.
    expect(after.tabs).toHaveLength(2);
  });

  it('unarchiving leaves the selection alone', () => {
    let state = tabsReducer(stateWith('a', 'b'), { type: 'archive', tabId: 'b', archived: true });
    state = tabsReducer(state, { type: 'select', tabId: 'a' });
    state = tabsReducer(state, { type: 'archive', tabId: 'b', archived: false });
    expect(state.tabs[1].archived).toBe(false);
    expect(activeTabId(state)).toBe('a');
  });

  it('sleep and wake flip dormancy without losing the session', () => {
    let state = stateWith('a');
    state = tabsReducer(state, { type: 'sleep', tabId: 'a' });
    expect(state.tabs[0]).toMatchObject({ dormant: true, exited: false });
    state = tabsReducer(state, { type: 'wake', tabId: 'a' });
    expect(state.tabs[0].dormant).toBe(false);
  });
});

describe('sessionModeOf', () => {
  const modes = new Map<string, SessionMode>([['a', 'split']]);

  it('is terminal for a session with no transcript to read', () => {
    const tab = makeTab('a', { kind: 'claude', resumeSessionId: null });
    expect(sessionModeOf(tab, modes, true)).toBe('terminal');
  });

  it('is terminal when the preference is off, whatever was stored', () => {
    const tab = makeTab('a', { kind: 'claude', resumeSessionId: 'sess' });
    expect(sessionModeOf(tab, modes, false)).toBe('terminal');
  });

  it('returns the stored mode for a readable session', () => {
    const tab = makeTab('a', { kind: 'claude', resumeSessionId: 'sess' });
    expect(sessionModeOf(tab, modes, true)).toBe('split');
  });

  it('defaults to terminal for a readable session with nothing stored', () => {
    const tab = makeTab('b', { kind: 'claude', resumeSessionId: 'sess' });
    expect(sessionModeOf(tab, modes, true)).toBe('terminal');
  });

  it('is terminal for nothing at all', () => {
    expect(sessionModeOf(null, modes, true)).toBe('terminal');
  });
});

describe('the pane grid, through the reducer', () => {
  it('brings a selected session to the front of the focused pane', () => {
    const state = stateWith('a', 'b');
    expect(activeTabId(tabsReducer(state, { type: 'select', tabId: 'a' }))).toBe('a');
  });

  it('splits a session into its own pane, and both stay on screen', () => {
    let state = stateWith('a', 'b');
    state = tabsReducer(state, { type: 'select', tabId: 'a' });
    const paneId = state.layout.focusedPaneId;
    state = tabsReducer(state, { type: 'splitTo', content: sessionContent('b'), paneId, edge: 'right' });

    expect(panesOf(state.layout.grid)).toHaveLength(2);
    expect([...visibleSessionIds(state.layout)].sort()).toEqual(['a', 'b']);
    // Focus follows the tab you just placed.
    expect(activeTabId(state)).toBe('b');
  });

  it('never shows one session in two panes at once', () => {
    // A terminal's DOM node is singular: showing it twice would blank one.
    let state = stateWith('a', 'b');
    state = tabsReducer(state, { type: 'select', tabId: 'a' });
    const first = state.layout.focusedPaneId;
    state = tabsReducer(state, { type: 'splitTo', content: sessionContent('b'), paneId: first, edge: 'right' });
    const second = state.layout.focusedPaneId;
    state = tabsReducer(state, { type: 'showIn', content: sessionContent('a'), paneId: second });

    expect([...visibleSessionIds(state.layout)]).toEqual(['a']);
    // The pane 'a' left behind had nothing else to show, so it collapsed.
    expect(panesOf(state.layout.grid)).toHaveLength(1);
  });

  it('closing a pane leaves its session open', () => {
    let state = stateWith('a', 'b');
    state = tabsReducer(state, { type: 'select', tabId: 'a' });
    const first = state.layout.focusedPaneId;
    state = tabsReducer(state, { type: 'splitTo', content: sessionContent('b'), paneId: first, edge: 'right' });
    state = tabsReducer(state, { type: 'closePane', paneId: state.layout.focusedPaneId });

    expect(panesOf(state.layout.grid)).toHaveLength(1);
    expect(state.tabs.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('holds four sessions at once and no more', () => {
    let state = stateWith('a', 'b', 'c', 'd', 'e');
    state = tabsReducer(state, { type: 'select', tabId: 'a' });
    const p1 = state.layout.focusedPaneId;
    state = tabsReducer(state, { type: 'splitTo', content: sessionContent('b'), paneId: p1, edge: 'right' });
    const p2 = state.layout.focusedPaneId;
    state = tabsReducer(state, { type: 'splitTo', content: sessionContent('c'), paneId: p1, edge: 'bottom' });
    state = tabsReducer(state, { type: 'splitTo', content: sessionContent('d'), paneId: p2, edge: 'bottom' });
    expect(panesOf(state.layout.grid)).toHaveLength(4);
    expect([...visibleSessionIds(state.layout)].sort()).toEqual(['a', 'b', 'c', 'd']);

    // A fifth has nowhere to go, so it takes over the pane it was dropped on
    // rather than failing. Degrading beats an error the UI has to explain.
    state = tabsReducer(state, { type: 'splitTo', content: sessionContent('e'), paneId: p1, edge: 'right' });
    expect(panesOf(state.layout.grid)).toHaveLength(4);
    expect(visibleSessionIds(state.layout).has('e')).toBe(true);
    expect(visibleSessionIds(state.layout).has('a')).toBe(false);
  });

  it('a seam is clamped so a pane can never be dragged to nothing', () => {
    const state = tabsReducer(stateWith('a'), { type: 'seam', axis: 'col', frac: 0.99 });
    expect(state.layout.colFrac).toBeLessThanOrEqual(0.85);
  });
});

describe('a session in two panes at once', () => {
  it('puts Claude and its own shell side by side', () => {
    // The thing the grid is actually for. These are different ptys — `id` and
    // `id::shell` — so they are different DOM and may both be on screen.
    let state = stateWith('a');
    state = tabsReducer(state, { type: 'select', tabId: 'a' });
    const paneId = state.layout.focusedPaneId;
    state = tabsReducer(state, { type: 'splitTo', content: sessionContent('a', 'shell'), paneId, edge: 'right' });

    expect(panesOf(state.layout.grid)).toHaveLength(2);
    expect(tabKeys(state.layout).sort()).toEqual(['session:a:claude', 'session:a:shell']);
  });

  it('a third pane can hold the same session’s files', () => {
    let state = stateWith('a');
    state = tabsReducer(state, { type: 'select', tabId: 'a' });
    const p1 = state.layout.focusedPaneId;
    state = tabsReducer(state, { type: 'splitTo', content: sessionContent('a', 'shell'), paneId: p1, edge: 'right' });
    state = tabsReducer(state, { type: 'splitTo', content: sessionContent('a', 'files'), paneId: p1, edge: 'bottom' });

    expect(panesOf(state.layout.grid)).toHaveLength(3);
    expect(tabKeys(state.layout).sort())
      .toEqual(['session:a:claude', 'session:a:files', 'session:a:shell']);
    // Still one session, so still one row in the sidebar.
    expect([...visibleSessionIds(state.layout)]).toEqual(['a']);
  });
});

describe('the workspace as a canvas', () => {
  const file = { kind: 'file' as const, dir: '/proj', path: '/proj/src/App.tsx' };

  it('holds a file that belongs to no session', () => {
    // The thing "drag it out of the explorer onto the workspace" needs: a file
    // is content in its own right, not a property of whatever it sits beside.
    let state = stateWith('a');
    state = tabsReducer(state, { type: 'select', tabId: 'a' });
    state = tabsReducer(state, { type: 'addToWorkspace', content: file });

    // Added as a tab of the pane you were in — not a split, which is what
    // dragging is for.
    expect(panesOf(state.layout.grid)).toHaveLength(1);
    expect(tabKeys(state.layout)).toEqual(['session:a:claude', 'file:/proj/src/App.tsx']);
    // A file is not a session, so nothing about the session list changes. It
    // is the active tab now, so no session is painted.
    expect([...visibleSessionIds(state.layout)]).toEqual([]);
  });

  it('places things without being asked where', () => {
    // "Add to workspace" is one click and costs no geometry: it becomes a tab
    // of the pane you're in. Splitting is what dragging is for.
    let state = stateWith('a', 'b');
    state = tabsReducer(state, { type: 'select', tabId: 'a' });
    state = tabsReducer(state, { type: 'addToWorkspace', content: file });

    expect(panesOf(state.layout.grid)).toHaveLength(1);
    expect(tabKeys(state.layout)).toEqual([
      'session:a:claude', 'session:b:claude', 'file:/proj/src/App.tsx',
    ]);
  });

  it('brings back what is already open instead of duplicating it', () => {
    let state = stateWith('a');
    state = tabsReducer(state, { type: 'select', tabId: 'a' });
    state = tabsReducer(state, { type: 'addToWorkspace', content: file });
    state = tabsReducer(state, { type: 'select', tabId: 'a' });
    state = tabsReducer(state, { type: 'addToWorkspace', content: file });

    expect(tabKeys(state.layout)).toEqual(['session:a:claude', 'file:/proj/src/App.tsx']);
    expect(contentKey(activeContent(findPane(state.layout, state.layout.focusedPaneId))))
      .toBe('file:/proj/src/App.tsx');
  });

  it('a file outlives the session it was opened next to', () => {
    let state = stateWith('a');
    state = tabsReducer(state, { type: 'select', tabId: 'a' });
    state = tabsReducer(state, { type: 'addToWorkspace', content: file });
    state = tabsReducer(state, { type: 'close', tabId: 'a' });

    expect(panesOf(state.layout.grid)).toHaveLength(1);
    expect(tabKeys(state.layout)).toEqual(['file:/proj/src/App.tsx']);
  });
});

describe('tabs in a strip', () => {
  it('a session opened from the sidebar becomes a tab of the focused pane', () => {
    let state = stateWith('a');
    state = tabsReducer(state, { type: 'select', tabId: 'a' });
    const paneId = state.layout.focusedPaneId;
    state = tabsReducer(state, { type: 'showIn', content: sessionContent('a', 'shell'), paneId });

    expect(panesOf(state.layout.grid)).toHaveLength(1);
    expect(tabKeys(state.layout)).toEqual(['session:a:claude', 'session:a:shell']);
  });

  it('a tab dropped before another lands in that position', () => {
    let state = stateWith('a', 'b', 'c');
    const paneId = state.layout.focusedPaneId;
    state = tabsReducer(state, {
      type: 'showIn', content: sessionContent('c'), paneId, beforeKey: 'session:a:claude',
    });
    expect(tabKeys(state.layout))
      .toEqual(['session:c:claude', 'session:a:claude', 'session:b:claude']);
  });

  it('closing a tab leaves the session open', () => {
    let state = stateWith('a', 'b');
    state = tabsReducer(state, { type: 'closeTab', key: 'session:a:claude' });
    expect(tabKeys(state.layout)).toEqual(['session:b:claude']);
    // The session is still in the list, still running.
    expect(state.tabs.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('dragging a tab out of a one-tab pane collapses that pane', () => {
    let state = stateWith('a', 'b');
    state = tabsReducer(state, { type: 'select', tabId: 'a' });
    const left = state.layout.focusedPaneId;
    state = tabsReducer(state, { type: 'splitTo', content: sessionContent('b'), paneId: left, edge: 'right' });
    expect(panesOf(state.layout.grid)).toHaveLength(2);

    // Drag it back into the left pane's strip: the right pane has nothing
    // left to show, so it goes.
    state = tabsReducer(state, { type: 'showIn', content: sessionContent('b'), paneId: left });
    expect(panesOf(state.layout.grid)).toHaveLength(1);
    expect(tabKeys(state.layout)).toEqual(['session:a:claude', 'session:b:claude']);
  });
});
