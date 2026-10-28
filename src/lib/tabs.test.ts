import { describe, expect, it } from 'vitest';
import {
  activeTabId, currentLayout, initialTabsState, sessionModeOf, tabsReducer, type TabsState,
} from './tabs';
import { activeContent, contentKey, findPane, panesOf, sessionContent, visibleSessionIds, type Layout } from './panes';

/** Every view in a layout, as keys, in pane order. */
function viewKeys(layout: Layout): string[] {
  return layout.panes.flatMap((p) => p.contents.map((c) => contentKey(c)!));
}

/** The current tab's views. */
function onScreen(state: TabsState): string[] {
  return viewKeys(currentLayout(state));
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
  it('autoName names an unnamed session but never replaces a given name', () => {
    let state = tabsReducer(initialTabsState, { type: 'add', tab: makeTab('a', { name: 'Claude' }) });
    state = tabsReducer(state, { type: 'add', tab: makeTab('b', { name: 'ABC-29789 migration' }) });
    state = tabsReducer(state, { type: 'autoName', tabId: 'a', name: 'Fix login' });
    state = tabsReducer(state, { type: 'autoName', tabId: 'b', name: 'Billing move' });
    expect(state.tabs.map((t) => t.name)).toEqual(['Fix login', 'ABC-29789 migration']);
  });

  it('add appends and selects the new session', () => {
    const state = stateWith('a', 'b');
    expect(state.tabs.map((t) => t.id)).toEqual(['a', 'b']);
    expect(activeTabId(state)).toBe('b');
  });

  it('opens new tabs at the left edge by default', () => {
    const state = stateWith('a', 'b', 'c');
    expect(state.open).toEqual(['c', 'b', 'a']);
  });

  it('can open new tabs right after the current one instead', () => {
    let state = stateWith('a', 'b', 'c'); // strip: c b a
    state = tabsReducer(state, { type: 'select', tabId: 'b' });
    state = tabsReducer(state, { type: 'add', tab: makeTab('d'), at: 'afterCurrent' });
    expect(state.open).toEqual(['c', 'b', 'd', 'a']);
  });

  it('selecting a tab that is already open leaves the strip in place', () => {
    let state = stateWith('a', 'b', 'c');
    state = tabsReducer(state, { type: 'select', tabId: 'a' });
    expect(state.open).toEqual(['c', 'b', 'a']);
    expect(activeTabId(state)).toBe('a');
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
    const state = stateWith('a', 'b', 'c'); // strip: c b a
    const after = tabsReducer(tabsReducer(state, { type: 'select', tabId: 'b' }), { type: 'close', tabId: 'b' });
    expect(after.tabs.map((t) => t.id)).toEqual(['a', 'c']);
    expect(after.open).toEqual(['c', 'a']);
    expect(after.layouts.b).toBeUndefined();
    expect(activeTabId(after)).toBe('a');
  });

  it('closing the last session leaves Home', () => {
    const after = tabsReducer(stateWith('a'), { type: 'close', tabId: 'a' });
    expect(activeTabId(after)).toBeNull();
    expect(onScreen(after)).toEqual([]);
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
    expect(after.open).toEqual(['a']);
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

describe('a tab holds its own splits', () => {
  const claude = (id: string) => makeTab(id, { kind: 'claude' });
  const withClaude = (...ids: string[]) =>
    ids.reduce((st, id) => tabsReducer(st, { type: 'add', tab: claude(id) }), initialTabsState);

  it('a Claude session opens on its Claude view, a shell session on itself', () => {
    expect(onScreen(withClaude('a'))).toEqual(['session:a:claude']);
    expect(onScreen(stateWith('s'))).toEqual(['session:s:shell']);
  });

  it('splitting opens a new shell beside Claude, in the same tab', () => {
    let state = withClaude('a');
    state = tabsReducer(state, { type: 'splitShell', edge: 'right' });
    expect(panesOf(currentLayout(state).grid)).toHaveLength(2);
    expect(onScreen(state)).toEqual(['session:a:claude', 'session:a:shell:1']);
    // Still one tab on the strip.
    expect(state.open).toEqual(['a']);
  });

  it('each split is a new shell, never the same one moved', () => {
    let state = withClaude('a');
    state = tabsReducer(state, { type: 'splitShell', edge: 'right' });
    state = tabsReducer(state, { type: 'splitShell', edge: 'bottom' });
    expect(onScreen(state).sort()).toEqual(['session:a:claude', 'session:a:shell:1', 'session:a:shell:2']);
  });

  it('switching tabs swaps the whole layout, and switching back restores it', () => {
    let state = withClaude('a', 'b');
    state = tabsReducer(state, { type: 'select', tabId: 'a' });
    state = tabsReducer(state, { type: 'splitShell', edge: 'right' });
    state = tabsReducer(state, { type: 'select', tabId: 'b' });
    expect(onScreen(state)).toEqual(['session:b:claude']);
    state = tabsReducer(state, { type: 'select', tabId: 'a' });
    expect(onScreen(state)).toEqual(['session:a:claude', 'session:a:shell:1']);
  });

  it('closing a split leaves the session and its tab', () => {
    let state = withClaude('a');
    state = tabsReducer(state, { type: 'splitShell', edge: 'right' });
    state = tabsReducer(state, { type: 'closeView', key: 'session:a:shell:1' });
    expect(onScreen(state)).toEqual(['session:a:claude']);
    expect(state.open).toEqual(['a']);
  });

  it("closing a tab's last pane takes the tab off the strip, not the session", () => {
    let state = withClaude('a', 'b');
    state = tabsReducer(state, { type: 'closeView', key: 'session:b:claude' });
    expect(state.open).toEqual(['a']);
    expect(activeTabId(state)).toBe('a');
    expect(state.tabs.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('hiding a tab keeps the session running in the list', () => {
    let state = withClaude('a', 'b');
    state = tabsReducer(state, { type: 'hide', tabId: 'b' });
    expect(state.open).toEqual(['a']);
    expect(state.tabs).toHaveLength(2);
  });

  it("closing a tab leaves another tab's view of that session alone", () => {
    let state = withClaude('a', 'b'); // strip: b a, on b
    const paneId = currentLayout(state).focusedPaneId;
    state = tabsReducer(state, { type: 'splitTo', content: sessionContent('a'), paneId, edge: 'right' });
    state = tabsReducer(state, { type: 'hide', tabId: 'a' });
    // a is still running, so b's side-by-side view of it stays.
    expect(onScreen(state)).toEqual(['session:b:claude', 'session:a:claude']);
  });

  it('closing a session takes away a tab it was the only thing in', () => {
    let state = withClaude('a', 'b'); // on b
    const paneId = currentLayout(state).focusedPaneId;
    state = tabsReducer(state, { type: 'splitTo', content: sessionContent('a'), paneId, edge: 'right' });
    state = tabsReducer(state, { type: 'closeView', key: 'session:b:claude' }); // b's tab now shows only a
    state = tabsReducer(state, { type: 'close', tabId: 'a' });
    expect(state.open).toEqual([]);
    expect(state.tabs.map((t) => t.id)).toEqual(['b']);
  });

  it('another session can sit beside this one, and leaves when it closes', () => {
    let state = withClaude('a', 'b');
    const paneId = currentLayout(state).focusedPaneId; // tab b
    state = tabsReducer(state, { type: 'splitTo', content: sessionContent('a'), paneId, edge: 'right' });
    expect([...visibleSessionIds(currentLayout(state))].sort()).toEqual(['a', 'b']);
    state = tabsReducer(state, { type: 'close', tabId: 'a' });
    expect(onScreen(state)).toEqual(['session:b:claude']);
  });

  it('holds four panes at once and no more', () => {
    let state = withClaude('a');
    state = tabsReducer(state, { type: 'splitShell', edge: 'right' }); // focus → right
    state = tabsReducer(state, { type: 'splitShell', edge: 'bottom' }); // right splits
    state = tabsReducer(state, { type: 'focusPane', paneId: currentLayout(state).panes[0].id });
    state = tabsReducer(state, { type: 'splitShell', edge: 'bottom' }); // left splits
    expect(panesOf(currentLayout(state).grid)).toHaveLength(4);
    // A fifth has no room: it joins the focused pane rather than failing.
    state = tabsReducer(state, { type: 'splitShell', edge: 'right' });
    expect(panesOf(currentLayout(state).grid)).toHaveLength(4);
    expect(onScreen(state)).toHaveLength(5);
  });

  it('a seam is clamped so a pane can never be dragged to nothing', () => {
    const state = tabsReducer(withClaude('a'), { type: 'seam', axis: 'col', frac: 0.99 });
    expect(currentLayout(state).colFrac).toBeLessThanOrEqual(0.85);
  });
});

describe('files on the workspace', () => {
  const file = { kind: 'file' as const, dir: '/proj', path: '/proj/src/App.tsx' };
  const other = { kind: 'file' as const, dir: '/proj', path: '/proj/README.md' };

  it('a file opens in a pane beside the session, not behind it', () => {
    let state = stateWith('a');
    state = tabsReducer(state, { type: 'addToWorkspace', content: file });
    expect(panesOf(currentLayout(state).grid)).toHaveLength(2);
    expect(onScreen(state)).toEqual(['session:a:shell', 'file:/proj/src/App.tsx']);
  });

  it('a second file joins the file pane', () => {
    let state = stateWith('a');
    state = tabsReducer(state, { type: 'addToWorkspace', content: file });
    state = tabsReducer(state, { type: 'focusPane', paneId: currentLayout(state).panes[0].id });
    state = tabsReducer(state, { type: 'addToWorkspace', content: other });
    expect(panesOf(currentLayout(state).grid)).toHaveLength(2);
    expect(onScreen(state)).toEqual(['session:a:shell', 'file:/proj/src/App.tsx', 'file:/proj/README.md']);
  });

  it('brings back what is already open instead of duplicating it', () => {
    let state = stateWith('a');
    state = tabsReducer(state, { type: 'addToWorkspace', content: file });
    state = tabsReducer(state, { type: 'addToWorkspace', content: file });
    expect(onScreen(state)).toEqual(['session:a:shell', 'file:/proj/src/App.tsx']);
    const l = currentLayout(state);
    expect(contentKey(activeContent(findPane(l, l.focusedPaneId)))).toBe('file:/proj/src/App.tsx');
  });

  it('with no session open, a file opens on Home', () => {
    const state = tabsReducer(initialTabsState, { type: 'addToWorkspace', content: file });
    expect(onScreen(state)).toEqual(['file:/proj/src/App.tsx']);
    expect(state.open).toEqual([]);
  });
});
