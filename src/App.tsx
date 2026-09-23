import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { CheckSquare, PanelLeft, Search, SquareTerminal } from 'lucide-react';
import CommandPalette from '@/components/CommandPalette';
import FileExplorerPanel, { FilesEdge } from '@/components/FileExplorerPanel';
import HomeScreen from '@/components/HomeScreen';
import PaneFile from '@/components/PaneFile';
import PaneSessionMenu from '@/components/PaneSessionMenu';
import PaneTabs from '@/components/PaneTabs';
import PaneDropZones from '@/components/PaneDropZones';
import SessionHistoryPanel from '@/components/SessionHistoryPanel';
import SessionInspector from '@/components/SessionInspector';
import SessionReader from '@/components/SessionReader';
import Seam from '@/components/Seam';
import SessionWorkspace from '@/components/SessionWorkspace';
import SessionsSidebar, { type NewSessionKind, type RecentEntry } from '@/components/SessionsSidebar';
import SettingsView from '@/components/SettingsView';
import TaskInspector from '@/components/TaskInspector';
import TodoView from '@/components/TodoView';
import SessionControls, { type MarkdownView, type SessionMode, type SplitDirection } from '@/components/SessionControls';
import { disposeTerminal, writeToTerminal } from '@/components/terminalCache';
import * as ipc from '@/lib/ipc';
import { isPaneDrag, FILE_MIME, TAB_MIME, VIEW_MIME, type FileDragPayload, type ViewDragPayload } from '@/lib/dnd';
import {
  activeContent, contentKey, findPane, paneRect, panesOf, seamBands, sessionContent,
  visibleSessionIds, type Edge, type Pane, type PaneContent,
} from '@/lib/panes';
import {
  learnSessionNames, restoreTab, shellPtyId, toSavedTab, UNNAMED_SESSION,
} from '@/lib/sessions';
import { useSettings } from '@/lib/settings-store';
import { addTask, linkSession, loadTasks, updateTask, useTasks } from '@/lib/tasks';
import { activeTabId, initialTabsState, sessionModeOf, tabsReducer } from '@/lib/tabs';
import { useDragValue } from '@/lib/use-drag-value';
import { cn, ICON_BUTTON } from '@/lib/utils';
import type { AppView, SessionHistoryEntry, SessionTool, ShellOption, Tab, TabStatus, Task } from '@/types';

const INITIAL_COLS = 120;
const INITIAL_ROWS = 40;
const SAVE_DEBOUNCE_MS = 300;
// How often we scan for idle background sessions to auto-sleep. The threshold
// itself is user-configurable (settings.autoSleepMinutes; 0 disables).
const SLEEP_CHECK_MS = 60 * 1000;
/** macOS gets the overlay title bar, so the nav row has to clear the native
 *  traffic lights. Read off the user agent rather than the OS plugin: it only
 *  decides a padding, and this way it costs no IPC round trip at first paint. */
const IS_MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent);

const MIN_SIDEBAR = 240;
const MAX_SIDEBAR = 420;

/** Would splitting this pane off what's being dragged leave it with nothing?
 *  Then there is no split to make — the pane would empty and collapse straight
 *  back. Only true when that tab is the pane's *only* tab. */
function splitWouldEmpty(pane: Pane, content: PaneContent | null | undefined): boolean {
  return !!content && pane.contents.length === 1
    && contentKey(pane.contents[0]) === contentKey(content);
}

/** What a drag is carrying, as pane content. Three sources, one shape: a
 *  sidebar row sends a bare session id (meaning its Claude view), a tool tab
 *  sends the session/tool pair, and the file explorer sends a path. */
function readDragContent(dt: DataTransfer): PaneContent | null {
  const view = dt.getData(VIEW_MIME);
  if (view) {
    try {
      const { sessionId, tool } = JSON.parse(view) as ViewDragPayload;
      return { kind: 'session', sessionId, tool };
    } catch {
      return null; // a malformed payload can only come from another app
    }
  }
  const file = dt.getData(FILE_MIME);
  if (file) {
    try {
      const { dir, path } = JSON.parse(file) as FileDragPayload;
      return { kind: 'file', dir, path };
    } catch {
      return null;
    }
  }
  const sessionId = dt.getData(TAB_MIME);
  return sessionId ? sessionContent(sessionId) : null;
}

/** Wraps text in the terminal's bracketed-paste markers, so a multi-line block
 *  lands in Claude Code's prompt as one paste instead of one submitted line per
 *  newline. This is what makes "start a session from a task" hand over the task
 *  *without* pressing Enter for you — see docs/features/todo.md. */
function bracketedPaste(text: string): string {
  return `\x1b[200~${text}\x1b[201~`;
}

/** The task, as the session receives it. Deliberately just the task: a title
 *  line and whatever you wrote, with no invented instructions around it. */
function taskPrompt(task: Task): string {
  return task.description.trim()
    ? `Task: ${task.title}\n\n${task.description.trim()}`
    : `Task: ${task.title}`;
}

/** Past Claude sessions for a set of directories, and when each was last
 *  written. One read answers both of the list's date questions: which sessions
 *  to offer under Recent, and how old each open session is. */
