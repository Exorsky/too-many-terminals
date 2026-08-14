/**
 * The single seam between the frontend and the Tauri backend. Every
 * `invoke`/event/channel call lives here so components stay testable
 * (vitest mocks this one module) and payload encoding can change in
 * one place.
 */
import { invoke, Channel } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { openUrl, openPath } from '@tauri-apps/plugin-opener';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import type { AppSettings, SessionHistoryEntry, SessionStat, SessionUsageStats, ShellOption, TabStatus, TranscriptTurn, WorkspaceState } from '@/types';

export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export interface SpawnPtyOptions {
  tabId: string;
  /** "claude" or a shell id from listShells(). */
  kind: string;
  cwd: string;
  resumeSessionId?: string | null;
  cols: number;
  rows: number;
  onData: (data: Uint8Array) => void;
}

export async function spawnPty(opts: SpawnPtyOptions): Promise<void> {
  const channel = new Channel<ArrayBuffer>();
  channel.onmessage = (buf) => opts.onData(new Uint8Array(buf));
  await invoke('pty_spawn', {
    tabId: opts.tabId,
    kind: opts.kind,
    cwd: opts.cwd,
    resumeSessionId: opts.resumeSessionId ?? null,
    cols: opts.cols,
    rows: opts.rows,
    onData: channel,
  });
}

export function writeToPty(tabId: string, data: string): void {
  void invoke('pty_write', { tabId, data });
}

export function resizePty(tabId: string, cols: number, rows: number): void {
  void invoke('pty_resize', { tabId, cols, rows });
}

export function killPty(tabId: string): void {
  void invoke('pty_kill', { tabId });
}

export function onPtyExit(callback: (tabId: string) => void): Promise<UnlistenFn> {
  return listen<{ tabId: string }>('pty-exit', (event) => callback(event.payload.tabId));
}

/** Fired once a freshly spawned (non-resumed) Claude tab's session id is
 *  learned from its transcript file, so it can be persisted for `--resume`. */
export function onClaudeSessionResolved(
  callback: (tabId: string, sessionId: string) => void,
): Promise<UnlistenFn> {
  return listen<{ tabId: string; sessionId: string }>('claude-session-resolved', (event) =>
    callback(event.payload.tabId, event.payload.sessionId));
}

/** Fired when Claude Code's own hooks (PreToolUse/Stop/Notification/
 *  SessionStart) report a Claude tab's live state. */
export function onTabStatus(
  callback: (tabId: string, status: TabStatus, detail?: string) => void,
): Promise<UnlistenFn> {
  return listen<{ tabId: string; status: TabStatus; detail?: string }>('claude-tab-status', (event) =>
    callback(event.payload.tabId, event.payload.status, event.payload.detail));
}

/** Fired once a background `claude -p` call has generated a short title for
 *  a Claude tab from its first prompt. */
export function onTabNamed(
  callback: (tabId: string, name: string) => void,
): Promise<UnlistenFn> {
  return listen<{ tabId: string; name: string }>('claude-tab-named', (event) =>
    callback(event.payload.tabId, event.payload.name));
}

export function listShells(): Promise<ShellOption[]> {
  return invoke('list_shells');
}

export function homeDir(): Promise<string> {
  return invoke('home_dir');
}

/** Native folder picker. Resolves null if the user cancels. */
export async function pickFolder(defaultPath?: string | null): Promise<string | null> {
  const result = await openDialog({ directory: true, multiple: false, defaultPath: defaultPath ?? undefined });
  return typeof result === 'string' ? result : null;
}

export function listSessions(projectDir: string): Promise<SessionHistoryEntry[]> {
  return invoke('list_sessions', { projectDir });
}

export function deleteSession(projectDir: string, sessionId: string): Promise<void> {
  return invoke('delete_session', { projectDir, sessionId });
}

/** Full transcript of a past session, parsed into ordered turns for reading. */
export function readTranscript(projectDir: string, sessionId: string): Promise<TranscriptTurn[]> {
  return invoke('read_transcript', { projectDir, sessionId });
}

/** Exports a session's transcript to a file the user picks, to hand off to
 *  another machine. Resolves false if they cancel the save dialog. See
 *  docs/features/session-transfer.md. */
export async function exportSession(projectDir: string, sessionId: string): Promise<boolean> {
  const dest = await saveDialog({
    defaultPath: `${sessionId}.jsonl`,
    filters: [{ name: 'Session transcript', extensions: ['jsonl'] }],
  });
  if (!dest) return false;
  await invoke('export_session', { projectDir, sessionId, dest });
  return true;
}

/** Imports a transcript file received from another machine into `projectDir`,
 *  returning the session id to resume — or null if the user cancels the picker. */
export async function importSession(projectDir: string): Promise<string | null> {
  const src = await openDialog({
    multiple: false,
    filters: [{ name: 'Session transcript', extensions: ['jsonl'] }],
  });
  if (typeof src !== 'string') return null;
  return invoke('import_session', { projectDir, src });
}

