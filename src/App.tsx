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
  const [projects, setProjects] = useState<string[]>([]);
  const [homeDir, setHomeDir] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);

  useEffect(() => {
    ipc.listShells().then(setShellOptions).catch(() => {});
    ipc.homeDir().then(setHomeDir).catch(() => {});
  }, []);

  const handleAddProject = useCallback(() => {
    ipc.pickFolder(projects[projects.length - 1] ?? homeDir).then((picked) => {
      if (picked) setProjects((prev) => (prev.includes(picked) ? prev : [...prev, picked]));
    }).catch(() => {});
  }, [projects, homeDir]);

  const handleRemoveProject = useCallback((dir: string) => {
    for (const tab of state.tabs) {
      if (tab.cwd === dir) {
        ipc.killPty(tab.id);
        disposeTerminal(tab.id);
        dispatch({ type: 'close', tabId: tab.id });
      }
    }
    setProjects((prev) => prev.filter((p) => p !== dir));
  }, [state.tabs]);

  useEffect(() => {
    const unlisten = ipc.onPtyExit((tabId) => dispatch({ type: 'exited', tabId }));
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  useEffect(() => {
    const unlisten = ipc.onClaudeSessionResolved((tabId, sessionId) =>
      dispatch({ type: 'sessionResolved', tabId, sessionId }));
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  /** Spawns a tab at an explicit project folder — used for user-initiated new
   *  sessions and for restoring the previous workspace (folders loaded from
   *  disk, which haven't reached React state yet at that point). */
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
      setShowHistory(false);
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

  // Restore the previous workspace (projects + open tabs) once on startup.
  useEffect(() => {
    let cancelled = false;
    ipc.loadWorkspace().then((ws) => {
      if (cancelled) return;
      setCollapsed(ws.collapsed);
      setProjects(ws.projects);
      for (const saved of ws.tabs) {
        spawnTabAt(saved.cwd, saved.kind, saved.shellId, saved.name, saved.resumeSessionId);
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
        .map((t) => ({ kind: t.kind, name: t.name, shellId: t.shellId, resumeSessionId: t.resumeSessionId, cwd: t.cwd }));
      ipc.saveWorkspace({ projects, collapsed, tabs }).catch(() => {});
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [workspaceLoaded, state.tabs, projects, collapsed]);

  const handleNewClaudeTab = useCallback(
    (dir: string) => spawnTabAt(dir, 'claude', null, 'Claude'),
    [spawnTabAt],
  );

  const handleNewShellTab = useCallback(
    (dir: string, shellId: string) => {
      const label = shellOptions.find((s) => s.id === shellId)?.label ?? shellId;
      spawnTabAt(dir, 'shell', shellId, label);
    },
    [spawnTabAt, shellOptions],
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

  const handleRenameTab = useCallback((tabId: string, name: string) => {
    dispatch({ type: 'rename', tabId, name });
  }, []);

  const handleResumeSession = useCallback(
    (dir: string, entry: SessionHistoryEntry) => {
      const name = entry.preview.slice(0, 30) || 'Claude';
      spawnTabAt(dir, 'claude', null, name, entry.sessionId);
    },
    [spawnTabAt],
  );

  return (
    <div className="flex h-screen bg-background text-foreground">
      <Sidebar
        tabs={state.tabs}
        activeTabId={state.activeTabId}
        shellOptions={shellOptions}
        showHistory={showHistory}
        projects={projects}
        collapsed={collapsed}
        onSelectTab={handleSelectTab}
        onCloseTab={handleCloseTab}
        onNewClaudeTab={handleNewClaudeTab}
        onNewShellTab={handleNewShellTab}
        onRenameTab={handleRenameTab}
        onToggleHistory={() => setShowHistory((v) => !v)}
        onAddProject={handleAddProject}
        onRemoveProject={handleRemoveProject}
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
        {showHistory && projects.length > 0 && (
          <div className="absolute inset-0 bg-background">
            <SessionHistoryPanel projects={projects} onResume={handleResumeSession} />
          </div>
        )}
        {!showHistory && state.tabs.length === 0 && projects.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground text-[12px]">
            <span>Select a folder to start a session</span>
            <button
              className="px-3 py-1.5 rounded-sm border border-border bg-card text-foreground text-[12px] cursor-pointer hover:bg-white/5"
              onClick={handleAddProject}
            >
              Choose folder…
            </button>
          </div>
        )}
        {!showHistory && state.tabs.length === 0 && projects.length > 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-[12px]">
            Create a session from the sidebar to get started
          </div>
        )}
      </main>
    </div>
  );
}
