use portable_pty::CommandBuilder;
use serde::Serialize;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter, State};

use crate::claude::{claude_command, login_shell_path, resume_flags};
use crate::pty::PtyManager;
use crate::session_history::{projects_root, SessionHistoryEntry};
use crate::shell::{all_shell_options, shell_option, Platform, ShellOption};
use crate::workspace::{self, WorkspaceState};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PtyExitPayload {
    tab_id: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ClaudeSessionResolvedPayload {
    tab_id: String,
    session_id: String,
}

/// How long to keep polling for a freshly spawned Claude tab's session file
/// before giving up (it just won't be resumable next launch).
const SESSION_ID_POLL_ATTEMPTS: u32 = 30;
const SESSION_ID_POLL_INTERVAL: std::time::Duration = std::time::Duration::from_secs(1);

#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    ptys: State<'_, PtyManager>,
    tab_id: String,
    kind: String,
    cwd: String,
    resume_session_id: Option<String>,
    cols: u16,
    rows: u16,
    on_data: Channel<InvokeResponseBody>,
) -> Result<(), String> {
    let platform = Platform::current();
    let (program, args) = if kind == "claude" {
        let flags = resume_session_id
            .as_deref()
            .map(resume_flags)
            .unwrap_or_default();
        claude_command(platform, &flags)
    } else {
        let option =
            shell_option(platform, &kind).ok_or_else(|| format!("Unknown shell: {kind}"))?;
        (option.command.to_string(), Vec::new())
    };

    // A fresh (non-resumed) Claude tab doesn't have a session id yet — snapshot
    // existing transcripts now so we can spot the new one once the CLI writes it.
    let learn_session = kind == "claude" && resume_session_id.is_none();
    let session_watch = learn_session
        .then(projects_root)
        .flatten()
        .map(|root| (root.clone(), crate::session_history::existing_session_ids(&root, &cwd)));

    let mut cmd = CommandBuilder::new(program);
    cmd.args(args);
    cmd.cwd(cwd.clone());
    cmd.env("TERM", "xterm-256color");
    if let Some(path) = login_shell_path() {
        cmd.env("PATH", path);
    }

    let exit_tab_id = tab_id.clone();
    let app_for_watch = app.clone();
    ptys.spawn(
        tab_id.clone(),
        cmd,
        cols,
        rows,
        move |bytes| {
            let _ = on_data.send(InvokeResponseBody::Raw(bytes));
        },
        move || {
            let _ = app.emit("pty-exit", PtyExitPayload { tab_id: exit_tab_id });
        },
    )?;

    if let Some((root, existing)) = session_watch {
        spawn_session_id_watcher(app_for_watch, root, cwd, tab_id, existing);
    }
    Ok(())
}

/// Polls for the transcript file a freshly spawned Claude tab was assigned,
/// then emits `claude-session-resolved` so the frontend can persist it for
/// `--resume` on the next launch. Gives up silently after a while — the tab
/// just won't be resumable.
fn spawn_session_id_watcher(
    app: AppHandle,
    root: std::path::PathBuf,
    cwd: String,
    tab_id: String,
    existing: std::collections::HashSet<String>,
) {
    let spawned_at = std::time::SystemTime::now();
    std::thread::spawn(move || {
        for _ in 0..SESSION_ID_POLL_ATTEMPTS {
            std::thread::sleep(SESSION_ID_POLL_INTERVAL);
            if let Some(session_id) =
                crate::session_history::find_new_session(&root, &cwd, &existing, spawned_at)
            {
                let _ = app.emit(
                    "claude-session-resolved",
                    ClaudeSessionResolvedPayload { tab_id, session_id },
                );
                return;
            }
        }
    });
}

#[tauri::command]
pub fn pty_write(ptys: State<'_, PtyManager>, tab_id: String, data: String) -> Result<(), String> {
    ptys.write(&tab_id, &data)
}

#[tauri::command]
pub fn pty_resize(
    ptys: State<'_, PtyManager>,
    tab_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    ptys.resize(&tab_id, cols, rows)
}

#[tauri::command]
pub fn pty_kill(ptys: State<'_, PtyManager>, tab_id: String) {
    ptys.kill(&tab_id);
}

#[tauri::command]
pub fn list_shells() -> Vec<ShellOption> {
    all_shell_options(Platform::current())
}

#[tauri::command(async)]
pub fn list_sessions(project_dir: String) -> Result<Vec<SessionHistoryEntry>, String> {
    let root = projects_root().ok_or("could not resolve home directory")?;
    Ok(crate::session_history::list_sessions(&root, &project_dir))
}

#[tauri::command(async)]
pub fn delete_session(project_dir: String, session_id: String) -> Result<(), String> {
    let root = projects_root().ok_or("could not resolve home directory")?;
    crate::session_history::delete_session(&root, &project_dir, &session_id)
}

#[tauri::command(async)]
pub fn get_usage_stats() -> Result<crate::usage::UsageStats, String> {
    let root = projects_root().ok_or("could not resolve home directory")?;
    Ok(crate::usage::usage_stats(&root))
}

#[tauri::command]
pub fn home_dir() -> Result<String, String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .ok_or_else(|| "could not resolve home directory".to_string())
}

#[tauri::command(async)]
pub fn load_workspace() -> WorkspaceState {
    let Some(root) = workspace::config_dir() else {
        return WorkspaceState::default();
    };
    workspace::load_workspace(&root)
}

#[tauri::command(async)]
pub fn save_workspace(state: WorkspaceState) -> Result<(), String> {
    let root = workspace::config_dir().ok_or("could not resolve config directory")?;
    workspace::save_workspace(&root, &state)
}
