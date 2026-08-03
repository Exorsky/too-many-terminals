import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { SquareTerminal } from 'lucide-react';
import CommandPalette from '@/components/CommandPalette';
import FileExplorerPanel from '@/components/FileExplorerPanel';
import FileViewer from '@/components/FileViewer';
import HomeScreen from '@/components/HomeScreen';
import SessionBar, { type MarkdownView, type SessionMode } from '@/components/SessionBar';
import SessionHistoryPanel from '@/components/SessionHistoryPanel';
import SessionReader from '@/components/SessionReader';
import SettingsView from '@/components/SettingsView';
import Sidebar from '@/components/Sidebar';
import Terminal from '@/components/Terminal';
import MarkdownPane from '@/components/MarkdownPane';
import { disposeTerminal, writeToTerminal } from '@/components/terminalCache';
import * as ipc from '@/lib/ipc';
import { useSettings } from '@/lib/settings-store';
import { initialTabsState, tabsReducer } from '@/lib/tabs';
import { transcriptToMarkdown } from '@/lib/transcript';
import { useTranscript } from '@/lib/use-transcript';
import { cn } from '@/lib/utils';
import type { SavedTab, SessionHistoryEntry, ShellOption, Tab, TabKind, TabStatus } from '@/types';

const INITIAL_COLS = 120;
const INITIAL_ROWS = 40;
const SAVE_DEBOUNCE_MS = 300;
// How often we scan for idle background sessions to auto-sleep. The threshold
// itself is user-configurable (settings.autoSleepMinutes; 0 disables).
const SLEEP_CHECK_MS = 60 * 1000;
// How often the on-screen transcript re-reads while its tab is working, so new
// turns show up live as Claude answers.
const LIVE_FOLLOW_MS = 1200;

