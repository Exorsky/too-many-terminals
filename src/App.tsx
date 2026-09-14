import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import CommandPalette from '@/components/CommandPalette';
import FileExplorerPanel, { FilesEdge } from '@/components/FileExplorerPanel';
import HomeScreen from '@/components/HomeScreen';
import PaneView from '@/components/PaneView';
import Seam from '@/components/Seam';
import { type MarkdownView, type SessionMode, type SplitDirection } from '@/components/SessionControls';
import SessionHistoryPanel from '@/components/SessionHistoryPanel';
import SessionReader from '@/components/SessionReader';
import SettingsView from '@/components/SettingsView';
import Sidebar from '@/components/Sidebar';
import { disposeTerminal, writeToTerminal } from '@/components/terminalCache';
import * as ipc from '@/lib/ipc';
import { isPaneDrag, TAB_MIME, type FileDragPayload } from '@/lib/dnd';
import { findPane, paneRect, panesOf, seamBands, visibleTabIds, type Edge, type Pane } from '@/lib/panes';
import { useSettings } from '@/lib/settings-store';
import { activeTabId, initialTabsState, learnSessionNames, tabsReducer, UNNAMED_TAB } from '@/lib/tabs';
import { useDragValue } from '@/lib/use-drag-value';
import { cn } from '@/lib/utils';
import type { SavedTab, SessionHistoryEntry, ShellOption, Tab, TabKind, TabStatus } from '@/types';

const INITIAL_COLS = 120;
const INITIAL_ROWS = 40;
const SAVE_DEBOUNCE_MS = 300;
// How often we scan for idle background sessions to auto-sleep. The threshold
// itself is user-configurable (settings.autoSleepMinutes; 0 disables).
const SLEEP_CHECK_MS = 60 * 1000;

/** Would splitting this pane off `tabId` leave it with nothing? Then there is
 *  no split to make — the pane would empty and collapse back immediately. */
function splitWouldEmpty(pane: Pane, tabId: string | null | undefined): boolean {
  return !!tabId && pane.tabIds.length === 1 && pane.tabIds[0] === tabId;
}