/** Per-session aggregates for the Home dashboard (turns, tokens, commands,
 *  model), scanned from this project's transcripts — see
 *  docs/features/home-screen.md. */
export function getSessionStats(projectDir: string): Promise<SessionStat[]> {
  return invoke('get_session_stats', { projectDir });
}

/** The official 5-hour session and 7-day week rate-limit windows, read from
 *  the usage data Claude Code caches in ~/.claude.json — see
 *  docs/features/usage-meter.md. */
export function getSessionUsageStats(): Promise<SessionUsageStats> {
  return invoke('get_session_usage_stats');
}

export function openExternal(url: string): void {
  void openUrl(url);
}

/** Opens a directory in the OS file manager (Explorer/Finder/file manager). */
export function openDirectory(dir: string): void {
  void openPath(dir);
}

/** Hands a live session off to the VS Code Claude Code extension: opens/
 *  focuses VS Code on `cwd`, then resumes `sessionId` there via the
 *  extension's own deep link. Both tools share the same transcript file, so
 *  there's nothing to transfer — see docs/features/vscode-handoff.md. */
export function openInVscode(cwd: string, sessionId: string): Promise<void> {
  return invoke('open_in_vscode', { cwd, sessionId });
}

/** Ensures the OS notification permission is granted, asking once if needed.
 *  Cached after the first resolution. Resolves false if denied or unavailable. */
let notificationPermission: boolean | null = null;
export async function ensureNotificationPermission(): Promise<boolean> {
  if (notificationPermission !== null) return notificationPermission;
  try {
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === 'granted';
    notificationPermission = granted;
  } catch {
    notificationPermission = false;
  }
  return notificationPermission;
}

/** Fires a desktop notification. No-ops (swallows) if permission isn't granted
 *  or the platform can't deliver it. */
export async function notify(title: string, body: string): Promise<void> {
  if (!(await ensureNotificationPermission())) return;
  try {
    sendNotification({ title, body });
  } catch {
    /* delivery is best-effort */
  }
}

/** Deep link to the OS notification settings pane, or null where there is
 *  no stable one (Linux desktops vary). */
function systemNotificationSettingsUrl(): string | null {
  const ua = navigator.userAgent;
  if (ua.includes('Mac')) return 'x-apple.systempreferences:com.apple.preference.notifications';
  if (ua.includes('Windows')) return 'ms-settings:notifications';
  return null;
}

export function canOpenSystemNotificationSettings(): boolean {
  return systemNotificationSettingsUrl() !== null;
}

/** Opens the OS notification settings for the user to allow the app. The
 *  plugin can't detect a system-side block (it reports "granted" on desktop
 *  even when the OS drops the toast), so this is the recovery path. */
export function openSystemNotificationSettings(): void {
  const url = systemNotificationSettingsUrl();
  if (url) void openUrl(url);
}

export function loadWorkspace(): Promise<WorkspaceState> {
  return invoke('load_workspace');
}

export function saveWorkspace(state: WorkspaceState): Promise<void> {
  return invoke('save_workspace', { state });
}

export function loadSettings(): Promise<AppSettings> {
  return invoke('load_settings');
}

export function saveSettings(settings: AppSettings): Promise<void> {
  return invoke('save_settings', { settings });
}

/** One level of a directory (folders first, then files, alphabetical). */
export function listDir(dir: string): Promise<DirEntry[]> {
  return invoke('list_dir', { dir });
}

/** Reads a file as text for the file viewer. Rejects binary or oversized files. */
export function readFile(path: string): Promise<string> {
  return invoke('read_file', { path });
}

/** Overwrites a file. `root` must be the project folder it was opened from —
 *  the backend refuses to write outside it. */
export function writeFile(path: string, root: string, contents: string): Promise<void> {
  return invoke('write_file', { path, root, contents });
}

/** Which file a variable wins from. `dotenv` is applied by this app and reaches
 *  every tab; the rest are applied by Claude Code and reach Claude tabs only. */
export type EnvSource = 'dotenv' | 'global' | 'project' | 'local';

export interface EnvVar {
  name: string;
  source: EnvSource;
}

export interface EnvReport {
  /** Every variable a session opened here will hold, alphabetical. */
  vars: EnvVar[];
  /** Names the `.env` set that the app reserves for itself (PATH, TERM, …). */
  refused: string[];
  /** The folder has a `.env` that couldn't be read. */
  unreadable: boolean;
  /** This folder contributes credentials of its own — i.e. from something
   *  other than the global settings file, which applies to every folder. */
  folderScoped: boolean;
}

/** Every credential a session opened in `dir` will hold, and where each comes
 *  from. Values never cross this boundary; see docs/features/env-loading.md. */
export function envNames(dir: string): Promise<EnvReport> {
  return invoke('env_names', { dir });
}

/** Removes just this app's hook entries from a project's
 *  `.claude/settings.local.json` (leaves any user-authored hooks alone). */
export function uninstallHooks(cwd: string): Promise<void> {
  return invoke('uninstall_hooks', { cwd });
}
