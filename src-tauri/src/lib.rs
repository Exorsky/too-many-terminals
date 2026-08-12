mod claude;
mod commands;
mod dotenv;
mod editor;
mod env_sources;
mod files;
mod hook_server;
mod hooks;
mod namer;
mod pty;
mod session_history;
mod session_usage;
mod settings;
mod shell;
mod workspace;

use pty::PtyManager;
use tauri::Manager;

pub use hooks::run_hook_client;

/// The hook pipe path is fixed for this process's lifetime (keyed by PID) —
/// computed once at startup and shared between the server (which binds it)
/// and `pty_spawn` (which tells each Claude child where to send messages).
pub struct HookEnv {
    pub pipe_path: String,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(PtyManager::default())
        .setup(|app| {
            // A dev run and an installed build look identical once they're both
            // open — mark the debug one so you always know which is which.
            if cfg!(debug_assertions) {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_title("Too Many Terminals (Dev)");
                }
            }
            let handle = app.handle().clone();
            let pipe_path = hook_server::pipe_path();
            let naming_queue = namer::NamingQueue::spawn(handle.clone());
            hook_server::start(handle, naming_queue, pipe_path.clone());
            app.manage(HookEnv { pipe_path });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::pty_spawn,
            commands::pty_write,
            commands::pty_resize,
            commands::pty_kill,
            commands::list_shells,
            commands::open_in_vscode,
            commands::env_names,
            commands::home_dir,
            commands::list_sessions,
            commands::delete_session,
            commands::read_transcript,
            commands::get_session_usage_stats,
            commands::load_workspace,
            commands::save_workspace,
            commands::load_settings,
            commands::save_settings,
            commands::uninstall_hooks,
            commands::list_dir,
            commands::read_file,
            commands::write_file,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                app.state::<PtyManager>().kill_all();
            }
        });
}
