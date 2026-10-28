import type { NewTabPosition, SessionMode, Tab, TabStatus } from '@/types';
import {
  activateInPane, addToPane, addToWorkspace, closeContent, closePane,
  focusPane, isEmptyLayout, nextShellNumber, removeSession, resizeSeam, sessionContent,
  singlePaneLayout, splitPane, type Edge, type Layout, type PaneContent,
} from './panes';
import { UNNAMED_SESSION } from './sessions';

/** Key of the layout shown when no session tab is open — Home, plus any file
 *  opened from the explorer before a session was. */
export const HOME = '';

export interface TabsState {
  tabs: Tab[];
  /** The session tabs across the top, in strip order. A tab is a session; its
   *  splits live inside it (see `layouts`), the way a terminal's tab holds its
   *  panes. Closing a tab only takes it off the strip — the session keeps
   *  running and stays in the sidebar. */
  open: string[];
  /** The session tab on screen, or null for Home. */
  current: string | null;
  /** Each open session's own pane layout, keyed by session id (`HOME` when
   *  none is open). Switching tabs brings that session's splits back. */
  layouts: Record<string, Layout>;
}

export const initialTabsState: TabsState = { tabs: [], open: [], current: null, layouts: {} };

const EMPTY_LAYOUT = singlePaneLayout();

/** The layout on screen right now. */
export function currentLayout(state: TabsState): Layout {
  return state.layouts[state.current ?? HOME] ?? EMPTY_LAYOUT;
}

/** The session you're typing into: the current tab's. Clicking another
 *  session's pane inside it (a "compare" split) doesn't change which tab you're
 *  in, so this is the tab, not the focused pane. */
export function activeTabId(state: TabsState): string | null {
  return state.current;
}

/** The session's own first pane: Claude for a Claude session, the shell itself
 *  for a shell session. */
function initialLayoutFor(tab: Tab): Layout {
  return singlePaneLayout([sessionContent(tab.id, tab.kind === 'claude' ? 'claude' : 'shell')]);
}

/** Put a session on the strip (if it isn't already) and show it. A tab that's
 *  already open stays where it is — moving it would shuffle the strip under
 *  the pointer every time you clicked a sidebar row. */
function openSession(state: TabsState, tabId: string, at: NewTabPosition = 'start'): TabsState {
  const tab = state.tabs.find((t) => t.id === tabId);
  if (!tab) return state;
  let open = state.open;
  if (!open.includes(tabId)) {
    const cur = state.current ? open.indexOf(state.current) : -1;
    const index = at === 'afterCurrent' && cur !== -1 ? cur + 1 : 0;
    open = [...open.slice(0, index), tabId, ...open.slice(index)];
  }
  const layouts = state.layouts[tabId] ? state.layouts : { ...state.layouts, [tabId]: initialLayoutFor(tab) };
  return { ...state, open, current: tabId, layouts };
}

/** Take sessions off the strip, landing on the neighbour that slid into place
 *  (else the one before it) — the same rule a pane uses for its tabs.
 *
 *  Hiding a tab only drops that tab: the session is still running, so a
 *  "compare" pane showing it inside another tab stays. `purgeSessions` is for
 *  when the session itself is gone. */
function hideSessions(state: TabsState, ids: string[]): TabsState {
  if (!ids.some((id) => state.open.includes(id) || state.layouts[id])) return state;
  const at = state.current ? state.open.indexOf(state.current) : -1;
  const open = state.open.filter((id) => !ids.includes(id));
  let current = state.current;
  if (current && ids.includes(current)) {
    const left = state.open.slice(0, Math.max(0, at)).filter((id) => !ids.includes(id));
    const right = state.open.slice(at + 1).filter((id) => !ids.includes(id));
    current = right[0] ?? left[left.length - 1] ?? null;
  }
  const layouts: Record<string, Layout> = {};
  for (const [key, layout] of Object.entries(state.layouts)) {
    if (!ids.includes(key)) layouts[key] = layout;
  }
  return { ...state, open, current, layouts };
}

/** The session is gone (closed or archived): its tab goes, and so does any
 *  pane showing it inside another tab. A tab left with nothing on screen by
 *  that goes too, by the same rule as closing its last pane. */
function purgeSessions(state: TabsState, ids: string[]): TabsState {
  const layouts: Record<string, Layout> = {};
  for (const [key, layout] of Object.entries(state.layouts)) layouts[key] = ids.reduce(removeSession, layout);
  const emptied = state.open.filter((id) => !ids.includes(id) && layouts[id] && isEmptyLayout(layouts[id]));
  return hideSessions({ ...state, layouts }, [...ids, ...emptied]);
}

