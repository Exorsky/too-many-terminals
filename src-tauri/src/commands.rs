use portable_pty::CommandBuilder;
use serde::Serialize;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter, State};

use crate::claude::{claude_command, login_shell_path, resume_flags};
use crate::dotenv;
use crate::env_sources;
use crate::files;
use crate::hooks;
use crate::pty::PtyManager;
use crate::session_history::{projects_root, SessionHistoryEntry};
use crate::settings::{self, AppSettings};
use crate::shell::{all_shell_options, shell_option, Platform, ShellOption};
use crate::workspace::{self, WorkspaceState};
use crate::HookEnv;

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
    hook_env: State<'_, HookEnv>,
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

    // The folder's own `.env`, so a session starts already holding the
    // project's credentials — see docs/features/env-loading.md. Applied
    // *before* our own variables below on purpose: that ordering, plus the
    // reserved-name filter in `dotenv`, means nothing in a `.env` can shadow
    // PATH/TERM or hijack the hook pipe.
    let dotenv = dotenv::load(std::path::Path::new(&cwd));
    if let Some(loaded) = &dotenv {
        for (key, value) in &loaded.pairs {
            cmd.env(key, value);
        }
    }

    cmd.env("TERM", "xterm-256color");
    if let Some(path) = login_shell_path() {
        cmd.env("PATH", path);
    }

    // Wire up Claude Code's own hooks (status updates, auto-naming) — see
    // docs/features/tab-status-and-naming.md. Silently skipped if we can't
    // resolve our own exe path; a Claude tab still works fine without them.
    if kind == "claude" {
        if let Ok(exe) = std::env::current_exe() {
            let _ = hooks::install_hooks(std::path::Path::new(&cwd), &exe.to_string_lossy());
        }
        cmd.env("TOO_MANY_TERMINALS_TAB_ID", tab_id.clone());
        cmd.env("TOO_MANY_TERMINALS_PIPE", hook_env.pipe_path.clone());
        // A resumed tab already has a meaningful name — don't let the next
        // prompt trigger another auto-rename.
        if resume_session_id.is_some() {
            hooks::mark_named(&tab_id);
        }
    }

    // The receipt, written into the terminal ahead of the process's own output
    // so the hand-off is visible at the moment it happens. Covers every source
    // a session here draws on, not just the `.env` we applied ourselves — the
    // `settings.json` blocks are gated on `kind == "claude"` because that's the
    // only kind they actually reach. Key names only; values stay in this
    // process. Sent before `on_data` moves into the closure below;
    // `Channel::send` only needs `&self`.
    let receipt = env_sources::collect(std::path::Path::new(&cwd), dotenv.as_ref())
        .receipt(kind == "claude");
    if !receipt.is_empty() {
        let _ = on_data.send(InvokeResponseBody::Raw(receipt.into_bytes()));
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

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EnvVar {
    name: String,
    /// Which file this name wins from: `dotenv` | `global` | `project` | `local`.
    source: &'static str,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EnvReport {
    vars: Vec<EnvVar>,
    refused: Vec<String>,
    unreadable: bool,
    /// Whether this folder contributes credentials of its own — what the
    /// sidebar glyph keys on. False when everything came from the global
    /// settings file, which applies to every folder equally.
    folder_scoped: bool,
}

/// Every credential a session opened in `dir` will hold, and which file each
/// one comes from — so a folder carrying credentials is readable at rest,
/// without opening a tab in it. See docs/features/env-loading.md.
///
/// Values are dropped here and never cross the IPC boundary; the frontend only
/// ever learns which names exist.
#[tauri::command(async)]
pub fn env_names(dir: String) -> EnvReport {
    let path = std::path::Path::new(&dir);
    let loaded = dotenv::load(path);
    let collected = env_sources::collect(path, loaded.as_ref());
    EnvReport {
        vars: collected
            .vars
            .iter()
            .map(|(name, source)| EnvVar { name: name.clone(), source: source.key() })
            .collect(),
        refused: collected.refused.clone(),
        unreadable: collected.dotenv_unreadable,
        folder_scoped: collected.has_folder_scoped(),
    }
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
pub fn read_transcript(
    project_dir: String,
    session_id: String,
) -> Result<Vec<crate::session_history::TranscriptTurn>, String> {
    let root = projects_root().ok_or("could not resolve home directory")?;
    crate::session_history::read_transcript(&root, &project_dir, &session_id)
}

#[tauri::command]
pub async fn get_session_usage_stats() -> Result<crate::session_usage::SessionUsageStats, String> {
    let credentials = crate::session_usage::credentials_path().ok_or("could not resolve home directory")?;
    let config = crate::session_usage::config_path().ok_or("could not resolve home directory")?;
    Ok(crate::session_usage::session_usage_stats(&credentials, &config).await)
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
    if let Some(legacy) = workspace::legacy_config_dir() {
        workspace::migrate_legacy_workspace(&root, &legacy);
    }
    workspace::load_workspace(&root)
}

#[tauri::command(async)]
pub fn save_workspace(state: WorkspaceState) -> Result<(), String> {
    let root = workspace::config_dir().ok_or("could not resolve config directory")?;
    workspace::save_workspace(&root, &state)
}

#[tauri::command(async)]
pub fn load_settings() -> AppSettings {
    let Some(root) = workspace::config_dir() else {
        return AppSettings::default();
    };
    settings::load_settings(&root)
}

#[tauri::command(async)]
pub fn save_settings(settings: AppSettings) -> Result<(), String> {
    let root = workspace::config_dir().ok_or("could not resolve config directory")?;
    settings::save_settings(&root, &settings)
}

#[tauri::command(async)]
pub fn uninstall_hooks(cwd: String) -> Result<(), String> {
    hooks::uninstall_hooks(std::path::Path::new(&cwd))
}

#[tauri::command(async)]
pub fn list_dir(dir: String) -> Result<Vec<files::DirEntry>, String> {
    files::list_dir(std::path::Path::new(&dir))
}

#[tauri::command(async)]
pub fn read_file(path: String) -> Result<String, String> {
    files::read_text(std::path::Path::new(&path))
}

#[tauri::command(async)]
pub fn write_file(path: String, root: String, contents: String) -> Result<(), String> {
    files::write_text(std::path::Path::new(&path), std::path::Path::new(&root), &contents)
}
