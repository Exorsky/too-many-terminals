//! Installs Claude Code's own lifecycle hooks (SessionStart, PreToolUse, Stop,
//! Notification, SessionEnd, UserPromptSubmit) into a project's
//! `.claude/settings.local.json`, pointing them back at this same executable
//! invoked with `--too-many-terminals-hook <event>`. That invocation runs
//! [`run_hook_client`] instead of launching the GUI — it reads the hook's
//! stdin JSON, forwards a small message over the hook pipe (see
//! `hook_server.rs`), and exits. No bundled Node.js runtime needed.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

/// (Claude Code hook name, argument we pass ourselves via `--too-many-terminals-hook`).
const HOOK_EVENTS: [(&str, &str); 6] = [
    ("SessionStart", "session-start"),
    ("UserPromptSubmit", "prompt-submit"),
    ("PreToolUse", "pre-tool-use"),
    ("Stop", "stop"),
    ("Notification", "notification"),
    ("SessionEnd", "session-end"),
];

/// Substring that marks a hook command entry as ours, regardless of where the
/// executable is installed — lets us find-and-replace our own entries without
/// disturbing hooks the user configured themselves.
const HOOK_MARKER: &str = "--too-many-terminals-hook";

/// Marker used before the app was renamed to Too Many Terminals. Still
/// recognized as ours so re-registration strips stale entries left in
/// projects instrumented by an older build.
const LEGACY_HOOK_MARKER: &str = "--claude-terminal-hook";

fn settings_path(cwd: &Path) -> PathBuf {
    cwd.join(".claude").join("settings.local.json")
}

fn build_hook_command(exe: &str, event_arg: &str) -> String {
    format!("\"{exe}\" {HOOK_MARKER} {event_arg}")
}

fn is_our_hook(command: &str) -> bool {
    command.contains(HOOK_MARKER) || command.contains(LEGACY_HOOK_MARKER)
}

fn is_our_group(group: &Value) -> bool {
    group
        .get("hooks")
        .and_then(Value::as_array)
        .is_some_and(|hooks| {
            !hooks.is_empty()
                && hooks.iter().all(|h| {
                    h.get("command")
                        .and_then(Value::as_str)
                        .is_some_and(is_our_hook)
                })
        })
}

/// Merges our hook entries into an existing (possibly empty) settings JSON
/// value: drops any previous entries we authored for each event (so re-runs
/// don't duplicate), keeps anything the user configured themselves, appends
/// our fresh entry, and leaves unrelated top-level keys untouched.
pub fn merge_settings(existing: Value, exe: &str) -> Value {
    let mut root = match existing {
        Value::Object(map) => map,
        _ => serde_json::Map::new(),
    };
    let hooks = root
        .entry("hooks")
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .map(std::mem::take)
        .unwrap_or_default();
    let mut hooks = hooks;

    for (event_name, event_arg) in HOOK_EVENTS {
        let mut entries = hooks
            .get(event_name)
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        entries.retain(|group| !is_our_group(group));
        entries.push(json!({
            "matcher": "",
            "hooks": [{
                "type": "command",
                "command": build_hook_command(exe, event_arg),
                "timeout": 10
            }]
        }));
        hooks.insert(event_name.to_string(), Value::Array(entries));
    }

    root.insert("hooks".to_string(), Value::Object(hooks));
    Value::Object(root)
}

/// Inverse of [`merge_settings`]: strips our entries, drops now-empty event
/// arrays, and drops the `hooks` key entirely if nothing else is left in it.
pub fn remove_our_hooks(existing: Value) -> Value {
    let Value::Object(mut root) = existing else {
        return existing;
    };
    if let Some(Value::Object(mut hooks)) = root.remove("hooks") {
        for (event_name, _) in HOOK_EVENTS {
            if let Some(Value::Array(entries)) = hooks.get_mut(event_name) {
                entries.retain(|group| !is_our_group(group));
            }
        }
        hooks.retain(|_, v| !v.as_array().is_some_and(Vec::is_empty));
        if !hooks.is_empty() {
            root.insert("hooks".to_string(), Value::Object(hooks));
        }
    }
    Value::Object(root)
}

fn read_settings(path: &Path) -> Value {
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| json!({}))
}

/// Writes/merges the hook entries for a project directory. Called every time
/// a Claude tab is spawned there — cheap (small JSON file), and necessary
/// since the hook pipe path is keyed by this process's PID and changes every
/// launch.
pub fn install_hooks(cwd: &Path, exe: &str) -> Result<(), String> {
    let path = settings_path(cwd);
    let updated = merge_settings(read_settings(&path), exe);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&updated).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