/** Apply a layout change to the tab on screen. A tab whose last pane closed
 *  has nothing left to show, so it leaves the strip. */
function withLayout(state: TabsState, fn: (layout: Layout) => Layout): TabsState {
  const key = state.current ?? HOME;
  const next = fn(currentLayout(state));
  if (state.current && isEmptyLayout(next)) return hideSessions(state, [state.current]);
  return { ...state, layouts: { ...state.layouts, [key]: next } };
}

/** How a session's Claude tool is being shown.
 *
 *  A stored mode only applies while the transcript can actually be read: a
 *  Claude session with a transcript, and the setting switched on. Anything
 *  else is a plain terminal, whatever was stored earlier — the alternative is
 *  a pane marked `markdown` with nothing to render in it. */
export function sessionModeOf(
  tab: Tab | null | undefined,
  modes: Map<string, SessionMode>,
  showMarkdownToggle: boolean,
): SessionMode {
  if (!tab) return 'terminal';
  const readable = tab.kind === 'claude' && !!tab.resumeSessionId;
  if (!showMarkdownToggle || !readable) return 'terminal';
  return modes.get(tab.id) ?? 'terminal';
}

export type TabsAction =
  | { type: 'add'; tab: Tab; select?: boolean; at?: NewTabPosition }
  /** Put `content` in a new pane split off `paneId` along `edge`. */
  | { type: 'splitTo'; content: PaneContent; paneId: string; edge: Edge }
  /** Split the focused pane and open a new shell of the current session in it. */
  | { type: 'splitShell'; edge: Edge }
  /** Take a session tab off the strip. The session keeps running. */
  | { type: 'hide'; tabId: string }
  /** Drop `content` into an existing pane's strip, optionally before a tab. */
  | { type: 'showIn'; content: PaneContent; paneId: string; beforeKey?: string | null }
  /** Put `content` somewhere sensible without being asked where. */
  | { type: 'addToWorkspace'; content: PaneContent }
  /** Bring a tab already in this pane to the front. */
  | { type: 'activateTab'; paneId: string; key: string }
  /** Close one view in the current tab's panes. The session behind it stays open. */
  | { type: 'closeView'; key: string }
  | { type: 'focusPane'; paneId: string }
  /** Take a pane off the grid. Its session stays open — the sidebar owns a
   *  session's life, a pane is only a place to look at one. */
  | { type: 'closePane'; paneId: string }
  | { type: 'seam'; axis: 'col' | 'row'; frac: number }
  | { type: 'close'; tabId: string }
  | { type: 'select'; tabId: string | null; at?: NewTabPosition }
  | { type: 'rename'; tabId: string; name: string }
  /** The auto-namer's suggestion: applied only while the session is still
   *  unnamed, so a name you gave it (at creation or by hand) is never replaced. */
  | { type: 'autoName'; tabId: string; name: string }
  | { type: 'exited'; tabId: string }
  | { type: 'sessionResolved'; tabId: string; sessionId: string }
  | { type: 'status'; tabId: string; status: TabStatus; detail?: string }
  | { type: 'interrupt'; tabId: string }
  | { type: 'wake'; tabId: string }
  | { type: 'sleep'; tabId: string }
  | { type: 'pin'; tabId: string; pinned: boolean }
  /** File a session under a project, or `null` to send it back to the Inbox.
   *  Organizational only — `cwd` is untouched, so nothing respawns and no
   *  transcript is orphaned. */
  | { type: 'setProject'; tabId: string; projectDir: string | null }
  | { type: 'archive'; tabId: string; archived: boolean };

/** A session's view is only placeable while that session is open; a file is
 *  always placeable. Guards every path that puts something on the grid, so a
 *  stale drag payload can't leave a pane pointing at nothing. */
function contentExists(state: TabsState, content: PaneContent): boolean {
  return content.kind !== 'session' || state.tabs.some((t) => t.id === content.sessionId);
}

