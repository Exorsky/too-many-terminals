/**
 * The single seam between the frontend and the Tauri backend. Every
 * `invoke`/event/channel call lives here so components stay testable
 * (vitest mocks this one module) and payload encoding can change in
 * one place.
 */
import { invoke, Channel } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { openUrl, openPath } from '@tauri-apps/plugin-opener';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import type { AppSettings, SessionHistoryEntry, SessionUsageStats, ShellOption, TabStatus, TranscriptTurn, WorkspaceState } from '@/types';

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
  callback: (tabId: string, status: TabStatus) => void,
): Promise<UnlistenFn> {
  return listen<{ tabId: string; status: TabStatus }>('claude-tab-status', (event) =>
    callback(event.payload.tabId, event.payload.status));
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

/** An estimate of the current 5-hour session and 7-day week rate-limit
 *  windows, reconstructed from local transcript timestamps — see
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

/** Removes just this app's hook entries from a project's
 *  `.claude/settings.local.json` (leaves any user-authored hooks alone). */
export function uninstallHooks(cwd: string): Promise<void> {
  return invoke('uninstall_hooks', { cwd });
}
