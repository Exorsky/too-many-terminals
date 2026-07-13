export type TabKind = 'claude' | 'shell';

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
  cwd: string;
  /** Claude session id when resuming a past session. */
  resumeSessionId: string | null;
  /** True once the underlying pty process has exited. */
  exited: boolean;
  status: TabStatus;
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

// --- Local usage stats (scanned from ~/.claude/projects/**/*.jsonl) ---

export interface UsageStats {
  /** False if there's nothing to report (e.g. brand-new install, no activity today). */
  available: boolean;
  /** ISO date (YYYY-MM-DD) the stats are for — always "today" in UTC. */
  date: string;
  /** "Fresh" tokens: input + output + cache-write. Excludes cache reads, which
   *  are near-free re-reads of context already primed and would otherwise
   *  dwarf this number in any session with a long conversation history. */
  totalTokens: number;
  byModel: Record<string, number>;
  /** Cache-read tokens, tracked separately since they're billed at a small
   *  fraction of the input rate and aren't "new" consumption. */
  cacheReadTokens: number;
}

// --- Session history (past Claude Code sessions for the current project) ---

export interface SessionHistoryEntry {
  sessionId: string;
  /** Short preview of the first real user message, for identification. */
  preview: string;
  /** ISO timestamp of the session file's last write. */
  lastUsedIso: string;
}

// --- Workspace persistence (restores open tabs across app launches) ---

export interface SavedTab {
  kind: TabKind;
  name: string;
  shellId: string | null;
  resumeSessionId: string | null;
  /** Which open project this tab belongs to. */
  cwd: string;
}

export interface WorkspaceState {
  /** Open project folders, in the order they were added. */
  projects: string[];
  collapsed: boolean;
  tabs: SavedTab[];
}

// --- App settings (theme selection + custom themes) ---

export interface AppSettings {
  /** Id of the active theme — a built-in preset or a custom theme. */
  selectedThemeId: string;
  /** Custom themes as raw JSON; validated by sanitizeCustomThemes on load. */
  customThemes: unknown[];
}
