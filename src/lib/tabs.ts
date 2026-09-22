import type { SessionMode, Tab, TabStatus } from '@/types';
import {
  activateInPane, activateSession, activeContent, addToPane, addToWorkspace, closeContent,
  closePane, focusedPane, focusPane, initialLayout, removeSession, resizeSeam,
  splitPane, type Edge, type Layout, type PaneContent,
} from './panes';

export interface TabsState {
  tabs: Tab[];
  /** Which session each pane of the grid is showing, and which pane has the
   *  keyboard. Up to four at once — but the *list* of sessions lives only in
   *  the sidebar, which is the part that changed. See docs/features/panes.md. */
  layout: Layout;
}

export const initialTabsState: TabsState = { tabs: [], layout: initialLayout };

/** The session you're actually typing into: the focused pane's.
 *
 *  Most of the app only cares about this one — the sidebar highlight, the
 *  inspector, the command palette. The things that care about *everything on
 *  screen* use `visibleSessionIds(state.layout)` instead. */
export function activeTabId(state: TabsState): string | null {
  const content = activeContent(focusedPane(state.layout));
  return content?.kind === 'session' ? content.sessionId : null;
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
  | { type: 'add'; tab: Tab; select?: boolean }
  /** Put `content` in a new pane split off `paneId` along `edge`. */
  | { type: 'splitTo'; content: PaneContent; paneId: string; edge: Edge }
  /** Drop `content` into an existing pane's strip, optionally before a tab. */
  | { type: 'showIn'; content: PaneContent; paneId: string; beforeKey?: string | null }
  /** Put `content` somewhere sensible without being asked where. */
  | { type: 'addToWorkspace'; content: PaneContent }
  /** Bring a tab already in this pane to the front. */
  | { type: 'activateTab'; paneId: string; key: string }
  /** Close one tab. The session behind it stays open — the sidebar owns that. */
  | { type: 'closeTab'; key: string }
  | { type: 'focusPane'; paneId: string }
  /** Take a pane off the grid. Its session stays open — the sidebar owns a
   *  session's life, a pane is only a place to look at one. */
  | { type: 'closePane'; paneId: string }
  | { type: 'seam'; axis: 'col' | 'row'; frac: number }
  | { type: 'close'; tabId: string }
  | { type: 'select'; tabId: string | null }
  | { type: 'rename'; tabId: string; name: string }
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
    case 'add':
      return {
        tabs: [...state.tabs, action.tab],
        // Restoring a workspace adds many sessions and shows none of them: a
        // launch opens on Home, not on whichever one happened to be last.
        layout: action.select === false ? state.layout : activateSession(state.layout, action.tab.id),
      };

    case 'close': {
      if (!state.tabs.some((t) => t.id === action.tabId)) return state;
      return {
        tabs: state.tabs.filter((t) => t.id !== action.tabId),
        layout: removeSession(state.layout, action.tabId),
      };
    }

    case 'select':
      if (action.tabId === null) return state;
      if (!state.tabs.some((t) => t.id === action.tabId)) return state;
      return {
        // Already on screen? Focus that pane rather than dragging the session
        // across. Otherwise it opens in the focused one.
        layout: activateSession(state.layout, action.tabId),
        // Selecting a "just finished" session is what "seen" means for it.
        tabs: state.tabs.map((t) =>
          t.id === action.tabId && t.justFinished ? { ...t, justFinished: false } : t,
        ),
      };

    case 'splitTo':
      if (!contentExists(state, action.content)) return state;
      return { ...state, layout: splitPane(state.layout, action.paneId, action.edge, action.content) };

    case 'showIn':
      if (!contentExists(state, action.content)) return state;
      return {
        ...state,
        layout: addToPane(state.layout, action.paneId, action.content, action.beforeKey),
      };

    case 'activateTab':
      return { ...state, layout: activateInPane(state.layout, action.paneId, action.key) };

    case 'closeTab':
      return { ...state, layout: closeContent(state.layout, action.key) };

    case 'addToWorkspace':
      if (!contentExists(state, action.content)) return state;
      return { ...state, layout: addToWorkspace(state.layout, action.content) };

    case 'focusPane':
      return { ...state, layout: focusPane(state.layout, action.paneId) };

    case 'closePane':
      return { ...state, layout: closePane(state.layout, action.paneId) };

    case 'seam':
      return { ...state, layout: resizeSeam(state.layout, action.axis, action.frac) };

    case 'rename':
      return patch(action.tabId, (t) => ({ ...t, name: action.name }));

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
      // Don't leave a pane showing a session that just left the list.
      return action.archived ? { ...next, layout: removeSession(next.layout, action.tabId) } : next;
    }
  }
}
