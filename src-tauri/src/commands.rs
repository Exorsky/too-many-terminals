use portable_pty::CommandBuilder;
use serde::Serialize;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter, State};

use crate::claude::{claude_command, login_shell_path, resume_flags};
use crate::pty::PtyManager;
use crate::shell::{all_shell_options, shell_option, Platform, ShellOption};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PtyExitPayload {
    tab_id: String,
}

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

    let mut cmd = CommandBuilder::new(program);
    cmd.args(args);
    cmd.cwd(cwd);
    cmd.env("TERM", "xterm-256color");
    if let Some(path) = login_shell_path() {
        cmd.env("PATH", path);
    }

    let exit_tab_id = tab_id.clone();
    ptys.spawn(
        tab_id,
        cmd,
        cols,
        rows,
        move |bytes| {
            let _ = on_data.send(InvokeResponseBody::Raw(bytes));
        },
        move || {
            let _ = app.emit("pty-exit", PtyExitPayload { tab_id: exit_tab_id });
        },
    )
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

#[tauri::command]
pub fn home_dir() -> Result<String, String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .ok_or_else(|| "could not resolve home directory".to_string())
}
