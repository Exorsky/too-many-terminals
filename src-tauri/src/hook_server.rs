//! Receives newline-delimited JSON messages from hook-client invocations
//! (see `hooks::run_hook_client`) over a per-launch named pipe (Windows) /
//! Unix domain socket (macOS/Linux), and routes each to a frontend event or
//! the naming queue. One connection per message — hook clients are
//! short-lived processes that connect, write one line, and exit.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};

use crate::hooks;
use crate::namer::{NamingJob, NamingQueue};

pub fn pipe_path() -> String {
    #[cfg(windows)]
    {
        format!(r"\\.\pipe\too-many-terminals-hooks-{}", std::process::id())
    }
    #[cfg(not(windows))]
    {
        std::env::temp_dir()
            .join(format!("too-many-terminals-hooks-{}.sock", std::process::id()))
            .to_string_lossy()
            .into_owned()
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HookMessage {
    tab_id: String,
    event: String,
    data: Option<String>,
}

#[derive(Debug, PartialEq)]
enum RoutedAction {
    Status { tab_id: String, status: &'static str },
    SessionResolved { tab_id: String, session_id: String },
    GenerateName { tab_id: String, prompt: String },
    NamingFlagReset { tab_id: String },
}

#[derive(Deserialize)]
struct ReadyPayload {
    #[serde(rename = "sessionId")]
    session_id: Option<String>,
    source: Option<String>,
}

/// Pure routing logic (no I/O) — figures out what a raw hook message means.
/// Kept separate from the async server loop so it's unit-testable.
fn route_message(msg: &HookMessage) -> Vec<RoutedAction> {
    match msg.event.as_str() {
        "tab:status:working" => vec![RoutedAction::Status { tab_id: msg.tab_id.clone(), status: "working" }],
        "tab:status:idle" => vec![RoutedAction::Status { tab_id: msg.tab_id.clone(), status: "idle" }],
        // Claude Code's Notification hook fires both for genuine permission/
        // input requests AND as an idle nudge ("Claude is waiting for your
        // input") ~60s after a turn ends, even when Claude asked nothing. Only
        // the former should chase the user; ignoring the idle nudge keeps a
        // finished-but-unanswered session out of the "Waiting on you" strip.
        // A missing message defaults to requires_response (fail toward
        // surfacing).
        "tab:status:input" => {
            let is_idle_nudge = msg
                .data
                .as_deref()
                .is_some_and(|m| m.to_lowercase().contains("waiting for your input"));
            if is_idle_nudge {
                vec![]
            } else {
                vec![RoutedAction::Status { tab_id: msg.tab_id.clone(), status: "requires_response" }]
            }
        }

        "tab:ready" => {
            let ready: Option<ReadyPayload> = msg.data.as_deref().and_then(|d| serde_json::from_str(d).ok());
            let session_id = ready.as_ref().and_then(|r| r.session_id.clone());
            let source = ready.as_ref().and_then(|r| r.source.clone());

            let mut actions = vec![RoutedAction::Status {
                tab_id: msg.tab_id.clone(),
                status: if session_id.is_some() { "idle" } else { "new" },
            }];
            if let Some(session_id) = session_id {
                actions.push(RoutedAction::SessionResolved { tab_id: msg.tab_id.clone(), session_id });
            }
            // `/clear` starts a fresh conversation in the same tab — let it be
            // auto-named again from the next prompt.
            if source.as_deref() == Some("clear") {
                actions.push(RoutedAction::NamingFlagReset { tab_id: msg.tab_id.clone() });
            }
            actions
        }

        "tab:generate-name" => match msg.data.as_deref() {
            Some(prompt) if !prompt.trim().is_empty() => vec![RoutedAction::GenerateName {
                tab_id: msg.tab_id.clone(),
                prompt: crate::namer::naming_prompt(prompt),
            }],
            _ => vec![],
        },

        // "tab:closed" (SessionEnd fires on real exit AND /clear; real exits
        // are already handled by the pty's own exit event) and anything
        // unrecognized are intentionally ignored.
        _ => vec![],
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TabStatusPayload {
    tab_id: String,
    status: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SessionResolvedPayload {
    tab_id: String,
    session_id: String,
}

fn apply_action(action: RoutedAction, app: &AppHandle, naming_queue: &NamingQueue) {
    match action {
        RoutedAction::Status { tab_id, status } => {
            let _ = app.emit("claude-tab-status", TabStatusPayload { tab_id, status: status.to_string() });
        }
        RoutedAction::SessionResolved { tab_id, session_id } => {
            let _ = app.emit("claude-session-resolved", SessionResolvedPayload { tab_id, session_id });
        }
        RoutedAction::GenerateName { tab_id, prompt } => {
            naming_queue.submit(NamingJob { tab_id, prompt });
        }
        RoutedAction::NamingFlagReset { tab_id } => {
            hooks::reset_naming_flag(&tab_id);
        }
    }
}

async fn handle_connection<S: AsyncRead + Unpin>(stream: S, app: AppHandle, naming_queue: NamingQueue) {
    let mut lines = BufReader::new(stream).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        if line.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(&line) else { continue };
        let Ok(msg) = serde_json::from_value::<HookMessage>(value) else { continue };
        for action in route_message(&msg) {
            apply_action(action, &app, &naming_queue);
        }
    }
}

pub fn start(app: AppHandle, naming_queue: NamingQueue, path: String) {
    tauri::async_runtime::spawn(async move {
        #[cfg(windows)]
        run_windows(app, naming_queue, path).await;
        #[cfg(not(windows))]
        run_unix(app, naming_queue, path).await;
    });
}

#[cfg(windows)]
async fn run_windows(app: AppHandle, naming_queue: NamingQueue, path: String) {
    use tokio::net::windows::named_pipe::ServerOptions;
    loop {
        let Ok(server) = ServerOptions::new().create(&path) else { return };
        if server.connect().await.is_err() {
            continue;
        }
        let app = app.clone();
        let naming_queue = naming_queue.clone();
        tauri::async_runtime::spawn(async move {
            handle_connection(server, app, naming_queue).await;
        });
    }
}

#[cfg(not(windows))]
async fn run_unix(app: AppHandle, naming_queue: NamingQueue, path: String) {
    let _ = std::fs::remove_file(&path); // stale socket from a crashed previous run
    let Ok(listener) = tokio::net::UnixListener::bind(&path) else { return };
    while let Ok((stream, _)) = listener.accept().await {
        let app = app.clone();
        let naming_queue = naming_queue.clone();
        tauri::async_runtime::spawn(async move {
            handle_connection(stream, app, naming_queue).await;
        });
    }
    let _ = std::fs::remove_file(&path);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(tab_id: &str, event: &str, data: Option<&str>) -> HookMessage {
        HookMessage { tab_id: tab_id.to_string(), event: event.to_string(), data: data.map(str::to_string) }
    }

    #[test]
    fn tool_use_maps_to_working() {
        let actions = route_message(&msg("t1", "tab:status:working", None));
        assert_eq!(actions, vec![RoutedAction::Status { tab_id: "t1".into(), status: "working" }]);
    }

    #[test]
    fn stop_maps_to_idle() {
        let actions = route_message(&msg("t1", "tab:status:idle", None));
        assert_eq!(actions, vec![RoutedAction::Status { tab_id: "t1".into(), status: "idle" }]);
    }

    #[test]
    fn notification_without_message_defaults_to_requires_response() {
        let actions = route_message(&msg("t1", "tab:status:input", None));
        assert_eq!(actions, vec![RoutedAction::Status { tab_id: "t1".into(), status: "requires_response" }]);
    }

    #[test]
    fn permission_notification_maps_to_requires_response() {
        let actions = route_message(&msg("t1", "tab:status:input", Some("Claude needs your permission to use Bash")));
        assert_eq!(actions, vec![RoutedAction::Status { tab_id: "t1".into(), status: "requires_response" }]);
    }

    #[test]
    fn idle_waiting_notification_is_ignored() {
        // The ~60s idle nudge must not flip a finished session to
        // requires_response (that's the false "Waiting on you" bug).
        let actions = route_message(&msg("t1", "tab:status:input", Some("Claude is waiting for your input")));
        assert!(actions.is_empty());
    }

    #[test]
    fn session_start_with_id_yields_idle_and_session_resolved() {
        let data = r#"{"sessionId":"sess-1","source":"startup"}"#;
        let actions = route_message(&msg("t1", "tab:ready", Some(data)));
        assert_eq!(actions, vec![
            RoutedAction::Status { tab_id: "t1".into(), status: "idle" },
            RoutedAction::SessionResolved { tab_id: "t1".into(), session_id: "sess-1".into() },
        ]);
    }

    #[test]
    fn session_start_without_id_yields_new_only() {
        let data = r#"{"sessionId":null,"source":"startup"}"#;
        let actions = route_message(&msg("t1", "tab:ready", Some(data)));
        assert_eq!(actions, vec![RoutedAction::Status { tab_id: "t1".into(), status: "new" }]);
    }

    #[test]
    fn session_start_with_clear_source_also_resets_naming_flag() {
        let data = r#"{"sessionId":"sess-2","source":"clear"}"#;
        let actions = route_message(&msg("t1", "tab:ready", Some(data)));
        assert_eq!(actions, vec![
            RoutedAction::Status { tab_id: "t1".into(), status: "idle" },
            RoutedAction::SessionResolved { tab_id: "t1".into(), session_id: "sess-2".into() },
            RoutedAction::NamingFlagReset { tab_id: "t1".into() },
        ]);
    }

    #[test]
    fn generate_name_wraps_the_prompt() {
        let actions = route_message(&msg("t1", "tab:generate-name", Some("fix the bug")));
        match &actions[..] {
            [RoutedAction::GenerateName { tab_id, prompt }] => {
                assert_eq!(tab_id, "t1");
                assert!(prompt.contains("fix the bug"));
            }
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn generate_name_ignores_blank_prompt() {
        assert!(route_message(&msg("t1", "tab:generate-name", Some("   "))).is_empty());
        assert!(route_message(&msg("t1", "tab:generate-name", None)).is_empty());
    }

    #[test]
    fn tab_closed_and_unknown_events_are_ignored() {
        assert!(route_message(&msg("t1", "tab:closed", None)).is_empty());
        assert!(route_message(&msg("t1", "something:else", None)).is_empty());
    }

    #[test]
    fn malformed_ready_payload_falls_back_to_new() {
        let actions = route_message(&msg("t1", "tab:ready", Some("not json")));
        assert_eq!(actions, vec![RoutedAction::Status { tab_id: "t1".into(), status: "new" }]);
    }
}
