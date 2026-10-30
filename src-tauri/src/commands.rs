use portable_pty::CommandBuilder;
use serde::Serialize;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_opener::OpenerExt;

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

// Both commands below are `async` so their blocking call runs off the main
// thread: `write_all`/`resize` talk to the child process's own pipe, and a
// wedged child (e.g. two `claude` processes fighting over the same session's
// transcript file — see docs/features/vscode-handoff.md) can leave that pipe
// buffer full. On the main thread that would freeze the whole window, not
// just the one tab.
#[tauri::command(async)]
pub fn pty_write(ptys: State<'_, PtyManager>, tab_id: String, data: String) -> Result<(), String> {
    ptys.write(&tab_id, &data)
}

#[tauri::command(async)]
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

/// Hands a live session off to the VS Code Claude Code extension: opens/
/// focuses VS Code on `cwd`, then fires the extension's own `vscode://` deep
/// link to resume `session_id` there. Both tools read the same transcript
/// file (see `session_history::projects_root`), so there is nothing to copy —
/// this is purely "point the other app at what's already on disk". The
/// caller is expected to have already put the TMT tab to sleep so only one
/// `claude` process is appending to the transcript at a time.
#[tauri::command(async)]
pub fn open_in_vscode(app: AppHandle, cwd: String, session_id: String) -> Result<(), String> {
    use crate::editor::{code_command, session_uri};

    let (program, args) = code_command(Platform::current(), &cwd);
    let mut command = std::process::Command::new(&program);
    command.args(&args);
    if let Some(path) = login_shell_path() {
        command.env("PATH", path);
    }
    crate::namer::no_window(&mut command);
    command
        .spawn()
        .map_err(|_| "`code` not found on PATH — install the VS Code command line tool".to_string())?;

    // VS Code needs a moment to focus the window and activate the extension
    // before it can answer the deep link; firing immediately routes it to
    // whichever window last had focus, not the one we just opened.
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(1500));
        let _ = app.opener().open_url(session_uri(&session_id), None::<&str>);
    });

    Ok(())
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

/// Full-text search across every transcript under ~/.claude/projects.
///
/// All projects, not just the open ones: the session you half-remember is
/// usually in a folder you closed months ago, which is exactly when search
/// beats scrolling. A flat scan — see `search_transcripts` for why there is no
/// index.
#[tauri::command(async)]
pub fn search_transcripts(
    query: String,
    limit: Option<usize>,
) -> Result<Vec<crate::session_history::TranscriptHit>, String> {
    let root = projects_root().ok_or("could not resolve home directory")?;
    Ok(crate::session_history::search_transcripts(
        &root,
        &query,
        limit.unwrap_or(60),
    ))
}

#[tauri::command(async)]
pub fn read_transcript(
    project_dir: String,
    session_id: String,
) -> Result<Vec<crate::session_history::TranscriptTurn>, String> {
    let root = projects_root().ok_or("could not resolve home directory")?;
    crate::session_history::read_transcript(&root, &project_dir, &session_id)
}

/// Copies a session's transcript out to `dest` so it can be handed to a
/// colleague on another machine — see docs/features/session-transfer.md.
#[tauri::command(async)]
pub fn export_session(project_dir: String, session_id: String, dest: String) -> Result<(), String> {
    let root = projects_root().ok_or("could not resolve home directory")?;
    crate::session_transfer::export_session(
        &root,
        &project_dir,
        &session_id,
        std::path::Path::new(&dest),
    )
}

/// Imports a received transcript file into `project_dir`'s store and returns the
/// session id to resume — see docs/features/session-transfer.md.
#[tauri::command(async)]
pub fn import_session(project_dir: String, src: String) -> Result<String, String> {
    let root = projects_root().ok_or("could not resolve home directory")?;
    crate::session_transfer::import_session(&root, &project_dir, std::path::Path::new(&src))
}

