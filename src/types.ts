export type TabKind = 'claude' | 'shell' | 'file';

/** The two product modes. Projects are deliberately not one of them — a
 *  project organizes sessions and tasks, it isn't a place you navigate to.
 *  See docs/architecture.md. */
export type AppView = 'sessions' | 'todo';

/** The tools that belong to the session you're in. Not sessions-as-tabs: one
 *  session owns a Claude process, a shell in the same directory, and a view of
 *  its files. See docs/features/session-workspace.md. */
export type SessionTool = 'claude' | 'shell' | 'files';

/** How a tab is being shown: the terminal alone, its transcript alone, or both
 *  side by side. Lives here rather than on SessionControls because App and
 *  PaneView both have to agree on it — see `sessionModeOf` in lib/tabs.ts. */
export type SessionMode = 'terminal' | 'markdown' | 'split';

/** Live state of a Claude tab, learned from Claude Code's own hooks
 *  (SessionStart/PreToolUse/Stop/Notification). Meaningless for shell tabs,
 *  which never emit hook events. */
export type TabStatus = 'new' | 'working' | 'idle' | 'requires_response';

export interface Tab {
  id: string;
  kind: TabKind;
  name: string;
  /** Shell id from ShellOption (e.g. "powershell", "cmd") — null for claude tabs. */
  shellId: string | null;
  /** Where the process actually runs. A project session runs in the project
   *  folder; a scratch session runs in its own directory under `~/.tmt/scratch`. */
  cwd: string;
  /** Which project this session is filed under — `null` is the Inbox.
   *
   *  Deliberately separate from `cwd`: filing a scratch session under a project
   *  must not move a live working directory, because Claude Code keys a
   *  transcript by that path and moving it would orphan the conversation.
   *  See docs/features/scratch-sessions.md. */
  projectDir: string | null;
  /** Out of the main list but not gone: still in the workspace, resumable from
   *  the sidebar's Archived group. Its pty is killed when it's archived. */
  archived?: boolean;
  /** Claude session id when resuming a past session. */
  resumeSessionId: string | null;
  /** True once the underlying pty process has exited. */
  exited: boolean;
  status: TabStatus;
  /** True for a restored-workspace tab whose pty hasn't been spawned yet — it
   *  stays a lightweight placeholder (no shell/claude process) until first
   *  shown as a live terminal. Absent/false for normally-spawned tabs. */
  dormant?: boolean;
  /** Absolute file path — set only for kind === 'file'. */
  path?: string;
  /** True when a file tab has unsaved editor changes. */
  dirty?: boolean;
  /** User-pinned to the sidebar's Pinned section, independent of folder or status. */
  pinned?: boolean;
  /** Epoch ms of the last status transition — powers the elapsed-time label
   *  on working/requires_response rows. */
  statusChangedAt?: number;
  /** Epoch ms this tab was opened, for sessions started in this run. Absent on
   *  a restored tab on purpose: restoring them all at launch would stamp them
   *  with the same instant and bury the real order, so those fall back to their
   *  transcript's mtime instead. See `recencyOf` in Sidebar.tsx. */
  createdAt?: number;
  /** A short "what Claude is doing right now" label from the PreToolUse
   *  hook payload (e.g. "editing Sidebar.tsx") — only ever set alongside
   *  `working`; cleared on any other status. */
  statusDetail?: string;
  /** True right after a working → idle transition, until the tab is selected
   *  (seen) or starts working again — powers the "Just finished" strip. */
  justFinished?: boolean;
}

/** A shell available on the current OS, provided by the Rust backend. */
export interface ShellOption {
  id: string;
  label: string;
  command: string;
}

export const PROJECT_COLORS = [
  { name: 'blue',   hue: 210 },
  { name: 'green',  hue: 140 },
  { name: 'orange', hue: 30  },
  { name: 'purple', hue: 270 },
  { name: 'teal',   hue: 180 },
  { name: 'red',    hue: 0   },
  { name: 'pink',   hue: 330 },
  { name: 'yellow', hue: 55  },
] as const;

/** Sequential per-project accent color, in the order folders were added. */
export function projectHue(index: number): number {
  return PROJECT_COLORS[index % PROJECT_COLORS.length].hue;
}

// --- Session usage (the official 5-hour / 7-day rate-limit windows, fetched
// live from the same endpoint Claude Code's own /usage uses) ---

export interface UsageWindow {
  /** Percent of the window consumed, 0-100. */
  percent: number;
  /** ISO time the window resets. */
  resetsAtIso: string;
}

export interface SessionUsageStats {
  /** False when neither the API nor the cache had anything to report. */
  available: boolean;
  /** The 5-hour session window. */
  session: UsageWindow | null;
  /** The 7-day weekly window. */
  week: UsageWindow | null;
  /** Unix ms these numbers were fetched. */
  fetchedAtMs: number | null;
  /** True when the live fetch failed and this fell back to Claude Code's
   *  cache — which can be badly stale, so the UI says so. */
  fromCache: boolean;
}

