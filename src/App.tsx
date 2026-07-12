import { useCallback, useEffect, useReducer, useState } from 'react';
import SessionHistoryPanel from '@/components/SessionHistoryPanel';
import Sidebar from '@/components/Sidebar';
import Terminal from '@/components/Terminal';
import { disposeTerminal, writeToTerminal } from '@/components/terminalCache';
import * as ipc from '@/lib/ipc';
import { initialTabsState, tabsReducer } from '@/lib/tabs';
import type { SessionHistoryEntry, ShellOption, Tab } from '@/types';

const INITIAL_COLS = 120;
const INITIAL_ROWS = 40;

export default function App() {
  const [state, dispatch] = useReducer(tabsReducer, initialTabsState);
  const [shellOptions, setShellOptions] = useState<ShellOption[]>([]);
  const [cwd, setCwd] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    ipc.listShells().then(setShellOptions).catch(() => {});
    ipc.homeDir().then(setCwd).catch(() => {});
  }, []);

  useEffect(() => {
    const unlisten = ipc.onPtyExit((tabId) => dispatch({ type: 'exited', tabId }));
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const spawnTab = useCallback(
    (kind: 'claude' | 'shell', shellId: string | null, name: string, resumeSessionId?: string) => {
      if (!cwd) return;
      const tab: Tab = {
        id: crypto.randomUUID(),
        kind,
        name,
        shellId,
        cwd,
        resumeSessionId: resumeSessionId ?? null,
        exited: false,
      };
      dispatch({ type: 'add', tab });
      setShowHistory(false);
      ipc.spawnPty({
        tabId: tab.id,
        kind: kind === 'claude' ? 'claude' : shellId!,
        cwd,
        resumeSessionId: tab.resumeSessionId,
        cols: INITIAL_COLS,
        rows: INITIAL_ROWS,
        onData: (data) => writeToTerminal(tab.id, data),
      }).catch(() => dispatch({ type: 'exited', tabId: tab.id }));
    },
    [cwd],
  );

  const handleNewClaudeTab = useCallback(() => spawnTab('claude', null, 'Claude'), [spawnTab]);

  const handleNewShellTab = useCallback(
    (shellId: string) => {
      const label = shellOptions.find((s) => s.id === shellId)?.label ?? shellId;
      spawnTab('shell', shellId, label);
    },
    [spawnTab, shellOptions],
  );

  const handleCloseTab = useCallback((tabId: string) => {
    ipc.killPty(tabId);
    disposeTerminal(tabId);
    dispatch({ type: 'close', tabId });
  }, []);

  const handleSelectTab = useCallback((tabId: string) => {
    setShowHistory(false);
    dispatch({ type: 'select', tabId });
  }, []);

  const handleResumeSession = useCallback(
    (entry: SessionHistoryEntry) => {
      const name = entry.preview.slice(0, 30) || 'Claude';
      spawnTab('claude', null, name, entry.sessionId);
    },
    [spawnTab],
  );

  return (
    <div className="flex h-screen bg-background text-foreground">
      <Sidebar
        tabs={state.tabs}
        activeTabId={state.activeTabId}
        shellOptions={shellOptions}
        showHistory={showHistory}
        onSelectTab={handleSelectTab}
        onCloseTab={handleCloseTab}
        onNewClaudeTab={handleNewClaudeTab}
        onNewShellTab={handleNewShellTab}
        onToggleHistory={() => setShowHistory((v) => !v)}
      />
      <main className="relative flex-1 min-w-0" data-terminal-area>
        {state.tabs.map((tab) => (
          <Terminal
            key={tab.id}
            tabId={tab.id}
            isVisible={!showHistory && tab.id === state.activeTabId}
          />
        ))}
        {showHistory && cwd && (
          <div className="absolute inset-0 bg-background">
            <SessionHistoryPanel projectDir={cwd} onResume={handleResumeSession} />
          </div>
        )}
        {!showHistory && state.tabs.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-[12px]">
            Create a session from the sidebar to get started
          </div>
        )}
      </main>
    </div>
  );
}