/// Removes just our hook entries from a project's settings, deleting the file
/// if nothing else was in it. No-ops if the file doesn't exist.
pub fn uninstall_hooks(cwd: &Path) -> Result<(), String> {
    let path = settings_path(cwd);
    let Ok(raw) = fs::read_to_string(&path) else {
        return Ok(());
    };
    let Ok(existing) = serde_json::from_str::<Value>(&raw) else {
        return Ok(());
    };
    let updated = remove_our_hooks(existing);
    if updated.as_object().is_some_and(serde_json::Map::is_empty) {
        fs::remove_file(&path).map_err(|e| e.to_string())
    } else {
        let json = serde_json::to_string_pretty(&updated).map_err(|e| e.to_string())?;
        fs::write(&path, json).map_err(|e| e.to_string())
    }
}

/// Flag file marking a tab as already auto-named, so later prompts in the
/// same session don't trigger another rename. Both the hook client (which
/// checks it) and the running app (which clears it on `/clear`, or
/// pre-creates it for resumed tabs) compute this path independently from
/// `std::env::temp_dir()` — no env var needed to share it, since the hook
/// client inherits the same TMP/TMPDIR as its parent.
pub fn naming_flag_path(tab_id: &str) -> PathBuf {
    std::env::temp_dir().join(format!("too-many-terminals-named-{tab_id}"))
}

pub fn mark_named(tab_id: &str) {
    let _ = fs::write(naming_flag_path(tab_id), "");
}

pub fn reset_naming_flag(tab_id: &str) {
    let _ = fs::remove_file(naming_flag_path(tab_id));
}

/// Entry point when this executable is invoked as a Claude Code hook command
/// (see `install_hooks`) instead of launching the GUI. Reads the hook's own
/// stdin JSON payload, forwards a small message over the hook pipe, and
/// returns — mirrors the original Node `on-*.js` + `pipe-send.js` scripts,
/// minus the Node dependency. Silently does nothing if required env vars are
/// missing (i.e. `claude` was invoked outside this app) or the pipe is
/// unreachable — hook failures must never block the user's Claude session.
pub fn run_hook_client(event_arg: &str) {
    let Ok(tab_id) = std::env::var("TOO_MANY_TERMINALS_TAB_ID") else {
        return;
    };
    let Ok(pipe) = std::env::var("TOO_MANY_TERMINALS_PIPE") else {
        return;
    };

    let mut stdin_json = String::new();
    let _ = std::io::stdin().read_to_string(&mut stdin_json);
    let payload: Value = serde_json::from_str(&stdin_json).unwrap_or(Value::Null);

    let message = match event_arg {
        "session-start" => Some(json!({
            "tabId": tab_id,
            "event": "tab:ready",
            "data": json!({
                "sessionId": payload.get("session_id").and_then(Value::as_str),
                "source": payload.get("source").and_then(Value::as_str),
            }).to_string(),
        })),
        "pre-tool-use" => Some(json!({ "tabId": tab_id, "event": "tab:status:working", "data": null })),
        "stop" => Some(json!({ "tabId": tab_id, "event": "tab:status:idle", "data": null })),
        "notification" => Some(json!({ "tabId": tab_id, "event": "tab:status:input", "data": null })),
        "session-end" => Some(json!({ "tabId": tab_id, "event": "tab:closed", "data": null })),
        "prompt-submit" => {
            if naming_flag_path(&tab_id).exists() {
                return;
            }
            let prompt = payload
                .get("user_prompt")
                .or_else(|| payload.get("prompt"))
                .and_then(Value::as_str)
                .unwrap_or("");
            let truncated: String = prompt.chars().take(500).collect();
            if truncated.trim().is_empty() {
                return;
            }
            mark_named(&tab_id);
            Some(json!({ "tabId": tab_id, "event": "tab:generate-name", "data": truncated }))
        }
        _ => None,
    };

    if let Some(message) = message {
        send_line(&pipe, &message.to_string());
    }
}

#[cfg(windows)]
fn send_line(pipe: &str, message: &str) {
    use std::io::Write;
    // A Windows named pipe path opens like a regular file for a one-shot
    // client write (no separate networking API needed).
    if let Ok(mut f) = fs::OpenOptions::new().write(true).open(pipe) {
        let _ = writeln!(f, "{message}");
    }
}