export function tabsReducer(state: TabsState, action: TabsAction): TabsState {
  const patch = (tabId: string, fn: (tab: Tab) => Tab): TabsState => ({
    ...state,
    tabs: state.tabs.map((t) => (t.id === tabId ? fn(t) : t)),
  });

  switch (action.type) {
    case 'add': {
      const next = { ...state, tabs: [...state.tabs, action.tab] };
      // Restoring a workspace adds many sessions and shows none of them: a
      // launch opens on Home, not on whichever one happened to be last.
      return action.select === false ? next : openSession(next, action.tab.id, action.at);
    }

    case 'close': {
      if (!state.tabs.some((t) => t.id === action.tabId)) return state;
      const next = purgeSessions(state, [action.tabId]);
      return { ...next, tabs: next.tabs.filter((t) => t.id !== action.tabId) };
    }

    case 'select': {
      if (action.tabId === null) return state;
      if (!state.tabs.some((t) => t.id === action.tabId)) return state;
      const next = openSession(state, action.tabId, action.at);
      return {
        ...next,
        // Selecting a "just finished" session is what "seen" means for it.
        tabs: next.tabs.map((t) =>
          t.id === action.tabId && t.justFinished ? { ...t, justFinished: false } : t,
        ),
      };
    }

    case 'hide':
      return hideSessions(state, [action.tabId]);

    case 'splitTo':
      if (!contentExists(state, action.content)) return state;
      return withLayout(state, (l) => splitPane(l, action.paneId, action.edge, action.content));

    case 'splitShell': {
      if (!state.current) return state;
      const id = state.current;
      return withLayout(state, (l) =>
        splitPane(l, l.focusedPaneId, action.edge, sessionContent(id, 'shell', nextShellNumber(l))));
    }

    case 'showIn':
      if (!contentExists(state, action.content)) return state;
      return withLayout(state, (l) => addToPane(l, action.paneId, action.content, action.beforeKey));

    case 'activateTab':
      return withLayout(state, (l) => activateInPane(l, action.paneId, action.key));

    case 'closeView':
      return withLayout(state, (l) => closeContent(l, action.key));

    case 'addToWorkspace':
      if (!contentExists(state, action.content)) return state;
      return withLayout(state, (l) => addToWorkspace(l, action.content));

    case 'focusPane':
      return withLayout(state, (l) => focusPane(l, action.paneId));

    case 'closePane':
      return withLayout(state, (l) => closePane(l, action.paneId));

    case 'seam':
      return withLayout(state, (l) => resizeSeam(l, action.axis, action.frac));

    case 'rename':
      return patch(action.tabId, (t) => ({ ...t, name: action.name }));

    case 'autoName':
      return patch(action.tabId, (t) => (t.name === UNNAMED_SESSION ? { ...t, name: action.name } : t));

    case 'exited':
      return patch(action.tabId, (t) => ({ ...t, exited: true }));

    case 'sessionResolved':
      return patch(action.tabId, (t) => ({ ...t, resumeSessionId: action.sessionId }));

    case 'status': {
      const now = Date.now();
      return patch(action.tabId, (t) => {
        // Only a working -> idle transition counts as "just finished" — idle is
        // Claude's resting state after any turn, so reaching it from anywhere
        // else (new, requires_response) isn't a completion signal.
        const justFinished = action.status === 'idle' && t.status === 'working';
        // The activity detail only ever means something while working.
        const statusDetail = action.status === 'working' ? action.detail : undefined;
        return { ...t, status: action.status, statusChangedAt: now, justFinished, statusDetail };
      });
    }

    // Claude Code's Stop hook explicitly doesn't fire on a user interrupt
    // (Escape/Ctrl+C), so a working session would otherwise stay "working"
    // forever after one. An interrupt always leaves Claude asking what to do
    // next, which is what requires_response already means.
    case 'interrupt': {
      const now = Date.now();
      return patch(action.tabId, (t) =>
        t.kind !== 'claude' || t.status !== 'working'
          ? t
          : { ...t, status: 'requires_response', statusChangedAt: now, justFinished: false, statusDetail: undefined });
    }

    case 'wake':
      return patch(action.tabId, (t) => ({ ...t, dormant: false }));

    // Put an idle background session back to sleep: its pty is killed but the
    // session stays (dormant), to be respawned via `--resume` when next shown.
    case 'sleep':
      return patch(action.tabId, (t) => ({ ...t, dormant: true, exited: false }));

    case 'pin':
      return patch(action.tabId, (t) => ({ ...t, pinned: action.pinned }));

    case 'setProject':
      return patch(action.tabId, (t) => ({ ...t, projectDir: action.projectDir }));

    case 'archive': {
      const next = patch(action.tabId, (t) => ({
        ...t,
        archived: action.archived,
        // Archiving frees the process; the session is still resumable.
        dormant: action.archived ? true : t.dormant,
      }));
      // Don't leave a tab showing a session that just left the list.
      return action.archived ? purgeSessions(next, [action.tabId]) : next;
    }
  }
}
