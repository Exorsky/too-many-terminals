mod claude;
mod commands;
mod hook_server;
mod hooks;
mod namer;
mod pty;
mod session_history;
mod settings;
mod shell;
mod usage;
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
            commands::home_dir,
            commands::list_sessions,
            commands::delete_session,
            commands::read_transcript,
            commands::get_usage_stats,
            commands::load_workspace,
            commands::save_workspace,
            commands::load_settings,
            commands::save_settings,
            commands::uninstall_hooks,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                app.state::<PtyManager>().kill_all();
            }
        });
}
