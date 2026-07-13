// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // This same executable doubles as the Claude Code hook command it
    // installs into projects (see hooks::install_hooks) — invoked as
    // `<exe> --too-many-terminals-hook <event>` instead of launching the GUI.
    // The legacy `--claude-terminal-hook` flag is still accepted so hook
    // entries persisted before the rename keep routing here (not to the GUI)
    // until re-registration overwrites them on the next session start.
    let args: Vec<String> = std::env::args().collect();
    if let [_, flag, event] = args.as_slice() {
        if flag == "--too-many-terminals-hook" || flag == "--claude-terminal-hook" {
            too_many_terminals_lib::run_hook_client(event);
            return;
        }
    }
    too_many_terminals_lib::run()
}
