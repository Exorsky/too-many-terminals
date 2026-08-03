import type { Tab, TabStatus } from '@/types';

export interface TabsState {
  tabs: Tab[];
  activeTabId: string | null;
}

export const initialTabsState: TabsState = { tabs: [], activeTabId: null };

export type TabsAction =
  | { type: 'add'; tab: Tab }
  | { type: 'close'; tabId: string }
  | { type: 'select'; tabId: string }
  | { type: 'rename'; tabId: string; name: string }
  | { type: 'exited'; tabId: string }
  | { type: 'sessionResolved'; tabId: string; sessionId: string }
  | { type: 'status'; tabId: string; status: TabStatus }
  | { type: 'wake'; tabId: string }
  | { type: 'sleep'; tabId: string }
  | { type: 'dirty'; tabId: string; dirty: boolean }
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
      return { ...state, activeTabId: action.tabId };

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

    case 'status':
      return {
        ...state,
        tabs: state.tabs.map((t) =>
          t.id === action.tabId ? { ...t, status: action.status } : t,
        ),
      };

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

/** Which tabs the top TabBar should show: every open file tab, plus a single
 *  slot for whichever session/terminal you were last on (if it's still
 *  open) — not a row per session, just a "come back here" pointer so
 *  switching between the session you were on and any open files doesn't need
 *  a sidebar detour. */
export function tabBarTabs(tabs: Tab[], lastSessionTabId: string | null): Tab[] {
  const files = tabs.filter((t) => t.kind === 'file');
  const session = tabs.find((t) => t.id === lastSessionTabId && t.kind !== 'file');
  return session ? [session, ...files] : files;
}
