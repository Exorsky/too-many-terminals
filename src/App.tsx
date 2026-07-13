import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import CommandPalette from '@/components/CommandPalette';
import SessionBar, { type MarkdownView, type SessionMode } from '@/components/SessionBar';
import SessionHistoryPanel from '@/components/SessionHistoryPanel';
import SessionReader from '@/components/SessionReader';
import SettingsView from '@/components/SettingsView';
import Sidebar from '@/components/Sidebar';
import Terminal from '@/components/Terminal';
import TranscriptDocument from '@/components/TranscriptDocument';
import TranscriptStates from '@/components/TranscriptStates';
import { disposeTerminal, writeToTerminal } from '@/components/terminalCache';
import * as ipc from '@/lib/ipc';
import { useSettings } from '@/lib/settings-store';
import { initialTabsState, tabsReducer } from '@/lib/tabs';
import { transcriptToMarkdown } from '@/lib/transcript';
import { useTranscript } from '@/lib/use-transcript';
import type { SavedTab, SessionHistoryEntry, ShellOption, Tab, TabKind, TabStatus } from '@/types';

const INITIAL_COLS = 120;
const INITIAL_ROWS = 40;
const SAVE_DEBOUNCE_MS = 300;

export default function App() {
  const [state, dispatch] = useReducer(tabsReducer, initialTabsState);
  const [shellOptions, setShellOptions] = useState<ShellOption[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  const [homeDir, setHomeDir] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [readerTarget, setReaderTarget] = useState<{ projectDir: string; entry: SessionHistoryEntry } | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);
  const settings = useSettings();
  // Tabs currently showing the in-place markdown reader (remembered per tab).
  const [mdTabs, setMdTabs] = useState<Set<string>>(new Set());
  const [mdView, setMdView] = useState<MarkdownView>('rendered');
  const [mdReload, setMdReload] = useState(0);

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
    ipc.uninstallHooks(dir).catch(() => {});
  }, [state.tabs]);

  const handleReorderProject = useCallback((sourceDir: string, targetDir: string, position: 'before' | 'after') => {
    setProjects((prev) => {
      if (sourceDir === targetDir) return prev;
      const from = prev.indexOf(sourceDir);
      if (from === -1 || !prev.includes(targetDir)) return prev;
      const next = [...prev];
      next.splice(from, 1);
      const at = next.indexOf(targetDir);
      next.splice(position === 'after' ? at + 1 : at, 0, sourceDir);
      return next;
    });
  }, []);

  const handleReorderTab = useCallback((tabId: string, targetId: string, position: 'before' | 'after') => {
    dispatch({ type: 'reorderTab', tabId, targetId, position });
  }, []);

  useEffect(() => {
    const unlisten = ipc.onPtyExit((tabId) => dispatch({ type: 'exited', tabId }));
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  useEffect(() => {
    const unlisten = ipc.onClaudeSessionResolved((tabId, sessionId) =>
      dispatch({ type: 'sessionResolved', tabId, sessionId }));
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // Latest tabs + notification pref, read by the once-registered status
  // listener below without re-subscribing on every change.
  const tabsRef = useRef(state.tabs);
  tabsRef.current = state.tabs;
  const notificationsRef = useRef(settings.notificationsEnabled);
  notificationsRef.current = settings.notificationsEnabled;
  // Last status we saw per tab, to detect the transition (not just the state).
  const prevStatusRef = useRef<Map<string, TabStatus>>(new Map());

  // Ask for notification permission once, up front, if the pref is on.
  useEffect(() => {
    if (settings.notificationsEnabled) void ipc.ensureNotificationPermission();
  }, [settings.notificationsEnabled]);

  /** Notify only when the app isn't focused (otherwise the status dot / inbox
   *  already tells you), and only on a real transition — Claude asking for
   *  input, or finishing a run (working → idle). Skips the first status of a
   *  tab so restoring a workspace doesn't fire a burst. */
  const maybeNotify = useCallback((tabId: string, prev: TabStatus | undefined, status: TabStatus) => {
    if (!notificationsRef.current || prev === undefined || document.hasFocus()) return;
    const name = tabsRef.current.find((t) => t.id === tabId)?.name ?? 'Claude';
    if (status === 'requires_response') void ipc.notify(name, 'Needs your input');
    else if (status === 'idle' && prev === 'working') void ipc.notify(name, 'Finished');
  }, []);

  // Claude Code's own hooks report live tab state (idle/working/awaiting
  // input) and, once the first prompt is submitted, a generated title.
  useEffect(() => {
    const unlisten = ipc.onTabStatus((tabId, status) => {
      const prev = prevStatusRef.current.get(tabId);
      prevStatusRef.current.set(tabId, status);
      dispatch({ type: 'status', tabId, status });
      maybeNotify(tabId, prev, status);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [maybeNotify]);

  useEffect(() => {
    const unlisten = ipc.onTabNamed((tabId, name) => dispatch({ type: 'rename', tabId, name }));
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
        status: 'new',
      };
      dispatch({ type: 'add', tab });
      setShowHistory(false);
      setShowSettings(false);
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
    setMdTabs((prev) => {
      if (!prev.has(tabId)) return prev;
      const next = new Set(prev);
      next.delete(tabId);
      return next;
    });
    dispatch({ type: 'close', tabId });
  }, []);

  /** Flip a tab between its live terminal and the in-place markdown reader. */
  const setTabMode = useCallback((tabId: string, mode: SessionMode) => {
    setMdTabs((prev) => {
      const next = new Set(prev);
      if (mode === 'markdown') next.add(tabId);
      else next.delete(tabId);
      return next;
    });
  }, []);

  const handleSelectTab = useCallback((tabId: string) => {
    setShowHistory(false);
    setShowSettings(false);
    dispatch({ type: 'select', tabId });
  }, []);

  // Command palette — Ctrl/Cmd+Shift+P from anywhere. Capture phase so it fires
  // before the focused xterm swallows the key; Shift+P (not Ctrl+K) to avoid
  // colliding with readline's kill-to-end-of-line inside a shell.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const handleRenameTab = useCallback((tabId: string, name: string) => {
    dispatch({ type: 'rename', tabId, name });
  }, []);

  const handleResumeSession = useCallback(
    (dir: string, entry: SessionHistoryEntry) => {
      const name = entry.preview.slice(0, 30) || 'Claude';
      setReaderTarget(null);
      spawnTabAt(dir, 'claude', null, name, entry.sessionId);
    },
    [spawnTabAt],
  );

  const handleReadSession = useCallback(
    (dir: string, entry: SessionHistoryEntry) => setReaderTarget({ projectDir: dir, entry }),
    [],
  );

  /** Jump a live (or resumed) Claude tab straight into its in-place markdown
   *  reader from the sidebar — selects the tab and flips it to markdown. */
  const handleReadTab = useCallback((tab: Tab) => {
    if (tab.kind !== 'claude' || !tab.resumeSessionId) return;
    setShowHistory(false);
    setShowSettings(false);
    setReaderTarget(null);
    dispatch({ type: 'select', tabId: tab.id });
    setMdTabs((prev) => new Set(prev).add(tab.id));
  }, []);

  const activeTab = state.tabs.find((t) => t.id === state.activeTabId) ?? null;
  const activeReadable = !!activeTab && activeTab.kind === 'claude' && !!activeTab.resumeSessionId;
  const overlaysUp = showHistory || showSettings || readerTarget !== null;
  const barVisible = settings.showSessionBar && activeTab !== null && !overlaysUp;
  // Markdown reading needs both prefs on (so there's always a bar toggle to leave it by).
  const canRead = settings.showSessionBar && settings.showMarkdownToggle && activeReadable;
  const mdActive = canRead && activeTab !== null && mdTabs.has(activeTab.id);

  const { turns, error } = useTranscript(
    mdActive && activeTab ? activeTab.cwd : null,
    mdActive && activeTab ? activeTab.resumeSessionId : null,
    mdReload,
  );
  const fullMarkdown = useMemo(() => (turns ? transcriptToMarkdown(turns) : ''), [turns]);

  return (
    <div className="flex h-screen bg-background text-foreground">
      <Sidebar
        tabs={state.tabs}
        activeTabId={state.activeTabId}
        shellOptions={shellOptions}
        showHistory={showHistory}
        showSettings={showSettings}
        projects={projects}
        collapsed={collapsed}
        onSelectTab={handleSelectTab}
        onCloseTab={handleCloseTab}
        onReadTab={handleReadTab}
        markdownEnabled={settings.showSessionBar && settings.showMarkdownToggle}
        onNewClaudeTab={handleNewClaudeTab}
        onNewShellTab={handleNewShellTab}
        onRenameTab={handleRenameTab}
        onToggleHistory={() => { setShowHistory((v) => !v); setShowSettings(false); }}
        onToggleSettings={() => { setShowSettings((v) => !v); setShowHistory(false); }}
        onAddProject={handleAddProject}
        onRemoveProject={handleRemoveProject}
        onReorderProject={handleReorderProject}
        onReorderTab={handleReorderTab}
        onToggleCollapse={() => setCollapsed((v) => !v)}
      />
      <main className="relative flex-1 min-w-0 flex flex-col" data-terminal-area>
        {barVisible && activeTab && (
          <SessionBar
            tab={activeTab}
            canRead={canRead}
            mode={mdActive ? 'markdown' : 'terminal'}
            view={mdView}
            turnsCount={turns ? turns.length : null}
            markdownText={fullMarkdown}
            onSetMode={(m) => setTabMode(activeTab.id, m)}
            onSetView={setMdView}
            onRefresh={() => setMdReload((k) => k + 1)}
          />
        )}
        <div className="relative flex-1 min-h-0">
          {state.tabs.map((tab) => (
            <Terminal
              key={tab.id}
              tabId={tab.id}
              isVisible={tab.id === state.activeTabId && !overlaysUp && !mdActive}
            />
          ))}
          {mdActive && (
            <div className="absolute inset-0 overflow-y-auto scrollbar-thin bg-background">
              <TranscriptStates turns={turns} error={error} />
              {turns && turns.length > 0 && <TranscriptDocument turns={turns} view={mdView} />}
            </div>
          )}
          {showHistory && projects.length > 0 && (
            <div className="absolute inset-0 bg-background">
              <SessionHistoryPanel projects={projects} onResume={handleResumeSession} onRead={handleReadSession} />
            </div>
          )}
          {readerTarget && (
            <div className="absolute inset-0 bg-background z-10">
              <SessionReader
                projectDir={readerTarget.projectDir}
                entry={readerTarget.entry}
                onClose={() => setReaderTarget(null)}
                onResume={handleResumeSession}
              />
            </div>
          )}
          {showSettings && (
            <div className="absolute inset-0 bg-background">
              <SettingsView />
            </div>
          )}
          {!overlaysUp && !mdActive && state.tabs.length === 0 && projects.length === 0 && (
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
          {!overlaysUp && !mdActive && state.tabs.length === 0 && projects.length > 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-[12px]">
              Create a session from the sidebar to get started
            </div>
          )}
        </div>
      </main>
      <CommandPalette
        open={paletteOpen}
        tabs={state.tabs}
        onClose={() => setPaletteOpen(false)}
        onSelectTab={handleSelectTab}
      />
    </div>
  );
}
