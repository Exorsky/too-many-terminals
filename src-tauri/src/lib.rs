mod claude;
mod commands;
mod pty;
mod session_history;
mod shell;
mod usage;
mod workspace;

use pty::PtyManager;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(PtyManager::default())
        .invoke_handler(tauri::generate_handler![
            commands::pty_spawn,
            commands::pty_write,
            commands::pty_resize,
            commands::pty_kill,
            commands::list_shells,
            commands::home_dir,
            commands::list_sessions,
            commands::delete_session,
            commands::get_usage_stats,
            commands::load_workspace,
            commands::save_workspace,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                app.state::<PtyManager>().kill_all();
            }
        });
}
