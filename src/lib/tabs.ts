import type { SessionMode, Tab, TabStatus } from '@/types';
import {
  activateTab,
  addTabToFocused,
  closePaneTab,
  focusedPane,
  focusPane,
  initialLayout,
  movePaneTab,
  resizeSeam,
  splitPane,
  type Edge,
  type Layout,
} from './panes';

export interface TabsState {
  tabs: Tab[];
  /** Where every tab sits on the pane grid, which pane each is showing, and
   *  which pane has the keyboard. Replaces the old single `activeTabId` —
   *  with a grid there is one active tab *per pane*. See lib/panes.ts. */
  layout: Layout;
}

export const initialTabsState: TabsState = { tabs: [], layout: initialLayout };

/** The tab you're actually typing into: the focused pane's active tab. Most of
 *  the app only cares about this one — the sidebar highlight, the command
 *  palette, the file explorer's current path. The things that care about
 *  *everything on screen* use `visibleTabIds(state.layout)` instead. */
export function activeTabId(state: TabsState): string | null {
  return focusedPane(state.layout)?.activeTabId ?? null;
}

/** Placeholder every fresh Claude tab starts with, until the auto-namer or the
 *  user gives it a real one. Not a name, so it never becomes a session's. */
export const UNNAMED_TAB = 'Claude';

/** How a tab is actually being shown.
 *
 *  The single source of truth for it, because two callers need the answer and
 *  they must not disagree: App uses it to decide which tabs are on screen (and
 *  so which need a live pty), PaneView uses it to decide what to render. When
 *  those two rules diverged, a tab marked `markdown` that was no longer
 *  readable got its terminal hidden by the first and no transcript from the
 *  second — a blank pane under a populated tab strip.
 *
 *  A stored mode only applies while the tab can actually be read: a Claude
 *  session with a transcript, and the setting switched on. Anything else is
 *  a plain terminal, whatever was stored earlier. */
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

/** Folds the names currently on tabs into the persisted session-id → name map.
 *  Kept separate from `tabs` (and from the reducer) because it has to outlive
 *  the tab: History and a later resume both read it long after the tab is gone.
 *  Returns `prev` unchanged when nothing is new, so it's safe to run on every
 *  tab change without churning state. */
export function learnSessionNames(
  prev: Record<string, string>,
  tabs: Tab[],
): Record<string, string> {
  let next = prev;
  for (const tab of tabs) {
    const id = tab.resumeSessionId;
    if (tab.kind !== 'claude' || !id || tab.name === UNNAMED_TAB) continue;
    if (prev[id] === tab.name) continue;
    if (next === prev) next = { ...prev };
    next[id] = tab.name;
  }
  return next;
}

/** The tabs the top strip shows: the ones you've opened (`openIds`, in the
 *  order you first went into them), resolved against the live tab list. An id
 *  whose tab is gone is dropped, so a closed session self-cleans. */
export function tabBarTabs(tabs: Tab[], openIds: string[]): Tab[] {
  return openIds
    .map((id) => tabs.find((t) => t.id === id))
    .filter((t): t is Tab => t !== undefined);
}

export type TabsAction =
  | { type: 'add'; tab: Tab }
  | { type: 'close'; tabId: string }
  | { type: 'select'; tabId: string }
  | { type: 'rename'; tabId: string; name: string }
  | { type: 'exited'; tabId: string }
  | { type: 'sessionResolved'; tabId: string; sessionId: string }
  | { type: 'status'; tabId: string; status: TabStatus; detail?: string }
  | { type: 'interrupt'; tabId: string }
  | { type: 'wake'; tabId: string }
  | { type: 'sleep'; tabId: string }
  | { type: 'dirty'; tabId: string; dirty: boolean }
  | { type: 'pin'; tabId: string; pinned: boolean }
  // --- pane grid ---
  /** Split `paneId` along `edge`, putting `tabId` alone in the new pane. */
  | { type: 'splitTab'; tabId: string; paneId: string; edge: Edge }
  /** Drop `tabId` into `paneId`'s strip — a cross-pane move or a reorder. */
  | { type: 'moveTab'; tabId: string; paneId: string; targetTabId?: string; position?: 'before' | 'after' }
  | { type: 'focusPane'; paneId: string }
  | { type: 'seam'; axis: 'col' | 'row'; frac: number }
  /** Take a tab out of its pane without closing it — the strip's × for a
   *  session, which stays open, running, and in the sidebar. */
  | { type: 'removeFromPane'; tabId: string };

