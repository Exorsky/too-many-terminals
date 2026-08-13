//! Per-session aggregates for the Home dashboard — read from the same local
//! Claude Code transcripts (`~/.claude/projects/**/*.jsonl`) that
//! `session_history` lists, but scanning the *whole* file to sum turns, tokens,
//! tool commands and model use rather than stopping at the first message.
//! Plain Rust, offline, read-only; `commands.rs` is the Tauri adapter.
//!
//! ponytail: full transcript scan of up to 50 files per project on every Home
//! visit. It's an `async` command (off the main thread) on an idle screen, so
//! it's fine today; if a huge history drags, add an mtime-keyed parse cache.

use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::Serialize;
use serde_json::Value;

use crate::session_history::{
    clean_preview, encode_project_dir, extract_text, looks_synthetic, mtime_iso,
};

/// Same cap `session_history` uses — bounds both the read cost and how far back
/// the dashboard sees, per project.
const MAX_SESSIONS: usize = 50;

/// One session, reduced to the numbers the dashboard aggregates across days,
/// folders and models. Token fields are raw counts (honest, unlike a
/// percentage-of-limit estimate — see docs/features/usage-meter.md); the
/// live rate-limit percentages come from a different source.
#[derive(Debug, Clone, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionStat {
    pub session_id: String,
    /// File mtime — used to bucket the session onto a day and to sort.
    pub last_used_iso: String,
    /// First / last message timestamp, for session duration and time-of-day.
    pub started_iso: Option<String>,
    pub ended_iso: Option<String>,
    /// Prompts you actually typed (real, non-synthetic user messages).
    pub turns: u32,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_creation_tokens: u64,
    /// The model that produced the most output in this session, if any.
    pub model: Option<String>,
    /// First real prompt, for the hover caption (serif, "your words back").
    pub preview: String,
    /// First token of every Bash/PowerShell call, counted (e.g. `git` → 12).
    pub commands: Vec<(String, u32)>,
}

/// The command a Bash/PowerShell call actually ran, reduced to its first word.
/// A leading `sudo` is skipped so the real command shows.
/// ponytail: naive first-token split; doesn't unwrap `env X=Y cmd` or `cd a &&`.
fn first_command_token(command: &str) -> Option<String> {
    let mut tokens = command.split_whitespace();
    let first = tokens.next()?;
    let word = if first == "sudo" { tokens.next().unwrap_or(first) } else { first };
    (!word.is_empty()).then(|| word.to_string())
}

fn u64_field(usage: &Value, key: &str) -> u64 {
    usage.get(key).and_then(Value::as_u64).unwrap_or(0)
}

fn parse_session_file(path: &Path, mtime: SystemTime) -> Option<SessionStat> {
    let session_id = path.file_stem()?.to_string_lossy().into_owned();
    let file = fs::File::open(path).ok()?;
    let reader = BufReader::new(file);

    let mut stat = SessionStat {
        session_id,
        last_used_iso: mtime_iso(mtime),
        ..Default::default()
    };
    let mut commands: HashMap<String, u32> = HashMap::new();
    let mut model_output: HashMap<String, u64> = HashMap::new();
    let mut preview: Option<String> = None;

    for line in reader.lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let Ok(entry) = serde_json::from_str::<Value>(&line) else {
            continue;
        };

        if let Some(ts) = entry.get("timestamp").and_then(Value::as_str) {
            if stat.started_iso.is_none() {
                stat.started_iso = Some(ts.to_string());
            }
            stat.ended_iso = Some(ts.to_string());
        }

        match entry.get("type").and_then(Value::as_str) {
            Some("user") => {
                let text = entry
                    .get("message")
                    .and_then(|m| m.get("content"))
                    .and_then(extract_text)
                    .map(str::trim)
                    .filter(|t| !t.is_empty());
                if let Some(text) = text {
                    if !looks_synthetic(text) {
                        stat.turns += 1;
                        preview.get_or_insert_with(|| clean_preview(text));
                    }
                }
            }
            Some("assistant") => {
                let message = entry.get("message");
                let mut out = 0;
                if let Some(usage) = message.and_then(|m| m.get("usage")) {
                    stat.input_tokens += u64_field(usage, "input_tokens");
                    out = u64_field(usage, "output_tokens");
                    stat.output_tokens += out;
                    stat.cache_read_tokens += u64_field(usage, "cache_read_input_tokens");
                    stat.cache_creation_tokens += u64_field(usage, "cache_creation_input_tokens");
                }
                if let Some(model) = message.and_then(|m| m.get("model")).and_then(Value::as_str) {
                    // Attribute output tokens to the model, so the "dominant"
                    // model is the one that did the most work (+1 so a message
                    // with no output still counts toward its model).
                    *model_output.entry(model.to_string()).or_insert(0) += out + 1;
                }
                if let Some(Value::Array(items)) = message.and_then(|m| m.get("content")) {
                    for block in items {
                        if block.get("type").and_then(Value::as_str) != Some("tool_use") {
                            continue;
                        }
                        let name = block.get("name").and_then(Value::as_str).unwrap_or("");
                        if name != "Bash" && name != "PowerShell" {
                            continue;
                        }
                        let token = block
                            .get("input")
                            .and_then(|i| i.get("command"))
                            .and_then(Value::as_str)
                            .and_then(first_command_token);
                        if let Some(token) = token {
                            *commands.entry(token).or_insert(0) += 1;
                        }
                    }
                }
            }
            _ => {}
        }
    }

    stat.preview = preview.unwrap_or_default();
    stat.model = model_output.into_iter().max_by_key(|(_, out)| *out).map(|(m, _)| m);
    stat.commands = commands.into_iter().collect();
    Some(stat)
}