// --- Session history (past Claude Code sessions for the current project) ---

export interface SessionHistoryEntry {
  sessionId: string;
  /** Short preview of the first real user message, for identification. */
  preview: string;
  /** ISO timestamp of the session file's last write. */
  lastUsedIso: string;
}

/** One past session whose transcript contains the search query.
 *
 *  Carries its own `projectDir` because a hit can come from a project that
 *  isn't open — search covers every transcript on disk, not just the folders
 *  currently in the sidebar. */
export interface TranscriptHit {
  sessionId: string;
  /** The directory Claude was started in, recovered from the transcript. */
  projectDir: string;
  /** Text around the match, already whitespace-collapsed and clipped. */
  snippet: string;
  /** Which side of the conversation matched: 'user' or 'assistant'. */
  role: string;
  /** Matches in this session, capped — a bigger number only means "lots". */
  matchCount: number;
  lastUsedIso: string;
}

// --- Session stats (per-session aggregates for the Home dashboard, scanned
// from the same transcripts session history reads) ---

export interface SessionStat {
  sessionId: string;
  /** File mtime — buckets the session onto a day. */
  lastUsedIso: string;
  /** First / last message timestamp — session duration + time-of-day. */
  startedIso: string | null;
  endedIso: string | null;
  /** Prompts you actually typed (real, non-synthetic user messages). */
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** Model that produced the most output this session, if any. */
  model: string | null;
  /** First real prompt, for the hover caption. */
  preview: string;
  /** First token of every shell call, counted: `[["git", 12], ...]`. */
  commands: [string, number][];
}

// --- Transcript reading (a past session rendered as a document) ---

/** A renderable piece of a turn. `text` carries Markdown; `tool` is a
 *  collapsed tool call (name + one-line argument). */
export type TranscriptBlock =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; name: string; detail: string };

export interface TranscriptTurn {
  role: 'user' | 'assistant';
  timestamp: string | null;
  blocks: TranscriptBlock[];
}

// --- Workspace persistence (restores open tabs across app launches) ---

export interface SavedTab {
  /** Stable across restarts, so a To-Do that links a session still points at
   *  it next launch. Absent in files written before it existed. */
  id?: string;
  kind: TabKind;
  name: string;
  shellId: string | null;
  resumeSessionId: string | null;
  /** The session's working directory. */
  cwd: string;
  /** Which project it's filed under; `null`/absent is the Inbox. Absent means
   *  the file predates the field, and `restoreTab` derives one from `cwd`. */
  projectDir?: string | null;
  archived?: boolean;
  /** User-pinned to the top of its group. */
  pinned?: boolean;
}

export interface WorkspaceState {
  /** Open project folders, in the order they were added. */
  projects: string[];
  collapsed: boolean;
  tabs: SavedTab[];
  /** Session id → the name that session was last known by. Kept apart from
   *  `tabs` so closing a tab doesn't erase it — History, the sidebar, and a
   *  resumed tab all read the same name. Absent in files saved before it
   *  existed, hence optional. */
  sessionNames?: Record<string, string>;
}

// --- To-Dos (docs/features/todo.md) ---

export type TaskPriority = 'low' | 'medium' | 'high';

/** A thing you want to do. Deliberately not a work item: no assignee, no
 *  status workflow, no estimate. `sessionIds` is the only Claude-shaped field
 *  and it's optional — a task never has to become a session. */
export interface Task {
  id: string;
  title: string;
  description: string;
  done: boolean;
  /** Epoch ms, or null for "no date" (the Later group). */
  dueAt: number | null;
  /** Which project it belongs to; null is "No project". */
  projectDir: string | null;
  tags: string[];
  priority: TaskPriority;
  /** Set when a session is started from this task, cleared by hand. Completion
   *  stays an explicit decision — nothing Claude does ever sets `done`. */
  inProgress: boolean;
  createdAt: number;
  updatedAt: number;
  /** Ids of sessions started from, or linked to, this task. */
  sessionIds: string[];
}

// --- App settings (theme selection + custom themes) ---

export interface AppSettings {
  /** Id of the active theme — a built-in preset or a custom theme. */
  selectedThemeId: string;
  /** Custom themes as raw JSON; validated by sanitizeCustomThemes on load. */
  customThemes: unknown[];
  /** Show the Markdown Preview / Split controls docked to the tab strip. */
  showMarkdownToggle: boolean;
  /** Fire a desktop notification when an unfocused session needs input or finishes. */
  notificationsEnabled: boolean;
  /** Minutes an idle, off-screen Claude session may stay running before it's
   *  auto-slept (its process killed, respawned via --resume on next view).
   *  0 disables auto-sleep entirely. */
  autoSleepMinutes: number;
  /** How often the sidebar re-reads token usage from disk, in seconds. */
  usageRefreshSeconds: number;
  /** Hide the session list's secondary line (project, activity, elapsed),
   *  leaving one name per row. For someone who knows their sessions by name. */
  compactList: boolean;
}