export default function App() {
  const [state, dispatch] = useReducer(tabsReducer, initialTabsState);
  const [shellOptions, setShellOptions] = useState<ShellOption[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  // Session id → name, accumulated from every tab that ever carried a real
  // name and persisted with the workspace. Outlives the tab, which is the whole
  // point: a closed session keeps its name in History, and resuming it gets
  // that name back instead of a fresh one cut from the transcript.
  const [sessionNames, setSessionNames] = useState<Record<string, string>>({});
  const [homeDir, setHomeDir] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // Three states, not two. `peek` lays the panel over the terminal instead of
  // beside it, which is the whole point: docking it is a layout change, so
  // every open and every close runs main through `ResizeObserver` →
  // `fitAddon.fit()` → `pty_resize` and the terminal rewraps every line it is
  // showing. An overlay costs none of that.
  // See docs/features/file-explorer.md.
  const [filesMode, setFilesMode] = useState<'hidden' | 'peek' | 'pinned'>('pinned');
  const [filesPanelWidth, setFilesPanelWidth] = useState(260);
  const filesPinned = filesMode === 'pinned';
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
  // Which edge a tab's transcript opens against. A window-level preference —
  // "how I like to look at things" — not session state, so it's shared by every
  // pane rather than stored per tab.
  // ponytail: one shared transcript direction; per-pane would need transcripts
  // to become their own tab kind, which is a separate refactor.
  const [splitDirection, setSplitDirection] = useState<SplitDirection>('right');
  const { layout } = state;
  const gridRef = useRef<HTMLDivElement>(null);

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
    const tabsInDir = state.tabs.filter((t) => t.cwd === dir);
    const dirtyCount = tabsInDir.filter((t) => t.dirty).length;
    if (dirtyCount > 0 && !window.confirm(
      `${dirtyCount} file${dirtyCount === 1 ? '' : 's'} in this folder ${dirtyCount === 1 ? 'has' : 'have'} unsaved changes. Remove folder without saving?`,
    )) return;
    for (const tab of tabsInDir) {
      ipc.killPty(tab.id);
      disposeTerminal(tab.id);
      dispatch({ type: 'close', tabId: tab.id });
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
  // Which tabs are on screen right now, as a set — read by the notification
  // guard and the auto-sleep sweep, both of which run off a timer and so need
  // the live value rather than a render-time closure.
  const visibleTabIdsRef = useRef<Set<string>>(new Set());

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
    if (document.hasFocus() && visibleTabIdsRef.current.has(tabId)) return;
    const name = tabsRef.current.find((t) => t.id === tabId)?.name ?? 'Claude';
    if (status === 'requires_response') void ipc.notify(name, 'Needs your input');
    else if (status === 'idle' && prev === 'working') void ipc.notify(name, 'Finished');
  }, []);

  // Claude Code's own hooks report live tab state (idle/working/awaiting
  // input) and, once the first prompt is submitted, a generated title.
  useEffect(() => {
    const unlisten = ipc.onTabStatus((tabId, status, detail) => {
      const prev = prevStatusRef.current.get(tabId);
      prevStatusRef.current.set(tabId, status);
      dispatch({ type: 'status', tabId, status, detail });
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
      setSessionNames(ws.sessionNames ?? {});
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
            pinned: saved.pinned,
          },
        });
      }
    }).catch(() => {}).finally(() => {
      if (!cancelled) setWorkspaceLoaded(true);
    });
    return () => { cancelled = true; };
    // Runs once on mount.
  }, []);

  // Learn every session's name as soon as a tab carries one, so it's already
  // recorded by the time that tab is closed. Runs on tab changes rather than in
  // the rename action because a name can also arrive with a restored tab.
  useEffect(() => {
    setSessionNames((prev) => learnSessionNames(prev, state.tabs));
  }, [state.tabs]);

  // Persist the workspace (debounced) whenever it changes, once the initial
  // load has finished — otherwise this would overwrite the saved state with
  // the empty pre-load state.
  useEffect(() => {
    if (!workspaceLoaded) return;
    const timer = setTimeout(() => {
      const tabs: SavedTab[] = state.tabs
        // File tabs aren't restored across restarts yet (no path in SavedTab).
        .filter((t) => !t.exited && t.kind !== 'file')
        .map((t) => ({ kind: t.kind, name: t.name, shellId: t.shellId, resumeSessionId: t.resumeSessionId, cwd: t.cwd, pinned: t.pinned }));
      ipc.saveWorkspace({ projects, collapsed, tabs, sessionNames }).catch(() => {});
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [workspaceLoaded, state.tabs, projects, collapsed, sessionNames]);

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
    const tab = state.tabs.find((t) => t.id === tabId);
    if (tab?.dirty && !window.confirm(`“${tab.name}” has unsaved changes. Close without saving?`)) return;
    ipc.killPty(tabId);
    disposeTerminal(tabId);
    setMdTabs((prev) => {
      if (!prev.has(tabId)) return prev;
      const next = new Map(prev);
      next.delete(tabId);
      return next;
    });
    dispatch({ type: 'close', tabId });
  }, [state.tabs]);

  /** The strip's ×: a session only *leaves the strip* — it's still open, still
   *  running, still in the sidebar, which is what owns a session's life. A file
   *  has no such home, so closing its tab really closes the file. */
  const handleCloseBarTab = useCallback((tabId: string) => {
    const tab = state.tabs.find((t) => t.id === tabId);
    if (!tab || tab.kind === 'file') { handleCloseTab(tabId); return; }
    // The neighbour that takes its place — and collapsing the pane if that was
    // its last tab — is `closePaneTab`'s job, in lib/panes.ts.
    dispatch({ type: 'removeFromPane', tabId });
  }, [state.tabs, handleCloseTab]);

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
    // A tab already on the grid gets its pane focused rather than moved; one
    // that isn't opens in the focused pane. See `activateTab` in lib/panes.ts.
    dispatch({ type: 'select', tabId });
  }, []);

  /** Opens a file from the explorer as a read-only tab — reuses the tab if
   *  that file is already open instead of duplicating it. No pty involved. */
  // A peek closes on losing focus — Escape or a click outside it — and never
  // on the pointer leaving. Reaching a file deep in the tree walks the cursor
  // past the panel's edges, and a mouseleave rule would cancel the errand
  // halfway through. This is the line between a hover menu and a tool window;
  // JetBrains calls the same mode Dock Unpinned and hides it the same way.
  useEffect(() => {
    if (filesMode !== 'peek') return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFilesMode('hidden'); };
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (target?.closest('[data-files-panel]') || target?.closest('[data-files-edge]')) return;
      setFilesMode('hidden');
    };
    document.addEventListener('keydown', onKey);
    // Capture, so a click that opens something else still dismisses first.
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [filesMode]);

  const handleOpenFile = useCallback((
    dir: string,
    path: string,
    /** Where to put it. Omitted (the explorer's own click) means the focused
     *  pane; a drop names the pane and, for an edge, splits it off there. */
    target?: { paneId: string; edge: Edge | null },
  ) => {
    // Opening a file is the peek's own ending — look, take, gone. Pinning is
    // what you do when you want the panel to stay.
    setFilesMode((m) => (m === 'peek' ? 'hidden' : m));
    const place = (tabId: string) => {
      if (!target) return;
      dispatch(target.edge
        ? { type: 'splitTab', tabId, paneId: target.paneId, edge: target.edge }
        : { type: 'moveTab', tabId, paneId: target.paneId });
    };
    const existing = state.tabs.find((t) => t.kind === 'file' && t.path === path);
    if (existing) {
      if (target) place(existing.id);
      else handleSelectTab(existing.id);
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
    // `add` lands it in the focused pane; a drop then moves it where it was
    // actually dropped.
    place(tab.id);
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

  const handleTogglePin = useCallback((tabId: string) => {
    const tab = state.tabs.find((t) => t.id === tabId);
    if (tab) dispatch({ type: 'pin', tabId, pinned: !tab.pinned });
  }, [state.tabs]);

  const handleOpenDirectory = useCallback((dir: string) => {
    ipc.openDirectory(dir);
  }, []);

  /** Hands a live tab off to the VS Code Claude Code extension. Sleeps the
   *  tab first (frees the pty) so only one `claude` process is ever
   *  appending to the transcript — clicking the tab again later wakes it
   *  with `--resume` and picks up whatever happened in VS Code. */
  const handleOpenInVscode = useCallback(
    (tabId: string) => {
      const tab = state.tabs.find((t) => t.id === tabId);
      if (!tab?.resumeSessionId) return;
      sleepTab(tabId);
      ipc.openInVscode(tab.cwd, tab.resumeSessionId);
    },
    [state.tabs, sleepTab],
  );

  const handleResumeSession = useCallback(
    (dir: string, entry: SessionHistoryEntry) => {
      // The name History showed for this row, so the tab you get back is the
      // one you picked. Only sessions never named at all fall back to the
      // transcript's opening line.
      const name = sessionNames[entry.sessionId] || entry.preview.slice(0, 30) || UNNAMED_TAB;
      setReaderTarget(null);
      spawnTabAt(dir, 'claude', null, name, entry.sessionId);
    },
    [spawnTabAt, sessionNames],
  );

  const handleReadSession = useCallback(
    (dir: string, entry: SessionHistoryEntry) => setReaderTarget({ projectDir: dir, entry }),
    [],
  );

  /** Imports a transcript file a colleague exported from another machine into
   *  `dir`, then opens it as a resumed tab — see docs/features/session-transfer.md.
   *  The tab starts unnamed (the sender's name lives in their workspace, not the
   *  transcript); History shows the real preview and you can rename. */
  const handleImportSession = useCallback(
    async (dir: string) => {
      const sessionId = await ipc.importSession(dir).catch((e) => { window.alert(String(e)); return null; });
      if (sessionId) spawnTabAt(dir, 'claude', null, UNNAMED_TAB, sessionId);
    },
    [spawnTabAt],
  );

  const currentTabId = activeTabId(state);
  const activeTab = state.tabs.find((t) => t.id === currentTabId) ?? null;
  const overlaysUp = showHistory || showSettings || readerTarget !== null;
  const fileUp = !!activeTab && activeTab.kind === 'file';
  // Home covers the grid too, but unlike the overlays it *is* the resting
  // state when nothing is open, so it gets its own flag.
  const homeUp = showHome || state.tabs.length === 0;

  /** Every tab genuinely on screen — one per pane, not just the focused one.
   *  This is the thing the grid changed: with up to four terminals visible,
   *  "is this tab on screen" stopped being a single id. A tab reading as full
   *  markdown is excluded: its terminal is hidden and needs no live process. */
  const visible = useMemo(() => {
    if (overlaysUp || homeUp) return new Set<string>();
    const ids = visibleTabIds(layout);
    for (const id of ids) {
      if (mdTabs.get(id) === 'markdown') ids.delete(id);
    }
    return ids;
  }, [overlaysUp, homeUp, layout, mdTabs]);
  visibleTabIdsRef.current = visible;

  // Lazily spawn a dormant (restored) tab's pty the first time it's actually
  // shown as a live terminal — now for every pane, since a tab can be on screen
  // in a pane you aren't typing into. `startPty` is idempotent via `spawnedRef`.
  useEffect(() => {
    for (const id of visible) {
      const tab = state.tabs.find((t) => t.id === id);
      if (!tab?.dormant) continue;
      startPty(tab);
      dispatch({ type: 'wake', tabId: id });
    }
  }, [visible, state.tabs, startPty]);

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
      const onScreen = visibleTabIdsRef.current;
      for (const tab of tabsRef.current) {
        const eligible =
          tab.kind === 'claude' &&
          !tab.dormant &&
          !tab.exited &&
          tab.status === 'idle' &&
          !!tab.resumeSessionId &&
          // Any pane you can see counts as on screen, not just the focused one.
          !onScreen.has(tab.id);
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

  // What's being dragged right now, if anything — one listener for the whole
  // window rather than a flag threaded through every drag source. The drop
  // zones only mount while this is set, so they never sit between the pointer
  // and the terminal. `tabId` is null for a file drag.
  //
  // `dragstart` must be BUBBLE phase. React attaches its handlers at the root
  // container, so a source only calls `setData` as the event bubbles; a
  // capture-phase listener here runs first, reads an empty `types`, and leaves
  // every pane with no drop target and no visible sign why. `getData` *is*
  // readable during dragstart (unlike dragover), so the payload can be read
  // here too.
  const [drag, setDrag] = useState<{ tabId: string | null } | null>(null);
  const endDrag = useCallback(() => setDrag(null), []);
  useEffect(() => {
    const onStart = (e: DragEvent) => {
      if (!e.dataTransfer || !isPaneDrag(e.dataTransfer.types)) return;
      setDrag({ tabId: e.dataTransfer.getData(TAB_MIME) || null });
    };
    window.addEventListener('dragstart', onStart);
    window.addEventListener('dragend', endDrag, true);
    return () => {
      window.removeEventListener('dragstart', onStart);
      window.removeEventListener('dragend', endDrag, true);
    };
  }, [endDrag]);

  /** A tab dropped on a pane: an edge splits it off, the centre just moves it
   *  into that pane's strip. `splitPane` itself degrades to a move when the
   *  pane has no room, so there is nothing to check here.
   *
   *  Ends the drag here rather than from a window `drop` listener: the tab
   *  strip stops propagation on its own drops, so a listener up there would
   *  miss them and leave the zones on screen. */
  const handleDropTab = useCallback((tabId: string, paneId: string, zone: Edge | 'center') => {
    endDrag();
    const pane = findPane(layout, paneId);
    // Splitting a pane off its own only tab would empty it and collapse it
    // right back — the same pane, a new id, and every terminal in it remounted
    // and rewrapped for nothing. Leave it alone.
    if (zone !== 'center' && pane && splitWouldEmpty(pane, tabId)) return;
    dispatch(zone === 'center'
      ? { type: 'moveTab', tabId, paneId }
      : { type: 'splitTab', tabId, paneId, edge: zone });
  }, [endDrag, layout]);

  const handleDropFile = useCallback((payload: FileDragPayload, paneId: string, zone: Edge | 'center') => {
    endDrag();
    handleOpenFile(payload.dir, payload.path, { paneId, edge: zone === 'center' ? null : zone });
  }, [handleOpenFile, endDrag]);

  // The grid's two seams and the file panel's, all on one hook — they were the
  // same twenty lines of window-tracked mousemove three times over.
  const [draggingCol, startColSeam] = useDragValue(
    (e) => {
      const g = gridRef.current;
      if (!g) return null;
      const r = g.getBoundingClientRect();
      return (e.clientX - r.left) / r.width;
    },
    (frac) => dispatch({ type: 'seam', axis: 'col', frac }),
  );
  const [draggingRow, startRowSeam] = useDragValue(
    (e) => {
      const g = gridRef.current;
      if (!g) return null;
      const r = g.getBoundingClientRect();
      return (e.clientY - r.top) / r.height;
    },
    (frac) => dispatch({ type: 'seam', axis: 'row', frac }),
  );
  const [draggingFilesSeam, startFilesSeam] = useDragValue(
    (e) => {
      const panel = filesPanelRef.current;
      if (!panel) return null;
      return panel.getBoundingClientRect().right - e.clientX;
    },
    (width) => setFilesPanelWidth(Math.min(480, Math.max(200, width))),
  );

  // An L-shaped grid splits only one of its rows, so the vertical seam has to
  // stop at the row that isn't split (and vice versa).
  const bands = seamBands(layout.grid);
  const colSeamShown = bands.vertical[0] || bands.vertical[1];
  const rowSeamShown = bands.horizontal[0] || bands.horizontal[1];

  return (
    <div className="relative flex h-screen bg-background text-foreground">
      <Sidebar
        tabs={state.tabs}
        activeTabId={currentTabId}
        shellOptions={shellOptions}
        showHistory={showHistory}
        showSettings={showSettings}
        showFiles={filesPinned}
        projects={projects}
        collapsed={collapsed}
        onSelectTab={handleSelectTab}
        onCloseTab={handleCloseTab}
        onOpenDirectory={handleOpenDirectory}
        onOpenInVscode={handleOpenInVscode}
        onNewClaudeTab={handleNewClaudeTab}
        onNewShellTab={handleNewShellTab}
        onRenameTab={handleRenameTab}
        onTogglePin={handleTogglePin}
        onOpenSearch={() => setPaletteOpen(true)}
        onToggleHistory={() => { setShowHistory((v) => !v); setShowSettings(false); setShowHome(false); }}
        onToggleSettings={() => { setShowSettings((v) => !v); setShowHistory(false); setShowHome(false); }}
        onToggleFiles={() => setFilesMode((m) => (m === 'pinned' ? 'hidden' : 'pinned'))}
        showHome={homeUp}
        onGoHome={() => { setShowHome((v) => !v); setShowHistory(false); setShowSettings(false); }}
        onAddProject={handleAddProject}
        onRemoveProject={handleRemoveProject}
        onImportSession={handleImportSession}
        onReorderProject={handleReorderProject}
        onToggleCollapse={() => setCollapsed((v) => !v)}
      />
      <main className="relative flex-1 min-w-0 flex flex-col" data-terminal-area>
        <div className="relative flex-1 min-h-0">
          {/* The pane grid. Up to four panes on a 2x2 of cells, each owning its
              own tab strip; a pane spanning several cells just spans grid
              tracks. Both rows share one column seam and both columns share one
              row seam — that's what makes it a grid rather than a pane tree.
              See docs/features/panes.md.

              Hidden here, never unmounted: dropping the grid would unmount
              every <Terminal>, and coming back would re-attach and rewrap all
              of them. Their own `isVisible` is already false while an overlay
              or Home is up, so the ResizeObserver is disconnected and
              display:none costs no fit. */}
          <div
            ref={gridRef}
            className={cn('absolute inset-0 grid', (overlaysUp || homeUp) && 'hidden')}
            style={{
              gridTemplateColumns: `${layout.colFrac}fr ${1 - layout.colFrac}fr`,
              gridTemplateRows: `${layout.rowFrac}fr ${1 - layout.rowFrac}fr`,
            }}
          >
            {panesOf(layout.grid).map((paneId) => {
              const pane = findPane(layout, paneId);
              if (!pane) return null;
              const rect = paneRect(layout.grid, paneId);
              return (
                <PaneView
                  key={paneId}
                  pane={pane}
                  tabs={state.tabs}
                  focused={paneId === layout.focusedPaneId}
                  visible={visible}
                  showMarkdownToggle={settings.showMarkdownToggle}
                  mdTabs={mdTabs}
                  splitDirection={splitDirection}
                  mdView={mdView}
                  onSetMdView={setMdView}
                  onSetMode={setTabMode}
                  onSetSplitDirection={setSplitDirection}
                  onSelectTab={handleSelectTab}
                  onCloseBarTab={handleCloseBarTab}
                  onReorderTab={(tabId, targetTabId, position) =>
                    dispatch({ type: 'moveTab', tabId, paneId, targetTabId, position })}
                  onFocus={() => dispatch({ type: 'focusPane', paneId })}
                  onInterrupt={(tabId) => dispatch({ type: 'interrupt', tabId })}
                  onDirtyChange={(tabId, dirty) => dispatch({ type: 'dirty', tabId, dirty })}
                  onOpenFile={handleOpenFile}
                  onSplitTab={(tabId, edge) => dispatch({ type: 'splitTab', tabId, paneId, edge })}
                  dragging={drag !== null}
                  onDropTab={(tabId, zone) => handleDropTab(tabId, paneId, zone)}
                  onDropFile={(payload, zone) => handleDropFile(payload, paneId, zone)}
                  // A pane one cell wide can't split sideways again, and one
                  // cell tall can't split down. Nor can a pane be split off its
                  // own only tab: the tab would leave, the pane would empty and
                  // collapse straight back. Saying so here is what keeps the
                  // drop highlight from promising a split that won't happen.
                  canSplit={{
                    vertical: rect.colSpan > 1 && !splitWouldEmpty(pane, drag?.tabId),
                    horizontal: rect.rowSpan > 1 && !splitWouldEmpty(pane, drag?.tabId),
                  }}
                  style={{
                    gridRow: `${rect.row + 1} / span ${rect.rowSpan}`,
                    gridColumn: `${rect.col + 1} / span ${rect.colSpan}`,
                  }}
                />
              );
            })}

            {colSeamShown && (
              <Seam
                orientation="vertical"
                dragging={draggingCol}
                onStart={startColSeam}
                className="absolute"
                style={{
                  left: `${layout.colFrac * 100}%`,
                  top: bands.vertical[0] ? 0 : `${layout.rowFrac * 100}%`,
                  bottom: bands.vertical[1] ? 0 : `${(1 - layout.rowFrac) * 100}%`,
                }}
              />
            )}
            {rowSeamShown && (
              <Seam
                orientation="horizontal"
                dragging={draggingRow}
                onStart={startRowSeam}
                className="absolute"
                style={{
                  top: `${layout.rowFrac * 100}%`,
                  left: bands.horizontal[0] ? 0 : `${layout.colFrac * 100}%`,
                  right: bands.horizontal[1] ? 0 : `${(1 - layout.colFrac) * 100}%`,
                }}
              />
            )}
            {(draggingCol || draggingRow) && (
              <div className={cn('fixed inset-0 z-50', draggingCol ? 'cursor-col-resize' : 'cursor-row-resize')} />
            )}
          </div>
          {/* Home is the resting screen, so it covers the grid rather than
              living in a pane — with nothing open there is no pane to put it in. */}
          {homeUp && !overlaysUp && (
            <div className="absolute inset-0 bg-background">
              <HomeScreen projects={projects} onAddProject={handleAddProject} />
            </div>
          )}
          {showHistory && projects.length > 0 && (
            <div className="absolute inset-0 bg-background">
              <SessionHistoryPanel projects={projects} sessionNames={sessionNames} onResume={handleResumeSession} onRead={handleReadSession} />
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
      {/* Not pinned: the edge keeps a way back without taking a column. It
          stays under the overlay while peeking, so the pointer never has to
          cross a gap between the two. */}
      {!filesPinned && <FilesEdge onPeek={() => setFilesMode('peek')} />}

      {filesPinned && (
        <>
          <Seam
            orientation="vertical"
            dragging={draggingFilesSeam}
            onStart={startFilesSeam}
            className="relative shrink-0"
          />
          <div
            ref={filesPanelRef}
            data-files-panel
            style={{ width: filesPanelWidth }}
            className="shrink-0 border-l border-border overflow-hidden"
          >
            <FileExplorerPanel
              projects={projects}
              activePath={fileUp ? activeTab?.path ?? null : null}
              onOpenFile={handleOpenFile}
              pinned
              onTogglePin={() => setFilesMode('peek')}
            />
          </div>
        </>
      )}

      {/* Peeking: absolutely placed, so main never changes width and the
          terminal never rewraps. No resize seam — the width you drag in the
          docked mode is the width this uses. */}
      {filesMode === 'peek' && (
        <div
          data-files-panel
          style={{ width: filesPanelWidth }}
          className="absolute right-0 top-0 bottom-0 z-40 border-l border-border overflow-hidden shadow-[-18px_0_34px_-18px_rgba(0,0,0,0.9)]"
        >
          <FileExplorerPanel
            projects={projects}
            activePath={fileUp ? activeTab?.path ?? null : null}
            onOpenFile={handleOpenFile}
            pinned={false}
            onTogglePin={() => setFilesMode('pinned')}
          />
        </div>
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
