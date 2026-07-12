import { useCallback, useEffect, useReducer, useState } from 'react';
import SessionHistoryPanel from '@/components/SessionHistoryPanel';
import Sidebar from '@/components/Sidebar';
import Terminal from '@/components/Terminal';
import { disposeTerminal, writeToTerminal } from '@/components/terminalCache';
import * as ipc from '@/lib/ipc';
import { initialTabsState, tabsReducer } from '@/lib/tabs';
import type { SavedTab, SessionHistoryEntry, ShellOption, Tab, TabKind } from '@/types';

const INITIAL_COLS = 120;
const INITIAL_ROWS = 40;
const SAVE_DEBOUNCE_MS = 300;

export default function App() {
  const [state, dispatch] = useReducer(tabsReducer, initialTabsState);
  const [shellOptions, setShellOptions] = useState<ShellOption[]>([]);
  const [cwd, setCwd] = useState<string | null>(null);
  const [homeDir, setHomeDir] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);

  useEffect(() => {
    ipc.listShells().then(setShellOptions).catch(() => {});
    ipc.homeDir().then(setHomeDir).catch(() => {});
  }, []);

  const handlePickFolder = useCallback(() => {
    ipc.pickFolder(cwd ?? homeDir).then((picked) => {
      if (picked) setCwd(picked);
    }).catch(() => {});
  }, [cwd, homeDir]);

  useEffect(() => {
    const unlisten = ipc.onPtyExit((tabId) => dispatch({ type: 'exited', tabId }));
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  useEffect(() => {
    const unlisten = ipc.onClaudeSessionResolved((tabId, sessionId) =>
      dispatch({ type: 'sessionResolved', tabId, sessionId }));
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  /** Spawns a tab at an explicit cwd — used both for user-initiated new
   *  sessions (current cwd) and for restoring the previous workspace (a cwd
   *  loaded from disk, which hasn't reached React state yet at that point). */
  const spawnTabAt = useCallback(
    (atCwd: string, kind: TabKind, shellId: string | null, name: string, resumeSessionId?: string | null) => {
      const tab: Tab = {
        id: crypto.randomUUID(),
        kind,
        name,
        shellId,
        cwd: atCwd,
        resumeSessionId: resumeSessionId ?? null,
        exited: false,
      };
      dispatch({ type: 'add', tab });
      ipc.spawnPty({
        tabId: tab.id,
        kind: kind === 'claude' ? 'claude' : shellId!,
        cwd: atCwd,
        resumeSessionId: tab.resumeSessionId,
        cols: INITIAL_COLS,
        rows: INITIAL_ROWS,
        onData: (data) => writeToTerminal(tab.id, data),
      }).catch(() => dispatch({ type: 'exited', tabId: tab.id }));
    },
    [],
  );

  const spawnTab = useCallback(
    (kind: TabKind, shellId: string | null, name: string, resumeSessionId?: string) => {
      if (!cwd) return;
      setShowHistory(false);
      spawnTabAt(cwd, kind, shellId, name, resumeSessionId);
    },
    [cwd, spawnTabAt],
  );

  // Restore the previous workspace (folder + open tabs) once on startup.
  useEffect(() => {
    let cancelled = false;
    ipc.loadWorkspace().then((ws) => {
      if (cancelled) return;
      setCollapsed(ws.collapsed);
      if (ws.cwd) {
        setCwd(ws.cwd);
        for (const saved of ws.tabs) {
          spawnTabAt(ws.cwd, saved.kind, saved.shellId, saved.name, saved.resumeSessionId);
        }
      }
    }).catch(() => {}).finally(() => {
      if (!cancelled) setWorkspaceLoaded(true);
    });
    return () => { cancelled = true; };
    // Runs once on mount; spawnTabAt has no reactive dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the workspace (debounced) whenever it changes, once the initial
  // load has finished — otherwise this would overwrite the saved state with
  // the empty pre-load state.
  useEffect(() => {
    if (!workspaceLoaded) return;
    const timer = setTimeout(() => {
      const tabs: SavedTab[] = state.tabs
        .filter((t) => !t.exited)
        .map((t) => ({ kind: t.kind, name: t.name, shellId: t.shellId, resumeSessionId: t.resumeSessionId }));
      ipc.saveWorkspace({ cwd, collapsed, tabs }).catch(() => {});
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [workspaceLoaded, state.tabs, cwd, collapsed]);

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
        cwd={cwd}
        collapsed={collapsed}
        onSelectTab={handleSelectTab}
        onCloseTab={handleCloseTab}
        onNewClaudeTab={handleNewClaudeTab}
        onNewShellTab={handleNewShellTab}
        onToggleHistory={() => setShowHistory((v) => !v)}
        onPickFolder={handlePickFolder}
        onToggleCollapse={() => setCollapsed((v) => !v)}
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
        {!showHistory && state.tabs.length === 0 && !cwd && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground text-[12px]">
            <span>Select a folder to start a session</span>
            <button
              className="px-3 py-1.5 rounded-sm border border-border bg-card text-foreground text-[12px] cursor-pointer hover:bg-white/5"
              onClick={handlePickFolder}
            >
              Choose folder…
            </button>
          </div>
        )}
        {!showHistory && state.tabs.length === 0 && cwd && (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-[12px]">
            Create a session from the sidebar to get started
          </div>
        )}
      </main>
    </div>
  );
}
