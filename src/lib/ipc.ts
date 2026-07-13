/**
 * The single seam between the frontend and the Tauri backend. Every
 * `invoke`/event/channel call lives here so components stay testable
 * (vitest mocks this one module) and payload encoding can change in
 * one place.
 */
import { invoke, Channel } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import type { AppSettings, SessionHistoryEntry, ShellOption, TabStatus, UsageStats, WorkspaceState } from '@/types';

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

export function getUsageStats(): Promise<UsageStats> {
  return invoke('get_usage_stats');
}

export function openExternal(url: string): void {
  void openUrl(url);
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

/** Removes just this app's hook entries from a project's
 *  `.claude/settings.local.json` (leaves any user-authored hooks alone). */
export function uninstallHooks(cwd: string): Promise<void> {
  return invoke('uninstall_hooks', { cwd });
}