export default function App() {
  const [state, dispatch] = useReducer(tabsReducer, initialTabsState);
  const [shellOptions, setShellOptions] = useState<ShellOption[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  const [homeDir, setHomeDir] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [filesPanelWidth, setFilesPanelWidth] = useState(260);
  const [draggingFilesSeam, setDraggingFilesSeam] = useState(false);
  const filesPanelRef = useRef<HTMLDivElement>(null);
  // Home is the resting screen: implicit when no tab is open, reachable any time
  // from the sidebar wordmark, and where every launch starts — a restored
  // workspace opens on the city, not on whichever tab happened to be last.
  const [showHome, setShowHome] = useState(true);
  const [readerTarget, setReaderTarget] = useState<{ projectDir: string; entry: SessionHistoryEntry } | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);
  const settings = useSettings();
  // Per-tab in-place view mode: absent = plain terminal; 'markdown' = full
  // markdown reader; 'split' = terminal + markdown side by side. Remembered per
  // tab (terminal is the default, so it isn't stored).
  const [mdTabs, setMdTabs] = useState<Map<string, SessionMode>>(new Map());
  const [mdView, setMdView] = useState<MarkdownView>('rendered');
  const [mdReload, setMdReload] = useState(0);
  // Split view: terminal-pane width as a fraction of the row, and whether the
  // seam is being dragged. Clamped so neither pane can be squeezed away.
  const [splitRatio, setSplitRatio] = useState(0.5);
  const [draggingSeam, setDraggingSeam] = useState(false);
  const splitRowRef = useRef<HTMLDivElement>(null);

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

  // Tabs whose pty we intentionally killed to put them to sleep — their
  // incoming pty-exit is expected and must not mark the tab as exited.
  const sleepingRef = useRef<Set<string>>(new Set());
  // Per-tab timestamp of when it first became eligible for auto-sleep (idle +
  // backgrounded); cleared as soon as it stops being eligible.
  const idleSinceRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const unlisten = ipc.onPtyExit((tabId) => {
      // A kill we issued for sleep — swallow it; the tab lives on as dormant.
      if (sleepingRef.current.delete(tabId)) return;
      dispatch({ type: 'exited', tabId });
    });
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
  // Auto-sleep threshold (ms), read live by the interval below without tearing
  // it down on every settings change. 0 → auto-sleep disabled.
  const autoSleepMsRef = useRef(0);
  autoSleepMsRef.current = settings.autoSleepMinutes * 60 * 1000;
  // Last status we saw per tab, to detect the transition (not just the state).
  const prevStatusRef = useRef<Map<string, TabStatus>>(new Map());
  // The tab the user is actually looking at right now (active, app focused, no
  // overlay covering it) — the one case where a notification is redundant.
  const visibleTabIdRef = useRef<string | null>(null);

  // Ask for notification permission once, up front, if the pref is on.
  useEffect(() => {
    if (settings.notificationsEnabled) void ipc.ensureNotificationPermission();
  }, [settings.notificationsEnabled]);

  /** Notify on a real transition — Claude asking for input, or finishing a run
   *  (working → idle) — unless you're already looking right at that tab (app
   *  focused and it's the visible tab), where the status dot says it all. A
   *  background tab still notifies even while you work in another tab. Skips the
   *  first status of a tab so restoring a workspace doesn't fire a burst. */
  const maybeNotify = useCallback((tabId: string, prev: TabStatus | undefined, status: TabStatus) => {
    if (!notificationsRef.current || prev === undefined) return;
    if (document.hasFocus() && tabId === visibleTabIdRef.current) return;
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

  // Tabs whose pty has actually been spawned this session. Guards the lazy
  // wake effect (and dormant restore) against spawning the same pty twice.
  const spawnedRef = useRef<Set<string>>(new Set());

  /** Spawns the pty for an existing tab (idempotent). Used both for freshly
   *  created tabs and to lazily wake a dormant, restored tab on first view. */
  const startPty = useCallback((tab: Tab) => {
    if (spawnedRef.current.has(tab.id)) return;
    spawnedRef.current.add(tab.id);
    ipc.spawnPty({
      tabId: tab.id,
      kind: tab.kind === 'claude' ? 'claude' : tab.shellId!,
      cwd: tab.cwd,
      resumeSessionId: tab.resumeSessionId,
      cols: INITIAL_COLS,
      rows: INITIAL_ROWS,
      onData: (data) => writeToTerminal(tab.id, data),
    }).catch(() => dispatch({ type: 'exited', tabId: tab.id }));
  }, []);

  /** Puts an idle background tab to sleep: kills its pty (freeing the process)
   *  but keeps the tab as dormant, so the lazy-wake effect respawns it via
   *  `--resume` the next time it's shown. The kept xterm buffer keeps its last
   *  output visible. */
  const sleepTab = useCallback((tabId: string) => {
    sleepingRef.current.add(tabId);
    spawnedRef.current.delete(tabId);
    idleSinceRef.current.delete(tabId);
    dispatch({ type: 'sleep', tabId });
    ipc.killPty(tabId);
  }, []);

  /** Spawns a tab at an explicit project folder — used for user-initiated new
   *  sessions and for resuming a past session; the pty starts immediately. */
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
      setShowHome(false);
      startPty(tab);
    },
    [startPty],
  );

  // Restore the previous workspace (projects + open tabs) once on startup.
  // Restored tabs are added *dormant* — no pty is spawned until a tab is first
  // shown as a live terminal (see the lazy-wake effect below), so reopening the
  // app with N sessions doesn't launch N claude/shell processes at once.
  useEffect(() => {
    let cancelled = false;
    ipc.loadWorkspace().then((ws) => {
      if (cancelled) return;
      setCollapsed(ws.collapsed);
      setProjects(ws.projects);
      for (const saved of ws.tabs) {
        dispatch({
          type: 'add',
          tab: {
            id: crypto.randomUUID(),
            kind: saved.kind,
            name: saved.name,
            shellId: saved.shellId,
            cwd: saved.cwd,
            resumeSessionId: saved.resumeSessionId,
            exited: false,
            status: 'new',
            dormant: true,
          },
        });
      }
    }).catch(() => {}).finally(() => {
      if (!cancelled) setWorkspaceLoaded(true);
    });
    return () => { cancelled = true; };
    // Runs once on mount.
  }, []);

  // Persist the workspace (debounced) whenever it changes, once the initial
  // load has finished — otherwise this would overwrite the saved state with
  // the empty pre-load state.
  useEffect(() => {
    if (!workspaceLoaded) return;
    const timer = setTimeout(() => {
      const tabs: SavedTab[] = state.tabs
        // File tabs aren't restored across restarts yet (no path in SavedTab).
        .filter((t) => !t.exited && t.kind !== 'file')
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
      const next = new Map(prev);
      next.delete(tabId);
      return next;
    });
    dispatch({ type: 'close', tabId });
  }, []);

  /** Set a tab's view mode: terminal (default), full markdown, or split. */
  const setTabMode = useCallback((tabId: string, mode: SessionMode) => {
    setMdTabs((prev) => {
      const next = new Map(prev);
      if (mode === 'terminal') next.delete(tabId);
      else next.set(tabId, mode);
      return next;
    });
  }, []);

  const handleSelectTab = useCallback((tabId: string) => {
    setShowHistory(false);
    setShowSettings(false);
    setShowHome(false);
    dispatch({ type: 'select', tabId });
  }, []);

  /** Opens a file from the explorer as a read-only tab — reuses the tab if
   *  that file is already open instead of duplicating it. No pty involved. */
  const handleOpenFile = useCallback((dir: string, path: string) => {
    const existing = state.tabs.find((t) => t.kind === 'file' && t.path === path);
    if (existing) {
      handleSelectTab(existing.id);
      return;
    }
    const tab: Tab = {
      id: crypto.randomUUID(),
      kind: 'file',
      name: path.split(/[/\\]/).pop() || path,
      shellId: null,
      cwd: dir,
      resumeSessionId: null,
      exited: false,
      status: 'new',
      path,
    };
    dispatch({ type: 'add', tab });
    setShowHistory(false);
    setShowSettings(false);
    setShowHome(false);
  }, [state.tabs, handleSelectTab]);

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

  const handleOpenDirectory = useCallback((dir: string) => {
    ipc.openDirectory(dir);
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
    setMdTabs((prev) => new Map(prev).set(tab.id, 'markdown'));
  }, []);

  const activeTab = state.tabs.find((t) => t.id === state.activeTabId) ?? null;
  const activeReadable = !!activeTab && activeTab.kind === 'claude' && !!activeTab.resumeSessionId;
  const overlaysUp = showHistory || showSettings || readerTarget !== null;
  const fileUp = !!activeTab && activeTab.kind === 'file';
  // Home covers the terminal too, but unlike the overlays it *is* the resting
  // state when nothing is open, so it gets its own flag.
  const homeUp = showHome || state.tabs.length === 0;
  const barVisible = settings.showSessionBar && activeTab !== null && !overlaysUp;
  // Markdown reading needs both prefs on (so there's always a bar toggle to leave it by).
  const canRead = settings.showSessionBar && settings.showMarkdownToggle && activeReadable;
  // The active tab's view mode (terminal unless it can be read AND is toggled).
  const activeMode: SessionMode = (canRead && activeTab && mdTabs.get(activeTab.id)) || 'terminal';
  // Markdown pane is on screen (markdown or split); its transcript must load.
  const mdReading = activeMode === 'markdown' || activeMode === 'split';
  // Markdown fully replaces the terminal (terminal hidden, no live process needed).
  const mdFull = activeMode === 'markdown';
  const splitActive = activeMode === 'split';
  // Feed the notification guard: which tab is genuinely on screen right now. In
  // split the terminal is still visible, so only full-markdown counts as hidden.
  visibleTabIdRef.current = overlaysUp || homeUp || mdFull ? null : activeTab?.id ?? null;

  // Lazily spawn a dormant (restored) tab's pty the first time it's actually
  // shown as a live terminal. Full-markdown reading or an overlay doesn't need
  // the process; split does (the terminal half is live), so only mdFull blocks.
  useEffect(() => {
    if (!activeTab || !activeTab.dormant) return;
    if (overlaysUp || homeUp || mdFull) return;
    startPty(activeTab);
    dispatch({ type: 'wake', tabId: activeTab.id });
  }, [activeTab, overlaysUp, homeUp, mdFull, startPty]);

  // Auto-sleep idle background Claude sessions. Every tick, a resumable Claude
  // tab that's been idle and off-screen for the configured threshold is put to
  // sleep. The tab on screen, shell tabs, and sessions without a resume id are
  // never touched. Reads live tabs/visibility/threshold from refs so the
  // interval isn't torn down and rebuilt on every state change.
  useEffect(() => {
    const timer = setInterval(() => {
      const threshold = autoSleepMsRef.current;
      if (threshold <= 0) {
        idleSinceRef.current.clear(); // disabled — drop any pending timers
        return;
      }
      const now = Date.now();
      const visibleId = visibleTabIdRef.current;
      for (const tab of tabsRef.current) {
        const eligible =
          tab.kind === 'claude' &&
          !tab.dormant &&
          !tab.exited &&
          tab.status === 'idle' &&
          !!tab.resumeSessionId &&
          tab.id !== visibleId;
        if (!eligible) {
          idleSinceRef.current.delete(tab.id);
          continue;
        }
        const since = idleSinceRef.current.get(tab.id);
        if (since === undefined) {
          idleSinceRef.current.set(tab.id, now);
        } else if (now - since >= threshold) {
          sleepTab(tab.id);
        }
      }
    }, SLEEP_CHECK_MS);
    return () => clearInterval(timer);
  }, [sleepTab]);

  // Drag-to-resize the split seam. Tracks the pointer on window (not the seam)
  // so a fast drag doesn't outrun the 1px handle, and clamps the ratio so both
  // panes keep a usable minimum.
  useEffect(() => {
    if (!draggingSeam) return;
    const onMove = (e: MouseEvent) => {
      const row = splitRowRef.current;
      if (!row) return;
      const r = row.getBoundingClientRect();
      const ratio = (e.clientX - r.left) / r.width;
      setSplitRatio(Math.min(0.75, Math.max(0.25, ratio)));
    };
    const onUp = () => setDraggingSeam(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [draggingSeam]);

  // Drag-to-resize the file explorer panel, same pattern as the split seam
  // above but tracking width from the panel's own right edge (it's docked to
  // the window edge, not a fixed-position row).
  useEffect(() => {
    if (!draggingFilesSeam) return;
    const onMove = (e: MouseEvent) => {
      const panel = filesPanelRef.current;
      if (!panel) return;
      const r = panel.getBoundingClientRect();
      setFilesPanelWidth(Math.min(480, Math.max(200, r.right - e.clientX)));
    };
    const onUp = () => setDraggingFilesSeam(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [draggingFilesSeam]);

  // Live-follow: while the transcript is on screen, re-read it on a steady tick
  // so new turns appear as Claude answers — including plain-text replies, which
  // never flip the tab to `working`. The read is cheap to ignore when nothing
  // changed (useTranscript skips identical content), so a quiet session doesn't
  // re-render; only real growth updates the view.
  useEffect(() => {
    if (!mdReading || overlaysUp || !activeTab || activeTab.exited) return;
    const timer = setInterval(() => setMdReload((k) => k + 1), LIVE_FOLLOW_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mdReading, overlaysUp, activeTab?.id, activeTab?.exited]);

  const { turns, error } = useTranscript(
    mdReading && activeTab ? activeTab.cwd : null,
    mdReading && activeTab ? activeTab.resumeSessionId : null,
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
        showFiles={showFiles}
        projects={projects}
        collapsed={collapsed}
        onSelectTab={handleSelectTab}
        onCloseTab={handleCloseTab}
        onReadTab={handleReadTab}
        onOpenDirectory={handleOpenDirectory}
        markdownEnabled={settings.showSessionBar && settings.showMarkdownToggle}
        onNewClaudeTab={handleNewClaudeTab}
        onNewShellTab={handleNewShellTab}
        onRenameTab={handleRenameTab}
        onToggleHistory={() => { setShowHistory((v) => !v); setShowSettings(false); setShowHome(false); }}
        onToggleSettings={() => { setShowSettings((v) => !v); setShowHistory(false); setShowHome(false); }}
        onToggleFiles={() => setShowFiles((v) => !v)}
        showHome={homeUp}
        onGoHome={() => { setShowHome((v) => !v); setShowHistory(false); setShowSettings(false); }}
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
            mode={activeMode}
            view={mdView}
            turnsCount={turns ? turns.length : null}
            markdownText={fullMarkdown}
            onSetMode={(m) => setTabMode(activeTab.id, m)}
            onSetView={setMdView}
            onRefresh={() => setMdReload((k) => k + 1)}
          />
        )}
        <div className="relative flex-1 min-h-0">
          {/* Terminal (left) and markdown (right) share the pane: full-width
              alone, or side by side in split mode, divided by a draggable seam. */}
          <div ref={splitRowRef} className="absolute inset-0 flex">
            <div
              className={cn('relative flex flex-col min-w-0', mdFull ? 'hidden' : splitActive ? 'shrink-0' : 'flex-1')}
              style={splitActive ? { width: `${splitRatio * 100}%` } : undefined}
            >
              {splitActive && (
                <div className="flex items-center gap-1.5 h-7 px-3 shrink-0 border-b border-border bg-card">
                  <SquareTerminal size={11} className="text-muted-foreground shrink-0" />
                  <span className="font-mono text-[10px] tracking-[0.12em] uppercase text-muted-foreground">Terminal</span>
                </div>
              )}
              <div className="relative flex-1 min-h-0">
                {state.tabs.filter((tab) => tab.kind !== 'file').map((tab) => (
                  <Terminal
                    key={tab.id}
                    tabId={tab.id}
                    isVisible={tab.id === state.activeTabId && !overlaysUp && !homeUp && !mdFull}
                  />
                ))}
                {!overlaysUp && fileUp && activeTab?.path && (
                  <div className="absolute inset-0 flex flex-col bg-background">
                    <FileViewer path={activeTab.path} />
                  </div>
                )}
                {!overlaysUp && !mdReading && !fileUp && homeUp && (
                  <HomeScreen
                    projects={projects}
                    tabs={state.tabs}
                    onResume={handleResumeSession}
                    onSelectTab={handleSelectTab}
                    onNewSession={handleNewClaudeTab}
                    onAddProject={handleAddProject}
                    onOpenHistory={() => { setShowHistory(true); setShowSettings(false); setShowHome(false); }}
                  />
                )}
              </div>
            </div>
            {splitActive && (
              <div
                onMouseDown={() => setDraggingSeam(true)}
                className="group relative w-px shrink-0 cursor-col-resize bg-border-hover shadow-[-14px_0_22px_-18px_rgba(0,0,0,0.9)]"
                title="Drag to resize"
              >
                {/* wider invisible hit-area over the 1px line */}
                <span className="absolute inset-y-0 -left-1.5 -right-1.5" />
                <span className={cn(
                  'absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1 h-8 rounded-full bg-border-hover',
                  'transition-colors group-hover:bg-muted-foreground',
                  draggingSeam && 'bg-primary',
                )} />
              </div>
            )}
            {mdReading && (
              <MarkdownPane
                turns={turns}
                error={error}
                view={mdView}
                label={splitActive ? 'Transcript' : undefined}
                fill={splitActive}
                className={splitActive ? 'flex-1 bg-card' : 'flex-1'}
              />
            )}
            {draggingSeam && <div className="fixed inset-0 z-50 cursor-col-resize" />}
          </div>
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
        </div>
      </main>
      {showFiles && (
        <>
          <div
            onMouseDown={() => setDraggingFilesSeam(true)}
            className="relative w-px shrink-0 cursor-col-resize bg-border-hover"
            title="Drag to resize"
          >
            {/* wider invisible hit-area over the 1px line */}
            <span className="absolute inset-y-0 -left-1.5 -right-1.5" />
          </div>
          <div ref={filesPanelRef} style={{ width: filesPanelWidth }} className="shrink-0 border-l border-border overflow-hidden">
            <FileExplorerPanel
              projects={projects}
              activePath={fileUp ? activeTab?.path ?? null : null}
              onOpenFile={handleOpenFile}
            />
          </div>
        </>
      )}
      {draggingFilesSeam && <div className="fixed inset-0 z-50 cursor-col-resize" />}
      <CommandPalette
        open={paletteOpen}
        tabs={state.tabs}
        onClose={() => setPaletteOpen(false)}
        onSelectTab={handleSelectTab}
      />
    </div>
  );
}
