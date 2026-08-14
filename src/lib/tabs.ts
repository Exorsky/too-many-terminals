import type { Tab, TabStatus } from '@/types';

export interface TabsState {
  tabs: Tab[];
  activeTabId: string | null;
}

export const initialTabsState: TabsState = { tabs: [], activeTabId: null };

/** Placeholder every fresh Claude tab starts with, until the auto-namer or the
 *  user gives it a real one. Not a name, so it never becomes a session's. */
export const UNNAMED_TAB = 'Claude';

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

/** Moves `id` before/after `targetId` in a plain id list — the top strip's own
 *  order. No folder rules apply here (unlike the sidebar's session order): the
 *  strip is whatever you dragged it into. Returns the list unchanged when the
 *  move is a no-op or names an id that isn't there. */
export function moveId(ids: string[], id: string, targetId: string, position: 'before' | 'after'): string[] {
  if (id === targetId || !ids.includes(id) || !ids.includes(targetId)) return ids;
  const rest = ids.filter((x) => x !== id);
  const at = rest.indexOf(targetId);
  rest.splice(position === 'after' ? at + 1 : at, 0, id);
  return rest;
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
  | { type: 'reorderTab'; tabId: string; targetId: string; position: 'before' | 'after' };

export function tabsReducer(state: TabsState, action: TabsAction): TabsState {
  switch (action.type) {
    case 'add':
      return {
        tabs: [...state.tabs, action.tab],
        activeTabId: action.tab.id,
      };

    case 'close': {
      const index = state.tabs.findIndex((t) => t.id === action.tabId);
      if (index === -1) return state;
      const tabs = state.tabs.filter((t) => t.id !== action.tabId);
      let activeTabId = state.activeTabId;
      if (activeTabId === action.tabId) {
        // Prefer the tab that took the closed tab's place, else the previous one.
        activeTabId = (tabs[index] ?? tabs[index - 1])?.id ?? null;
      }
      return { tabs, activeTabId };
    }

    case 'select':
      if (!state.tabs.some((t) => t.id === action.tabId)) return state;
      return {
        ...state,
        activeTabId: action.tabId,
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

    case 'reorderTab': {
      if (action.tabId === action.targetId) return state;
      const from = state.tabs.findIndex((t) => t.id === action.tabId);
      const to = state.tabs.findIndex((t) => t.id === action.targetId);
      if (from === -1 || to === -1) return state;
      // Reordering is scoped to a single folder — sessions can't move between
      // projects, so a drop onto a tab in another folder is a no-op.
      if (state.tabs[from].cwd !== state.tabs[to].cwd) return state;
      const tabs = [...state.tabs];
      const [moved] = tabs.splice(from, 1);
      const at = tabs.findIndex((t) => t.id === action.targetId);
      tabs.splice(action.position === 'after' ? at + 1 : at, 0, moved);
      return { ...state, tabs };
    }
  }
}