#[cfg(not(windows))]
fn send_line(pipe: &str, message: &str) {
    use std::io::Write;
    use std::os::unix::net::UnixStream;
    if let Ok(mut stream) = UnixStream::connect(pipe) {
        let _ = writeln!(stream, "{message}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn command_of(settings: &Value, event: &str) -> String {
        settings["hooks"][event][0]["hooks"][0]["command"]
            .as_str()
            .unwrap()
            .to_string()
    }

    #[test]
    fn installs_all_six_events_pointing_at_our_exe() {
        let settings = merge_settings(json!({}), "/path/to/exe");
        for (event, arg) in HOOK_EVENTS {
            assert_eq!(command_of(&settings, event), format!("\"/path/to/exe\" --too-many-terminals-hook {arg}"));
        }
    }

    #[test]
    fn re_merging_replaces_our_old_entry_without_duplicating() {
        let first = merge_settings(json!({}), "/old/exe");
        let second = merge_settings(first, "/new/exe");
        let group = second["hooks"]["Stop"].as_array().unwrap();
        assert_eq!(group.len(), 1, "should replace, not duplicate, our own entry");
        assert_eq!(command_of(&second, "Stop"), "\"/new/exe\" --too-many-terminals-hook stop");
    }

    #[test]
    fn preserves_user_authored_hooks_for_the_same_event() {
        let existing = json!({
            "hooks": {
                "Stop": [{ "matcher": "", "hooks": [{ "type": "command", "command": "echo user-hook" }] }]
            }
        });
        let merged = merge_settings(existing, "/path/to/exe");
        let group = merged["hooks"]["Stop"].as_array().unwrap();
        assert_eq!(group.len(), 2);
        assert!(group.iter().any(|g| g["hooks"][0]["command"] == "echo user-hook"));
        assert!(group.iter().any(|g| is_our_group(g)));
    }

    #[test]
    fn preserves_unrelated_top_level_keys() {
        let existing = json!({ "permissions": { "allow": ["Bash"] } });
        let merged = merge_settings(existing, "/exe");
        assert_eq!(merged["permissions"]["allow"][0], "Bash");
    }

    #[test]
    fn is_our_hook_recognizes_current_and_legacy_markers() {
        assert!(is_our_hook("\"/exe\" --too-many-terminals-hook stop"));
        assert!(is_our_hook("\"/exe\" --claude-terminal-hook stop"));
        assert!(!is_our_hook("echo user-hook"));
    }

    #[test]
    fn uninstall_removes_only_our_entries() {
        // The stale entry uses the legacy pre-rename marker, exercising the
        // back-compat path that strips hooks installed by an older build.
        let existing = json!({
            "hooks": {
                "Stop": [
                    { "matcher": "", "hooks": [{ "type": "command", "command": "echo user-hook" }] },
                    { "matcher": "", "hooks": [{ "type": "command", "command": "\"/exe\" --claude-terminal-hook stop" }] },
                ]
            }
        });
        let cleaned = remove_our_hooks(existing);
        let group = cleaned["hooks"]["Stop"].as_array().unwrap();
        assert_eq!(group.len(), 1);
        assert_eq!(group[0]["hooks"][0]["command"], "echo user-hook");
    }

    #[test]
    fn uninstall_drops_hooks_key_when_nothing_left() {
        let existing = merge_settings(json!({}), "/exe");
        let cleaned = remove_our_hooks(existing);
        assert!(cleaned.as_object().unwrap().get("hooks").is_none());
    }

    #[test]
    fn uninstall_keeps_other_top_level_keys_even_when_hooks_empty() {
        let mut existing = merge_settings(json!({}), "/exe");
        existing["permissions"] = json!({ "allow": ["Bash"] });
        let cleaned = remove_our_hooks(existing);
        assert!(cleaned.as_object().unwrap().get("hooks").is_none());
        assert_eq!(cleaned["permissions"]["allow"][0], "Bash");
    }

    #[test]
    fn install_and_uninstall_round_trip_on_disk() {
        let tmp = tempfile::tempdir().unwrap();
        install_hooks(tmp.path(), "/exe").unwrap();
        let path = settings_path(tmp.path());
        assert!(path.exists());

        uninstall_hooks(tmp.path()).unwrap();
        assert!(!path.exists(), "file should be removed once empty");
    }

    #[test]
    fn install_preserves_existing_file_content_across_calls() {
        let tmp = tempfile::tempdir().unwrap();
        fs::create_dir_all(tmp.path().join(".claude")).unwrap();
        fs::write(
            settings_path(tmp.path()),
            json!({ "permissions": { "allow": ["Bash"] } }).to_string(),
        ).unwrap();

        install_hooks(tmp.path(), "/exe").unwrap();
        let raw = fs::read_to_string(settings_path(tmp.path())).unwrap();
        let saved: Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(saved["permissions"]["allow"][0], "Bash");
        assert_eq!(command_of(&saved, "SessionStart"), "\"/exe\" --too-many-terminals-hook session-start");
    }

    #[test]
    fn uninstall_is_a_noop_when_file_is_missing() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(uninstall_hooks(tmp.path()).is_ok());
    }
}