export function tabsReducer(state: TabsState, action: TabsAction): TabsState {
  switch (action.type) {
    case 'add':
      return {
        tabs: [...state.tabs, action.tab],
        layout: addTabToFocused(state.layout, action.tab.id),
      };

    // The neighbour-activation rule ("prefer the tab that took its place, else
    // the previous one") now lives in panes.ts, so a tab leaving a strip behaves
    // the same whether it was closed or dragged out.
    case 'close': {
      if (!state.tabs.some((t) => t.id === action.tabId)) return state;
      return {
        tabs: state.tabs.filter((t) => t.id !== action.tabId),
        layout: closePaneTab(state.layout, action.tabId),
      };
    }

    case 'select':
      if (!state.tabs.some((t) => t.id === action.tabId)) return state;
      return {
        // Already in a pane? Focus that pane rather than dragging the tab
        // across the screen. Otherwise it opens in the focused pane.
        layout: activateTab(state.layout, action.tabId),
        // Selecting a "just finished" tab is what "seen" means for it.
        tabs: state.tabs.map((t) =>
          t.id === action.tabId && t.justFinished ? { ...t, justFinished: false } : t,
        ),
      };

    case 'rename':
      return {
        ...state,
        tabs: state.tabs.map((t) =>
          t.id === action.tabId ? { ...t, name: action.name } : t,
        ),
      };

    case 'exited':
      return {
        ...state,
        tabs: state.tabs.map((t) =>
          t.id === action.tabId ? { ...t, exited: true } : t,
        ),
      };

    case 'sessionResolved':
      return {
        ...state,
        tabs: state.tabs.map((t) =>
          t.id === action.tabId ? { ...t, resumeSessionId: action.sessionId } : t,
        ),
      };

    case 'status': {
      const now = Date.now();
      return {
        ...state,
        tabs: state.tabs.map((t) => {
          if (t.id !== action.tabId) return t;
          // Only a working -> idle transition counts as "just finished" — idle
          // is Claude's resting state after any turn, so reaching it from
          // anywhere else (new, requires_response) isn't a completion signal.
          const justFinished = action.status === 'idle' && t.status === 'working';
          // The activity detail only ever means something while working —
          // carrying it past that would show a stale "editing X" caption
          // once the tab has actually gone idle or is waiting on input.
          const statusDetail = action.status === 'working' ? action.detail : undefined;
          return { ...t, status: action.status, statusChangedAt: now, justFinished, statusDetail };
        }),
      };
    }

    // Claude Code's Stop hook explicitly doesn't fire on a user interrupt
    // (Escape/Ctrl+C), so a working tab would otherwise stay "working"
    // forever after one. The interrupt always leaves Claude asking what to
    // do next, which is what requires_response already means — a no-op
    // unless the tab is a claude tab currently marked working, so an
    // Escape/Ctrl+C sent for any other reason (a shell tab, a tab that's
    // already idle/waiting) doesn't get reinterpreted.
    case 'interrupt': {
      const now = Date.now();
      return {
        ...state,
        tabs: state.tabs.map((t) => {
          if (t.id !== action.tabId || t.kind !== 'claude' || t.status !== 'working') return t;
          return { ...t, status: 'requires_response', statusChangedAt: now, justFinished: false, statusDetail: undefined };
        }),
      };
    }

    case 'wake':
      return {
        ...state,
        tabs: state.tabs.map((t) =>
          t.id === action.tabId ? { ...t, dormant: false } : t,
        ),
      };

    // Put an idle background tab back to sleep: its pty is killed but the tab
    // stays (dormant), to be respawned via `--resume` when next shown.
    case 'sleep':
      return {
        ...state,
        tabs: state.tabs.map((t) =>
          t.id === action.tabId ? { ...t, dormant: true, exited: false } : t,
        ),
      };

    case 'dirty':
      return {
        ...state,
        tabs: state.tabs.map((t) =>
          t.id === action.tabId ? { ...t, dirty: action.dirty } : t,
        ),
      };

    case 'pin':
      return {
        ...state,
        tabs: state.tabs.map((t) =>
          t.id === action.tabId ? { ...t, pinned: action.pinned } : t,
        ),
      };

    case 'splitTab':
      if (!state.tabs.some((t) => t.id === action.tabId)) return state;
      return { ...state, layout: splitPane(state.layout, action.paneId, action.edge, action.tabId) };

    case 'moveTab':
      if (!state.tabs.some((t) => t.id === action.tabId)) return state;
      return {
        ...state,
        layout: movePaneTab(state.layout, action.tabId, action.paneId, action.targetTabId, action.position),
      };

    case 'focusPane':
      return { ...state, layout: focusPane(state.layout, action.paneId) };

    case 'seam':
      return { ...state, layout: resizeSeam(state.layout, action.axis, action.frac) };

    case 'removeFromPane':
      return { ...state, layout: closePaneTab(state.layout, action.tabId) };
  }
}
