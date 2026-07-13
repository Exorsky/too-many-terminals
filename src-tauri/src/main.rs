// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // This same executable doubles as the Claude Code hook command it
    // installs into projects (see hooks::install_hooks) — invoked as
    // `<exe> --claude-terminal-hook <event>` instead of launching the GUI.
    let args: Vec<String> = std::env::args().collect();
    if let [_, flag, event] = args.as_slice() {
        if flag == "--claude-terminal-hook" {
            claude_terminal_lib::run_hook_client(event);
            return;
        }
    }
    claude_terminal_lib::run()
}
