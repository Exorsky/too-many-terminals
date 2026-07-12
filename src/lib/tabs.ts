import type { Tab } from '@/types';

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
  | { type: 'sessionResolved'; tabId: string; sessionId: string };

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
  }
}