/// Aggregates the newest [`MAX_SESSIONS`] transcripts for a project directory.
/// Missing/unreadable folder → empty, same as `list_sessions`.
pub fn read_session_stats(root: &Path, project_dir: &str) -> Vec<SessionStat> {
    let dir_path = root.join(encode_project_dir(project_dir));
    let Ok(read_dir) = fs::read_dir(&dir_path) else {
        return Vec::new();
    };

    let mut files: Vec<(PathBuf, SystemTime)> = read_dir
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().is_some_and(|ext| ext == "jsonl"))
        .filter_map(|e| {
            let mtime = e.metadata().ok()?.modified().ok()?;
            Some((e.path(), mtime))
        })
        .collect();

    files.sort_by(|a, b| b.1.cmp(&a.1));
    files.truncate(MAX_SESSIONS);

    files
        .into_iter()
        .filter_map(|(path, mtime)| parse_session_file(&path, mtime))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_session(root: &Path, project_dir: &str, session_id: &str, lines: &[&str]) {
        let dir = root.join(encode_project_dir(project_dir));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(format!("{session_id}.jsonl"));
        let mut f = fs::File::create(&path).unwrap();
        for line in lines {
            writeln!(f, "{line}").unwrap();
        }
    }

    #[test]
    fn first_token_skips_sudo_and_handles_empty() {
        assert_eq!(first_command_token("git status"), Some("git".into()));
        assert_eq!(first_command_token("  pnpm   test "), Some("pnpm".into()));
        assert_eq!(first_command_token("sudo cargo build"), Some("cargo".into()));
        assert_eq!(first_command_token("   "), None);
    }

    #[test]
    fn aggregates_turns_tokens_commands_and_model() {
        let tmp = tempfile::tempdir().unwrap();
        write_session(
            tmp.path(),
            "/p",
            "s1",
            &[
                r#"{"type":"user","message":{"content":"<command-name>/foo</command-name>"},"timestamp":"2026-08-10T09:00:00Z"}"#,
                r#"{"type":"user","message":{"content":"fix the bug"},"timestamp":"2026-08-10T09:00:05Z"}"#,
                r#"{"type":"assistant","message":{"model":"claude-sonnet-4-5","usage":{"input_tokens":100,"output_tokens":40,"cache_read_input_tokens":900,"cache_creation_input_tokens":10},"content":[{"type":"text","text":"ok"},{"type":"tool_use","name":"Bash","input":{"command":"git status"}}]}}"#,
                r#"{"type":"user","message":{"content":[{"type":"tool_result","content":"done"}]}}"#,
                r#"{"type":"user","message":{"content":"now ship it"},"timestamp":"2026-08-10T09:10:00Z"}"#,
                r#"{"type":"assistant","message":{"model":"claude-opus-4-8","usage":{"input_tokens":50,"output_tokens":500},"content":[{"type":"tool_use","name":"Bash","input":{"command":"git push"}},{"type":"tool_use","name":"Read","input":{"file_path":"a.rs"}}]}}"#,
            ],
        );

        let stats = read_session_stats(tmp.path(), "/p");
        assert_eq!(stats.len(), 1);
        let s = &stats[0];
        // two real prompts (synthetic + tool_result user lines don't count)
        assert_eq!(s.turns, 2);
        assert_eq!(s.preview, "fix the bug");
        assert_eq!(s.input_tokens, 150);
        assert_eq!(s.output_tokens, 540);
        assert_eq!(s.cache_read_tokens, 900);
        assert_eq!(s.cache_creation_tokens, 10);
        // opus produced far more output → dominant
        assert_eq!(s.model.as_deref(), Some("claude-opus-4-8"));
        assert_eq!(s.started_iso.as_deref(), Some("2026-08-10T09:00:00Z"));
        assert_eq!(s.ended_iso.as_deref(), Some("2026-08-10T09:10:00Z"));
        // git counted twice; Read ignored (not a shell)
        assert_eq!(s.commands, vec![("git".to_string(), 2)]);
    }

    #[test]
    fn missing_project_dir_yields_empty() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(read_session_stats(tmp.path(), "/nope").is_empty());
    }

    #[test]
    fn tolerates_bad_lines_and_missing_usage() {
        let tmp = tempfile::tempdir().unwrap();
        write_session(
            tmp.path(),
            "/p",
            "s2",
            &[
                "not json",
                r#"{"type":"summary","summary":"ignored"}"#,
                r#"{"type":"assistant","message":{"content":[{"type":"text","text":"no usage block"}]}}"#,
            ],
        );
        let stats = read_session_stats(tmp.path(), "/p");
        assert_eq!(stats.len(), 1);
        assert_eq!(stats[0].turns, 0);
        assert_eq!(stats[0].output_tokens, 0);
        assert!(stats[0].model.is_none());
        assert!(stats[0].commands.is_empty());
    }
}