function useSessionHistory(dirs: string[], refreshKey: number) {
  const [entries, setEntries] = useState<{ dir: string; entry: SessionHistoryEntry }[]>([]);
  const key = dirs.join(' ');

  useEffect(() => {
    let alive = true;
    Promise.all(dirs.map((dir) =>
      ipc.listSessions(dir).then((list) => list.map((entry) => ({ dir, entry }))).catch(() => []),
    ))
      .then((lists) => { if (alive) setEntries(lists.flat()); })
      .catch(() => {});
    return () => { alive = false; };
    // `key` stands in for `dirs`, which is a fresh array on some renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, refreshKey]);

  const lastUsed = useMemo(() => {
    const map = new Map<string, number>();
    for (const { entry } of entries) {
      const ms = new Date(entry.lastUsedIso).getTime();
      if (!Number.isNaN(ms)) map.set(entry.sessionId, ms);
    }
    return map;
  }, [entries]);

  return { entries, lastUsed };
}

export default function App() {
  const [state, dispatch] = useReducer(tabsReducer, initialTabsState);
  const [shellOptions, setShellOptions] = useState<ShellOption[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  // Session id → name, accumulated from every session that ever carried a real
  // name and persisted with the workspace. Outlives the session, which is the
  // point: a closed one keeps its name in History, and resuming it gets that
  // name back instead of a fresh one cut from the transcript.
  const [sessionNames, setSessionNames] = useState<Record<string, string>>({});
  const [homeDir, setHomeDir] = useState<string | null>(null);
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);
  const settings = useSettings();
  const tasks = useTasks();

  // --- navigation ---------------------------------------------------------
  const [view, setView] = useState<AppView>('sessions');
  const [showSettings, setShowSettings] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [readerTarget, setReaderTarget] = useState<{ projectDir: string; entry: SessionHistoryEntry } | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(248);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  // Three states, not two. `peek` lays the explorer over the grid instead of
  // beside it, which is the whole point: docking it is a layout change, so
  // every open and close resizes every terminal on screen. An overlay costs
  // none of that — and peeking is what you do to grab one file and go.
  const [filesMode, setFilesMode] = useState<'hidden' | 'peek' | 'pinned'>('hidden');
  const [filesWidth, setFilesWidth] = useState(260);
  const filesPanelRef = useRef<HTMLDivElement>(null);
  const filesPinned = filesMode === 'pinned';
  const [focusMode, setFocusMode] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [historyKey, setHistoryKey] = useState(0);

  // --- per-session view state ---------------------------------------------
  // Which tool is showing is a property of the *pane*, not of the session —
  // that is what lets one pane show Claude while another shows the same
  // session's shell. It lives in `state.layout`.
  const [mdTabs, setMdTabs] = useState<Map<string, SessionMode>>(new Map());
  const [mdView, setMdView] = useState<MarkdownView>('rendered');
  const [splitDirection, setSplitDirection] = useState<SplitDirection>('right');

  useEffect(() => {
    ipc.listShells().then(setShellOptions).catch(() => {});
    ipc.homeDir().then(setHomeDir).catch(() => {});
    void loadTasks();
  }, []);

  const currentTabId = activeTabId(state);
  const activeTab = state.tabs.find((t) => t.id === currentTabId) ?? null;
  const overlaysUp = showSettings || showArchive || readerTarget !== null;
  const onSessions = view === 'sessions' && !overlaysUp;

  // Every directory that might hold a transcript we care about: the open
  // projects, plus each session's own cwd (which is how a scratch session's
  // history is found — its directory is its own).
  const historyDirs = useMemo(() => {
    const dirs = new Set(projects);
    for (const tab of state.tabs) if (tab.kind === 'claude') dirs.add(tab.cwd);
    return [...dirs];
  }, [projects, state.tabs]);
  const { entries, lastUsed } = useSessionHistory(historyDirs, historyKey);

  /** Past sessions that aren't open right now, newest first — the Recent group.
   *  A session you already have open belongs in its own group, not here. */
  const recent = useMemo<RecentEntry[]>(() => {
    const open = new Set(state.tabs.map((t) => t.resumeSessionId).filter(Boolean));
    return entries
      .filter(({ entry }) => !open.has(entry.sessionId))
      .map(({ dir, entry }) => ({
        dir,
        entry,
        name: sessionNames[entry.sessionId] || entry.preview.slice(0, 40) || UNNAMED_SESSION,
        at: new Date(entry.lastUsedIso).getTime() || 0,
      }))
      .sort((a, b) => b.at - a.at);
  }, [entries, state.tabs, sessionNames]);

  // --- pty lifecycle (unchanged from before the redesign) -----------------

  const sleepingRef = useRef<Set<string>>(new Set());
  const idleSinceRef = useRef<Map<string, number>>(new Map());
  const spawnedRef = useRef<Set<string>>(new Set());
  /** Text queued for a session that isn't live yet — flushed by the status
   *  listener once Claude Code's SessionStart hook says it's up. */
  const pendingPromptRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const unlisten = ipc.onPtyExit((tabId) => {
      // A kill we issued for sleep — swallow it; the session lives on dormant.
      if (sleepingRef.current.delete(tabId)) return;
      // A session's shell tool exiting is not the session exiting.
      if (tabId.endsWith('::shell')) { spawnedRef.current.delete(tabId); return; }
      dispatch({ type: 'exited', tabId });
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [dispatch]);

  useEffect(() => {
    const unlisten = ipc.onClaudeSessionResolved((tabId, sessionId) => {
      dispatch({ type: 'sessionResolved', tabId, sessionId });
      // A brand-new transcript means Recent and the age column are stale.
      setHistoryKey((k) => k + 1);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [dispatch]);

  const tabsRef = useRef(state.tabs);
  tabsRef.current = state.tabs;
  const notificationsRef = useRef(settings.notificationsEnabled);
  notificationsRef.current = settings.notificationsEnabled;
  const autoSleepMsRef = useRef(0);
  autoSleepMsRef.current = settings.autoSleepMinutes * 60 * 1000;
  const prevStatusRef = useRef<Map<string, TabStatus>>(new Map());
  /** The session on screen right now, as a set of one — read by the
   *  notification guard and the auto-sleep sweep, both of which run off a
   *  timer and so need the live value rather than a render-time closure. */
  const visibleTabIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (settings.notificationsEnabled) void ipc.ensureNotificationPermission();
  }, [settings.notificationsEnabled]);

  /** Notify on a real transition — Claude asking for input, or finishing a run
   *  — unless you're already looking right at that session. Skips the first
   *  status of a session so restoring a workspace doesn't fire a burst. */
  const maybeNotify = useCallback((tabId: string, prev: TabStatus | undefined, status: TabStatus) => {
    if (!notificationsRef.current || prev === undefined) return;
    if (document.hasFocus() && visibleTabIdsRef.current.has(tabId)) return;
    const name = tabsRef.current.find((t) => t.id === tabId)?.name ?? 'Claude';
    if (status === 'requires_response') void ipc.notify(name, 'Needs your input');
    else if (status === 'idle' && prev === 'working') void ipc.notify(name, 'Finished');
  }, []);

  useEffect(() => {
    const unlisten = ipc.onTabStatus((tabId, status, detail) => {
      const prev = prevStatusRef.current.get(tabId);
      prevStatusRef.current.set(tabId, status);
      dispatch({ type: 'status', tabId, status, detail });
      maybeNotify(tabId, prev, status);
      // Claude is up and listening: hand over anything queued for it.
      const pending = pendingPromptRef.current.get(tabId);
      if (pending !== undefined) {
        pendingPromptRef.current.delete(tabId);
        ipc.writeToPty(tabId, bracketedPaste(pending));
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [maybeNotify, dispatch]);

  useEffect(() => {
    const unlisten = ipc.onTabNamed((tabId, name) => dispatch({ type: 'rename', tabId, name }));
    return () => { unlisten.then((fn) => fn()); };
  }, [dispatch]);

  /** Spawns the pty for an existing session (idempotent). Used both for freshly
   *  created sessions and to lazily wake a dormant, restored one on first view. */
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
  }, [dispatch]);

  /** Spawns a session's shell tool: a second pty in the same directory, with
   *  no session record of its own. Idempotent via the same `spawnedRef`. */
  const startShell = useCallback((tab: Tab) => {
    const id = shellPtyId(tab.id);
    if (spawnedRef.current.has(id)) return;
    const shell = shellOptions[0];
    if (!shell) return;
    spawnedRef.current.add(id);
    ipc.spawnPty({
      tabId: id,
      kind: shell.id,
      cwd: tab.cwd,
      cols: INITIAL_COLS,
      rows: INITIAL_ROWS,
      onData: (data) => writeToTerminal(id, data),
    }).catch(() => { spawnedRef.current.delete(id); });
  }, [shellOptions]);

  const sleepTab = useCallback((tabId: string) => {
    sleepingRef.current.add(tabId);
    spawnedRef.current.delete(tabId);
    idleSinceRef.current.delete(tabId);
    dispatch({ type: 'sleep', tabId });
    ipc.killPty(tabId);
  }, [dispatch]);

  /** Opens a session: adds it, selects it, leaves every overlay. `prompt`, if
   *  given, is handed to Claude once its hooks report the session is up. */
  const spawnSessionAt = useCallback(
    (
      atCwd: string,
      kind: 'claude' | 'shell',
      shellId: string | null,
      name: string,
      opts: { projectDir?: string | null; resumeSessionId?: string | null; prompt?: string } = {},
    ): Tab => {
      const tab: Tab = {
        id: crypto.randomUUID(),
        kind,
        name,
        shellId,
        cwd: atCwd,
        projectDir: opts.projectDir ?? null,
        resumeSessionId: opts.resumeSessionId ?? null,
        exited: false,
        status: 'new',
        createdAt: Date.now(),
      };
      if (opts.prompt) pendingPromptRef.current.set(tab.id, opts.prompt);
      dispatch({ type: 'add', tab });
      setView('sessions');
      setShowSettings(false);
      setShowArchive(false);
      setReaderTarget(null);
      startPty(tab);
      return tab;
    },
    [startPty, dispatch],
  );

  /** Starts a session, optionally with its shell already beside it.
   *
   *  `dir` null means a scratch session: a working directory is made for this
   *  session alone, and it lands in the Inbox because it isn't filed anywhere
   *  — which is a state, not a placeholder. ⌘N is this with both defaults, so
   *  the common case stays one keystroke with no modal and no folder picker.
   *  See docs/features/scratch-sessions.md. */
  const newSession = useCallback(async (dir: string | null, kind: NewSessionKind = 'claude') => {
    const cwd = dir ?? await ipc.createScratchDir(crypto.randomUUID().slice(0, 8)).catch(() => null);
    if (!cwd) return;

    if (kind === 'shell') {
      const shell = shellOptions[0];
      if (!shell) return;
      spawnSessionAt(cwd, 'shell', shell.id, shell.label, { projectDir: dir });
      return;
    }

    const tab = spawnSessionAt(cwd, 'claude', null, UNNAMED_SESSION, { projectDir: dir });
    // "Claude + Shell" is the layout decided up front: the second pane is put
    // there now rather than being something you go and add afterwards.
    if (kind === 'both') {
      startShell(tab);
      dispatch({ type: 'addToWorkspace', content: sessionContent(tab.id, 'shell') });
    }
  }, [spawnSessionAt, shellOptions, startShell, dispatch]);

  // Restore the previous workspace once on startup. Restored sessions are
  // added *dormant* — no pty until one is first shown.
  useEffect(() => {
    let cancelled = false;
    ipc.loadWorkspace().then((ws) => {
      if (cancelled) return;
      setSidebarOpen(!ws.collapsed);
      setProjects(ws.projects);
      setSessionNames(ws.sessionNames ?? {});
      for (const saved of ws.tabs) {
        dispatch({ type: 'add', tab: restoreTab(saved), select: false });
      }
    }).catch(() => {}).finally(() => {
      if (!cancelled) setWorkspaceLoaded(true);
    });
    return () => { cancelled = true; };
    // Runs once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setSessionNames((prev) => learnSessionNames(prev, state.tabs));
  }, [state.tabs]);

  // Persist the workspace (debounced) once the initial load has finished —
  // otherwise this would overwrite the saved state with the empty pre-load one.
  useEffect(() => {
    if (!workspaceLoaded) return;
    const timer = setTimeout(() => {
      const tabs = state.tabs.filter((t) => !t.exited && t.kind !== 'file').map(toSavedTab);
      ipc.saveWorkspace({ projects, collapsed: !sidebarOpen, tabs, sessionNames }).catch(() => {});
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [workspaceLoaded, state.tabs, projects, sidebarOpen, sessionNames]);

  // --- projects -----------------------------------------------------------

  const handleAddProject = useCallback(() => {
    ipc.pickFolder(projects[projects.length - 1] ?? homeDir).then((picked) => {
      if (picked) setProjects((prev) => (prev.includes(picked) ? prev : [...prev, picked]));
    }).catch(() => {});
  }, [projects, homeDir]);

  /** Removing a project unfiles its sessions rather than killing them. The
   *  sessions are still running and their transcripts still exist; closing the
   *  folder is a statement about the *sidebar*, not about the work. They land
   *  in the Inbox, where anything unfiled lives. */
  const handleRemoveProject = useCallback((dir: string) => {
    for (const tab of state.tabs) {
      if (tab.projectDir === dir) dispatch({ type: 'setProject', tabId: tab.id, projectDir: null });
    }
    setProjects((prev) => prev.filter((p) => p !== dir));
    ipc.uninstallHooks(dir).catch(() => {});
  }, [state.tabs, dispatch]);

  // --- session actions ----------------------------------------------------

  const handleSelect = useCallback((tabId: string) => {
    setView('sessions');
    setShowSettings(false);
    setShowArchive(false);
    setReaderTarget(null);
    dispatch({ type: 'select', tabId });
  }, [dispatch]);

  const handleClose = useCallback((tabId: string) => {
    ipc.killPty(tabId);
    ipc.killPty(shellPtyId(tabId));
    disposeTerminal(tabId);
    disposeTerminal(shellPtyId(tabId));
    spawnedRef.current.delete(tabId);
    spawnedRef.current.delete(shellPtyId(tabId));
    setMdTabs((prev) => {
      if (!prev.has(tabId)) return prev;
      const next = new Map(prev);
      next.delete(tabId);
      return next;
    });
    dispatch({ type: 'close', tabId });
  }, [dispatch]);

  /** Archiving frees the process and takes the session out of the list. It
   *  keeps its transcript, its name and its place in the workspace file, so
   *  unarchiving resumes exactly where it stopped. */
  const handleArchive = useCallback((tabId: string, archived: boolean) => {
    if (archived) {
      sleepingRef.current.add(tabId);
      spawnedRef.current.delete(tabId);
      ipc.killPty(tabId);
      ipc.killPty(shellPtyId(tabId));
    }
    dispatch({ type: 'archive', tabId, archived });
  }, [dispatch]);

  const handleOpenInVscode = useCallback((tabId: string) => {
    const tab = state.tabs.find((t) => t.id === tabId);
    if (!tab?.resumeSessionId) return;
    sleepTab(tabId);
    ipc.openInVscode(tab.cwd, tab.resumeSessionId);
  }, [state.tabs, sleepTab]);

  const handleResumeRecent = useCallback((r: RecentEntry) => {
    setReaderTarget(null);
    // A resumed session is filed where its directory says it belongs: under
    // that project if the folder is open, else the Inbox.
    spawnSessionAt(r.dir, 'claude', null, r.name, {
      projectDir: projects.includes(r.dir) ? r.dir : null,
      resumeSessionId: r.entry.sessionId,
    });
  }, [spawnSessionAt, projects]);

  const handleResumeSession = useCallback((dir: string, entry: SessionHistoryEntry) => {
    const name = sessionNames[entry.sessionId] || entry.preview.slice(0, 30) || UNNAMED_SESSION;
    handleResumeRecent({ dir, entry, name, at: 0 });
  }, [handleResumeRecent, sessionNames]);

  const handleImportSession = useCallback(async (dir: string) => {
    const sessionId = await ipc.importSession(dir).catch((e) => { window.alert(String(e)); return null; });
    if (sessionId) {
      spawnSessionAt(dir, 'claude', null, UNNAMED_SESSION, {
        projectDir: projects.includes(dir) ? dir : null,
        resumeSessionId: sessionId,
      });
    }
  }, [spawnSessionAt, projects]);

  // --- To-Do ↔ session bridge ---------------------------------------------

  /** Hands a task's own text to a session. A live session gets it now; a
   *  dormant one is woken and gets it as soon as its hooks report in. Never
   *  submitted — the text lands in the prompt and you decide. */
  const deliverPrompt = useCallback((tab: Tab, text: string) => {
    if (tab.dormant || !spawnedRef.current.has(tab.id)) {
      pendingPromptRef.current.set(tab.id, text);
      startPty(tab);
      dispatch({ type: 'wake', tabId: tab.id });
    } else {
      ipc.writeToPty(tab.id, bracketedPaste(text));
    }
  }, [startPty, dispatch]);

  /** ⋯ → Start Claude session. A task with a project starts there; one without
   *  gets a scratch session, exactly like ⌘N. The task is linked and marked in
   *  progress — never completed, which stays your call. */
  const handleStartSessionFromTask = useCallback(async (task: Task) => {
    const cwd = task.projectDir
      ?? await ipc.createScratchDir(crypto.randomUUID().slice(0, 8)).catch(() => null);
    if (!cwd) return;
    const tab = spawnSessionAt(cwd, 'claude', null, task.title.slice(0, 40) || UNNAMED_SESSION, {
      projectDir: task.projectDir,
      prompt: taskPrompt(task),
    });
    linkSession(task.id, tab.id);
    if (!task.inProgress) updateTask(task.id, { inProgress: true });
  }, [spawnSessionAt]);

  const handleAddTaskToSession = useCallback((task: Task, sessionId: string) => {
    const tab = state.tabs.find((t) => t.id === sessionId);
    if (!tab) return;
    linkSession(task.id, tab.id);
    if (!task.inProgress) updateTask(task.id, { inProgress: true });
    deliverPrompt(tab, taskPrompt(task));
    handleSelect(tab.id);
  }, [state.tabs, deliverPrompt, handleSelect]);

  /** The inverse: capture something you noticed mid-session as a task, without
   *  leaving the session's context behind — it arrives pre-filed under the
   *  session's project and linked back to it. */
  const handleCreateTaskFromSession = useCallback((tabId: string) => {
    const tab = state.tabs.find((t) => t.id === tabId);
    if (!tab) return;
    const task = addTask({ title: '', projectDir: tab.projectDir, sessionIds: [tab.id] });
    setSelectedTaskId(task.id);
    setView('todo');
  }, [state.tabs]);

  // --- visibility, waking, auto-sleep -------------------------------------

  /** Every session with a live terminal on screen — one per pane, not just the
   *  focused one. A session reading its transcript full-screen is excluded: its
   *  terminal is hidden and needs no live process behind it. */
  const visible = useMemo(() => {
    if (!onSessions) return new Set<string>();
    const ids = visibleSessionIds(state.layout);
    for (const id of ids) {
      const tab = state.tabs.find((t) => t.id === id);
      if (!tab || tab.archived) { ids.delete(id); continue; }
      if (sessionModeOf(tab, mdTabs, settings.showMarkdownToggle) === 'markdown') ids.delete(id);
    }
    return ids;
  }, [onSessions, state.layout, state.tabs, mdTabs, settings.showMarkdownToggle]);
  visibleTabIdsRef.current = visible;

  useEffect(() => {
    for (const id of visible) {
      const tab = state.tabs.find((t) => t.id === id);
      if (!tab?.dormant) continue;
      startPty(tab);
      dispatch({ type: 'wake', tabId: id });
    }
  }, [visible, state.tabs, startPty, dispatch]);

  useEffect(() => {
    const timer = setInterval(() => {
      const threshold = autoSleepMsRef.current;
      if (threshold <= 0) {
        idleSinceRef.current.clear();
        return;
      }
      const now = Date.now();
      const onScreen = visibleTabIdsRef.current;
      for (const tab of tabsRef.current) {
        const eligible =
          tab.kind === 'claude' && !tab.dormant && !tab.exited && !tab.archived &&
          tab.status === 'idle' && !!tab.resumeSessionId && !onScreen.has(tab.id);
        if (!eligible) {
          idleSinceRef.current.delete(tab.id);
          continue;
        }
        const since = idleSinceRef.current.get(tab.id);
        if (since === undefined) idleSinceRef.current.set(tab.id, now);
        else if (now - since >= threshold) sleepTab(tab.id);
      }
    }, SLEEP_CHECK_MS);
    return () => clearInterval(timer);
  }, [sleepTab]);

  // --- keyboard -----------------------------------------------------------

  // Capture phase, so these fire before the focused xterm swallows the key.
  // Every binding here was checked against the existing map (⌘F find-in-reader,
  // ⌘⇧V preview, Ctrl+V paste, Esc interrupt) — see docs/features/command-palette.md.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === 'n' && !e.shiftKey) { e.preventDefault(); void newSession(null); }
      // ⌘⇧P kept as an alias: it was the palette's key before ⌘K, and muscle
      // memory outlives a release note.
      else if (key === 'k' || (key === 'p' && e.shiftKey)) { e.preventDefault(); setPaletteOpen((v) => !v); }
      else if (key === 'b' && !e.shiftKey) { e.preventDefault(); setSidebarOpen((v) => !v); }
      else if (key === 'i' && !e.shiftKey) { e.preventDefault(); setInspectorOpen((v) => !v); }
      else if (key === 'f' && e.shiftKey) { e.preventDefault(); setFocusMode((v) => !v); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [newSession]);

  // Escape leaves focus mode. Not registered in capture: a bare Escape belongs
  // to the terminal (it interrupts Claude), so this only runs if nothing else
  // claimed it — which is the case exactly when the terminal isn't focused.
  useEffect(() => {
    if (!focusMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.xterm-helper-textarea:focus')) {
        setFocusMode(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusMode]);

  // A peek closes on losing focus — Escape or a click outside — and never on
  // the pointer leaving. Reaching a file deep in the tree walks the cursor past
  // the panel's edges, and a mouseleave rule would cancel the errand halfway.
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

  const [draggingFilesSeam, startFilesSeam] = useDragValue(
    (e) => {
      const panel = filesPanelRef.current;
      if (!panel) return null;
      return panel.getBoundingClientRect().right - e.clientX;
    },
    (width) => setFilesWidth(Math.min(480, Math.max(200, width))),
  );

  const [draggingSidebar, startSidebarSeam] = useDragValue(
    (e) => e.clientX,
    (x) => setSidebarWidth(Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, x))),
  );

  // --- the pane grid ------------------------------------------------------

  const { layout } = state;
  const focusedPaneContent = activeContent(findPane(layout, layout.focusedPaneId));
  const gridRef = useRef<HTMLDivElement>(null);
  const panes = panesOf(layout.grid).length;

  // What's being dragged right now, if anything — one window listener rather
  // than a flag threaded through every drag source. The drop zones only mount
  // while this is set, so they never sit between the pointer and a terminal.
  //
  // `dragstart` must be BUBBLE phase: React attaches its handlers at the root
  // container, so a source only calls `setData` as the event bubbles, and a
  // capture-phase listener here would read an empty `types`.
  const [drag, setDrag] = useState<PaneContent | null>(null);
  const dragging = drag !== null;
  useEffect(() => {
    const onStart = (e: DragEvent) => {
      if (!e.dataTransfer || !isPaneDrag(e.dataTransfer.types)) return;
      setDrag(readDragContent(e.dataTransfer));
    };
    const onEnd = () => setDrag(null);
    window.addEventListener('dragstart', onStart);
    window.addEventListener('dragend', onEnd, true);
    return () => {
      window.removeEventListener('dragstart', onStart);
      window.removeEventListener('dragend', onEnd, true);
    };
  }, []);

  /** A view dropped on a pane: an edge splits it off, the centre shows it in
   *  that pane instead. `splitPane` degrades to a plain show when the pane has
   *  no room, so there is nothing to check for here. */
  const handleDropView = useCallback((content: PaneContent, paneId: string, zone: Edge | 'center') => {
    setDrag(null);
    setFilesMode((m) => (m === 'peek' ? 'hidden' : m));
    const pane = findPane(state.layout, paneId);
    // Splitting a pane off the very thing it is showing would empty it and
    // collapse it right back — the same pane, a new id, and its terminal
    // remounted for nothing.
    if (zone !== 'center' && pane && splitWouldEmpty(pane, content)) return;
    dispatch(zone === 'center'
      ? { type: 'showIn', content, paneId }
      : { type: 'splitTo', content, paneId, edge: zone });
  }, [state.layout, dispatch]);

  /** "Put this on the workspace", with no question about where. The menus use
   *  this; drag is for when you care about the geometry. */
  const addToWorkspace = useCallback((content: PaneContent) => {
    setView('sessions');
    setShowSettings(false);
    setShowArchive(false);
    setFilesMode((m) => (m === 'peek' ? 'hidden' : m));
    dispatch({ type: 'addToWorkspace', content });
  }, [dispatch]);

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

  // An L-shaped grid splits only one of its rows, so the vertical seam has to
  // stop at the row that isn't split (and vice versa).
  const bands = seamBands(layout.grid);
  const colSeamShown = bands.vertical[0] || bands.vertical[1];
  const rowSeamShown = bands.horizontal[0] || bands.horizontal[1];

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null;
  const linkedTasks = useMemo(
    () => (currentTabId ? tasks.filter((t) => t.sessionIds.includes(currentTabId)) : []),
    [tasks, currentTabId],
  );
  const sessions = useMemo(() => state.tabs.filter((t) => t.kind !== 'file'), [state.tabs]);
  /** Which file the explorer should mark as open — the focused pane's, if it
   *  is showing one. */
  const activeFilePath = focusedPaneContent?.kind === 'file' ? focusedPaneContent.path : null;
  const sidebarShown = sidebarOpen && !focusMode;
  const inspectorShown = inspectorOpen && !focusMode && activeTab !== null && onSessions;

  return (
    <div className="relative flex flex-col h-screen bg-background text-foreground">
      {/* Two modes, one line, 32px — and on macOS this line *is* the title bar
          (`titleBarStyle: Overlay`), so the window costs one 32px row of chrome
          instead of two. The left pad clears the native traffic lights, which
          stay real: drawing fake ones is how a desktop app starts feeling like
          a web page wearing a costume. Projects are deliberately absent — they
          organize what's in a mode, they aren't one. */}
      {!focusMode && (
        <nav
          data-tauri-drag-region
          className={cn(
            'relative flex items-center gap-1 px-2 shrink-0 border-b border-border bg-background',
            // On macOS this row *is* the title bar. Its content sits on the
            // same line as the traffic lights, the way a native toolbar does,
            // but the row is tall enough to put real air above and below them —
            // at 38px everything was jammed against the window edge and read as
            // chrome bleeding into the frame. The left pad clears the lights.
            IS_MAC ? 'h-[54px] pl-[86px]' : 'h-[38px]',
          )}
        >
          {/* Both window-chrome controls lead the row, after the pad that clears
              the traffic lights. Left is where the things they operate are —
              the sidebar, and a palette that searches it — and it leaves the
              whole trailing half free to be what a title bar mostly is:
              somewhere to grab the window. */}
          <button
            type="button"
            aria-label="Search sessions"
            title="Go to session  ⌘K"
            className={cn(ICON_BUTTON, 'h-6 w-auto gap-1.5 px-1.5')}
            onClick={() => setPaletteOpen(true)}
          >
            <Search size={12} />
            <span className="text-[9.5px] text-faint">⌘K</span>
          </button>
          <button
            type="button"
            aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            title={`${sidebarOpen ? 'Hide' : 'Show'} sidebar  ⌘B`}
            className={cn(ICON_BUTTON, 'w-6 h-6')}
            onClick={() => setSidebarOpen((v) => !v)}
          >
            <PanelLeft size={13} />
          </button>

          {/* Centred, and centred on the window rather than on the space left
              over — otherwise it drifts as the left and right runs change. */}
          <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-0.5 p-0.5 rounded-sm bg-hover">
            <NavTab
              icon={SquareTerminal}
              label="Sessions"
              active={view === 'sessions'}
              onClick={() => { setView('sessions'); setShowSettings(false); setShowArchive(false); }}
            />
            <NavTab
              icon={CheckSquare}
              label="To-Do"
              active={view === 'todo'}
              count={tasks.filter((t) => !t.done).length}
              onClick={() => { setView('todo'); setShowSettings(false); setShowArchive(false); }}
            />
          </div>

        </nav>
      )}

      <div className="flex flex-1 min-h-0">
        {sidebarShown && (
          <>
            <div style={{ width: sidebarWidth }} className="shrink-0 min-w-0">
              <SessionsSidebar
                tabs={state.tabs}
                selectedId={onSessions ? currentTabId : null}
                projects={projects}
                recent={recent}
                lastUsed={lastUsed}
                showSettings={showSettings}
                showArchive={showArchive}
                onNewSession={(dir, kind) => { void newSession(dir, kind); }}
                onSelect={handleSelect}
                onClose={handleClose}
                onRename={(tabId, name) => dispatch({ type: 'rename', tabId, name })}
                onSetProject={(tabId, projectDir) => dispatch({ type: 'setProject', tabId, projectDir })}
                onArchive={handleArchive}
                onTogglePin={(tabId) => {
                  const tab = state.tabs.find((t) => t.id === tabId);
                  if (tab) dispatch({ type: 'pin', tabId, pinned: !tab.pinned });
                }}
                onOpenDirectory={(dir) => ipc.openDirectory(dir)}
                onOpenInVscode={handleOpenInVscode}
                onCreateTask={handleCreateTaskFromSession}
                onOpenInWorkspace={(tabId, tool) => addToWorkspace(sessionContent(tabId, tool))}
                onOpenPalette={() => setPaletteOpen(true)}
                onAddProject={handleAddProject}
                onRemoveProject={handleRemoveProject}
                onImportSession={handleImportSession}
                onResumeRecent={handleResumeRecent}
                onToggleArchive={() => { setShowArchive((v) => !v); setShowSettings(false); setView('sessions'); }}
                onToggleSettings={() => { setShowSettings((v) => !v); setShowArchive(false); setView('sessions'); }}
              />
            </div>
            <Seam
              orientation="vertical"
              dragging={draggingSidebar}
              onStart={startSidebarSeam}
              className="relative shrink-0"
            />
          </>
        )}

        <main className="relative flex flex-1 min-w-0 min-h-0" data-terminal-area>
          {/* The pane grid. Each pane shows ONE session — there is no tab strip
              above it, because the sidebar is the only list of sessions. Drag a
              session onto a pane's edge to split, or onto its middle to show it
              there. See docs/features/panes.md. */}
          <div
            ref={gridRef}
            className={cn('absolute inset-0 grid', !onSessions && 'hidden')}
            style={{
              gridTemplateColumns: `${layout.colFrac}fr ${1 - layout.colFrac}fr`,
              gridTemplateRows: `${layout.rowFrac}fr ${1 - layout.rowFrac}fr`,
            }}
          >
            {panesOf(layout.grid).map((paneId) => {
              const pane = findPane(layout, paneId);
              if (!pane) return null;
              const rect = paneRect(layout.grid, paneId);
              const focused = paneId === layout.focusedPaneId;
              const active = activeContent(pane);
              const activeSession = active?.kind === 'session'
                ? state.tabs.find((t) => t.id === active.sessionId) ?? null
                : null;
              const canRead = settings.showMarkdownToggle && activeSession?.kind === 'claude'
                && !!activeSession.resumeSessionId && active?.kind === 'session'
                && active.tool === 'claude';

              return (
                <div
                  key={paneId}
                  data-pane={paneId}
                  className={cn(
                    'relative flex flex-col min-w-0 min-h-0 overflow-hidden',
                    panes > 1 && 'border-r border-b border-border',
                  )}
                  style={{
                    gridRow: `${rect.row + 1} / span ${rect.rowSpan}`,
                    gridColumn: `${rect.col + 1} / span ${rect.colSpan}`,
                  }}
                  onMouseDownCapture={() => dispatch({ type: 'focusPane', paneId })}
                >
                  {/* Focus mode keeps the strip — it is the only thing left
                      saying which session you are in — and drops its trailing
                      controls, which is the part that was chrome. */}
                  {pane.contents.length > 0 && (
                    <PaneTabs
                      contents={pane.contents}
                      activeKey={pane.activeKey}
                      tabs={state.tabs}
                      paneFocused={focused}
                      onActivate={(key) => dispatch({ type: 'activateTab', paneId, key })}
                      onClose={(key) => dispatch({ type: 'closeTab', key })}
                      onDrop={(dropped, beforeKey) =>
                        dispatch({ type: 'showIn', content: dropped, paneId, beforeKey })}
                      trailing={focusMode ? undefined : (
                        <>
                          {canRead && activeSession && (
                            <SessionControls
                              mode={sessionModeOf(activeSession, mdTabs, settings.showMarkdownToggle)}
                              splitDirection={splitDirection}
                              onSetMode={(mode) => setMdTabs((prev) => {
                                const next = new Map(prev);
                                if (mode === 'terminal') next.delete(activeSession.id);
                                else next.set(activeSession.id, mode);
                                return next;
                              })}
                              onSetSplitDirection={setSplitDirection}
                            />
                          )}
                          {activeSession && (
                            <PaneSessionMenu
                              session={activeSession}
                              projects={projects}
                              onAddTool={(tool: SessionTool) => addToWorkspace(sessionContent(activeSession.id, tool))}
                              onSetProject={(projectDir: string | null) =>
                                dispatch({ type: 'setProject', tabId: activeSession.id, projectDir })}
                              onArchive={() => handleArchive(activeSession.id, true)}
                              onCloseSession={() => handleClose(activeSession.id)}
                              onOpenInVscode={() => handleOpenInVscode(activeSession.id)}
                              onOpenDirectory={() => ipc.openDirectory(activeSession.cwd)}
                              onCreateTask={() => handleCreateTaskFromSession(activeSession.id)}
                              inspectorOpen={inspectorShown && focused}
                              onToggleInspector={() => setInspectorOpen((v) => !v)}
                            />
                          )}
                        </>
                      )}
                    />
                  )}

                  <div className="relative flex-1 min-h-0">
                    {pane.contents.length === 0 ? (
                      <div className="absolute inset-0">
                        <HomeScreen projects={projects} onAddProject={handleAddProject} />
                      </div>
                    ) : (
                      // Every tab stays mounted and the inactive ones hide:
                      // unmounting one would drop its xterm buffer and re-wrap
                      // the whole scrollback on the way back.
                      pane.contents.map((content) => {
                        const key = contentKey(content)!;
                        const shown = key === contentKey(active);
                        return (
                          <div
                            key={key}
                            className={cn('absolute inset-0 flex', !shown && 'invisible pointer-events-none')}
                          >
                            {content.kind === 'file' ? (
                              <PaneFile
                                content={content}
                                active={onSessions && shown}
                                onOpenFile={(dir, path) =>
                                  dispatch({ type: 'showIn', content: { kind: 'file', dir, path }, paneId })}
                              />
                            ) : (
                              (() => {
                                const session = state.tabs.find((t) => t.id === content.sessionId);
                                if (!session) return null;
                                return (
                                  <SessionWorkspace
                                    session={session}
                                    tool={content.tool}
                                    active={onSessions && shown}
                                    paneFocused={focused}
                                    mode={sessionModeOf(session, mdTabs, settings.showMarkdownToggle)}
                                    splitDirection={splitDirection}
                                    mdView={mdView}
                                    onSetMdView={setMdView}
                                    showMarkdownToggle={settings.showMarkdownToggle}
                                    onInterrupt={() => dispatch({ type: 'interrupt', tabId: session.id })}
                                    onNeedShell={() => startShell(session)}
                                  />
                                );
                              })()
                            )}
                          </div>
                        );
                      })
                    )}
                    {dragging && (
                      <PaneDropZones
                        canSplit={{
                          vertical: rect.colSpan > 1 && !splitWouldEmpty(pane, drag),
                          horizontal: rect.rowSpan > 1 && !splitWouldEmpty(pane, drag),
                        }}
                        onDropContent={(dropped, zone) => handleDropView(dropped, paneId, zone)}
                      />
                    )}
                  </div>
                </div>
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

          {view === 'todo' && !overlaysUp && (
            <div className="absolute inset-0 flex bg-background">
              <TodoView
                projects={projects}
                sessions={sessions}
                selectedTaskId={selectedTaskId}
                onSelectTask={setSelectedTaskId}
                onStartSession={(task) => { void handleStartSessionFromTask(task); }}
                onAddToSession={handleAddTaskToSession}
              />
              {selectedTask && (
                <TaskInspector
                  task={selectedTask}
                  projects={projects}
                  sessions={sessions}
                  onClose={() => setSelectedTaskId(null)}
                  onOpenSession={handleSelect}
                  onStartSession={() => { void handleStartSessionFromTask(selectedTask); }}
                />
              )}
            </div>
          )}

          {showArchive && (
            <div className="absolute inset-0 bg-background">
              <SessionHistoryPanel
                projects={historyDirs}
                sessionNames={sessionNames}
                onResume={handleResumeSession}
                onRead={(dir, entry) => setReaderTarget({ projectDir: dir, entry })}
              />
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
        </main>

        {inspectorShown && activeTab && (
          <SessionInspector
            session={activeTab}
            projects={projects}
            lastUsedAt={activeTab.resumeSessionId ? lastUsed.get(activeTab.resumeSessionId) : undefined}
            linkedTasks={linkedTasks}
            onClose={() => setInspectorOpen(false)}
            onRename={(name) => dispatch({ type: 'rename', tabId: activeTab.id, name })}
            onSetProject={(projectDir) => dispatch({ type: 'setProject', tabId: activeTab.id, projectDir })}
            onArchive={() => handleArchive(activeTab.id, true)}
            onCloseSession={() => handleClose(activeTab.id)}
            onOpenInVscode={() => handleOpenInVscode(activeTab.id)}
            onOpenDirectory={() => ipc.openDirectory(activeTab.cwd)}
            onCreateTask={() => handleCreateTaskFromSession(activeTab.id)}
            onOpenTask={(taskId) => { setSelectedTaskId(taskId); setView('todo'); }}
          />
        )}
        {/* The file explorer, back on the right edge where it was. Docked it
            takes a column; peeked it lays over the grid, which is the mode
            that matters — you come here to grab one file and drag it into a
            pane, and the terminal must not rewrap for that. */}
        {!filesPinned && onSessions && <FilesEdge onPeek={() => setFilesMode('peek')} />}
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
              style={{ width: filesWidth }}
              className="shrink-0 border-l border-border overflow-hidden"
            >
              <FileExplorerPanel
                projects={projects}
                activePath={activeFilePath}
                onOpenFile={(dir, path) => addToWorkspace({ kind: 'file', dir, path })}
                pinned
                onTogglePin={() => setFilesMode('peek')}
              />
            </div>
          </>
        )}
      </div>

      {filesMode === 'peek' && (
        <div
          data-files-panel
          style={{ width: filesWidth }}
          className="absolute right-0 top-0 bottom-0 z-40 border-l border-border bg-card overflow-hidden shadow-[-18px_0_34px_-18px_rgba(0,0,0,0.9)]"
        >
          <FileExplorerPanel
            projects={projects}
            activePath={activeFilePath}
            onOpenFile={(dir, path) => addToWorkspace({ kind: 'file', dir, path })}
            pinned={false}
            onTogglePin={() => setFilesMode('pinned')}
          />
        </div>
      )}
      {draggingFilesSeam && <div className="fixed inset-0 z-50 cursor-col-resize" />}
      {draggingSidebar && <div className="fixed inset-0 z-50 cursor-col-resize" />}
      <CommandPalette
        open={paletteOpen}
        tabs={sessions}
        onClose={() => setPaletteOpen(false)}
        onSelectTab={handleSelect}
      />
    </div>
  );
}

function NavTab({ icon: Icon, label, active, count, onClick }: {
  icon: typeof SquareTerminal;
  label: string;
  active: boolean;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        'relative flex items-center gap-1.5 h-[26px] px-3 rounded-sm border-none cursor-pointer font-inherit text-[12px] font-medium',
        // The accent underline is the only thing in the chrome that says "you
        // are here". A background tint alone read as one more hover state.
        active
          ? 'bg-selected text-foreground after:absolute after:inset-x-1.5 after:-bottom-px after:h-px after:bg-primary'
          : 'bg-transparent text-muted-foreground hover:text-foreground hover:bg-raised',
      )}
      onClick={onClick}
    >
      <Icon size={12} className="shrink-0" />
      {label}
      {count !== undefined && count > 0 && (
        <span className="text-[9.5px] font-mono tabular-nums text-muted-foreground">{count}</span>
      )}
    </button>
  );
}