#[tauri::command(async)]
pub fn get_session_stats(
    project_dir: String,
) -> Result<Vec<crate::session_stats::SessionStat>, String> {
    let root = projects_root().ok_or("could not resolve home directory")?;
    Ok(crate::session_stats::read_session_stats(&root, &project_dir))
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

/// Creates (idempotently) this session's own scratch working directory —
/// the one ⌘N spawns Claude in when there's no project involved. See
/// docs/features/scratch-sessions.md.
#[tauri::command(async)]
pub fn create_scratch_dir(session_id: String) -> Result<String, String> {
    let home = dirs::home_dir().ok_or("could not resolve home directory")?;
    workspace::create_scratch_dir(&home, &session_id)
}

#[tauri::command(async)]
pub fn load_tasks() -> Vec<serde_json::Value> {
    let Some(root) = workspace::config_dir() else {
        return Vec::new();
    };
    crate::tasks::load_tasks(&root)
}

#[tauri::command(async)]
pub fn save_tasks(tasks: Vec<serde_json::Value>) -> Result<(), String> {
    let root = workspace::config_dir().ok_or("could not resolve config directory")?;
    crate::tasks::save_tasks(&root, &tasks)
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

fn claude_settings_path() -> Option<std::path::PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude").join("settings.json"))
}

/// Git status of the repo `dir` is in; `None` outside a repo or without git.
#[tauri::command(async)]
pub fn git_status(dir: String) -> Option<crate::git::GitStatus> {
    crate::git::status(std::path::Path::new(&dir))
}

/// HEAD's full commit id — a session's starting point.
#[tauri::command(async)]
pub fn git_head(dir: String) -> Option<String> {
    crate::git::head_oid(std::path::Path::new(&dir))
}

/// Uncommitted changes, and the commits since `since`.
#[tauri::command(async)]
pub fn git_changes(dir: String, since: Option<String>) -> Option<crate::git::GitChanges> {
    crate::git::changes(std::path::Path::new(&dir), since.as_deref())
}

/// Recent commits across branches, for the branch graph.
#[tauri::command(async)]
pub fn git_graph(dir: String) -> Option<Vec<crate::git::GitCommit>> {
    crate::git::graph(std::path::Path::new(&dir), 120)
}

/// One file's diff, in a commit or in the working tree.
#[tauri::command(async)]
pub fn git_file_diff(dir: String, path: String, commit: Option<String>) -> Option<String> {
    crate::git::file_diff(std::path::Path::new(&dir), &path, commit.as_deref())
}

/// Saved Jira settings and the token behind their variable — or why there's
/// nothing to ask Jira with.
fn jira_config() -> Result<(AppSettings, Option<String>), String> {
    let root = workspace::config_dir().ok_or("could not resolve config directory")?;
    let s = settings::load_settings(&root);
    crate::jira::check_enabled(s.jira_enabled, &s.jira_base_url)?;
    let token = claude_settings_path().and_then(|p| crate::jira::resolve_token(&s.jira_token_var, &p));
    // A variable that's named but doesn't resolve would send an anonymous
    // request — a pointless 401 that then pauses every lookup for 5 minutes.
    if !s.jira_token_var.is_empty() && token.is_none() {
        return Err(format!("{} not found", s.jira_token_var));
    }
    Ok((s, token))
}

/// One Jira issue for the hover card. Reads the base URL and the token's
/// variable name from saved settings, so the token itself never crosses IPC.
#[tauri::command]
pub async fn jira_issue(key: String) -> Result<crate::jira::JiraIssue, String> {
    let (s, token) = jira_config()?;
    crate::jira::fetch_issue(&s.jira_base_url, token.as_deref(), &key).await
}

/// An issue's description and latest comment, for the My issues inspector.
#[tauri::command]
pub async fn jira_issue_detail(key: String) -> Result<crate::jira::JiraIssueDetail, String> {
    let (s, token) = jira_config()?;
    crate::jira::fetch_issue_detail(&s.jira_base_url, token.as_deref(), &key).await
}

/// Open issues assigned to whoever owns the token.
#[tauri::command]
pub async fn jira_my_issues() -> Result<Vec<crate::jira::JiraIssue>, String> {
    let (s, token) = jira_config()?;
    let token = token.ok_or("Set a token variable to see your issues")?;
    crate::jira::fetch_my_issues(&s.jira_base_url, &token).await
}

/// Whether a token variable resolves to anything — a yes/no for Settings,
/// never the value.
#[tauri::command(async)]
pub fn jira_token_found(var: String) -> bool {
    claude_settings_path().and_then(|p| crate::jira::resolve_token(&var, &p)).is_some()
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
