use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;

const MAX_ENTRIES: usize = 50;
const PREVIEW_MAX_CHARS: usize = 100;
const PREVIEW_SCAN_LINE_LIMIT: usize = 300;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionHistoryEntry {
    pub session_id: String,
    pub preview: String,
    pub last_used_iso: String,
}

/// Mirrors the folder-naming scheme Claude Code itself uses under
/// ~/.claude/projects — colons and path separators become hyphens, case kept as-is.
pub fn encode_project_dir(dir: &str) -> String {
    dir.chars()
        .map(|c| if c == ':' || c == '\\' || c == '/' { '-' } else { c })
        .collect()
}

/// Root directory holding Claude Code transcripts (`~/.claude/projects`).
pub fn projects_root() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude").join("projects"))
}

fn extract_text(content: &Value) -> Option<&str> {
    match content {
        Value::String(s) => Some(s),
        Value::Array(blocks) => blocks.iter().find_map(|b| {
            (b.get("type").and_then(Value::as_str) == Some("text"))
                .then(|| b.get("text").and_then(Value::as_str))
                .flatten()
        }),
        _ => None,
    }
}

/// True for Claude Terminal / Claude Code's own synthetic wrapper messages
/// (slash-command echoes, hook notices, caveats) rather than something the
/// human actually typed.
fn looks_synthetic(text: &str) -> bool {
    text.trim_start().starts_with('<')
}

fn clean_preview(text: &str) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(PREVIEW_MAX_CHARS)
        .collect()
}

fn read_preview(file_path: &Path) -> String {
    let Ok(file) = fs::File::open(file_path) else {
        return "(no preview)".to_string();
    };
    let reader = BufReader::new(file);
    let mut fallback: Option<String> = None;

    for line in reader.lines().take(PREVIEW_SCAN_LINE_LIMIT) {
        let Ok(line) = line else { break };
        if line.is_empty() {
            break;
        }
        let Ok(entry) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if entry.get("type").and_then(Value::as_str) != Some("user") {
            continue;
        }
        let text = entry
            .get("message")
            .and_then(|m| m.get("content"))
            .and_then(extract_text)
            .map(str::trim)
            .filter(|t| !t.is_empty());
        let Some(text) = text else { continue };
        if !looks_synthetic(text) {
            return clean_preview(text);
        }
        fallback.get_or_insert_with(|| text.to_string());
    }

    clean_preview(fallback.as_deref().unwrap_or("(no preview)"))
}

fn mtime_iso(mtime: std::time::SystemTime) -> String {
    chrono::DateTime::<chrono::Utc>::from(mtime)
        .format("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string()
}

/// Lists past Claude Code sessions for a project directory by reading its
/// transcript files under `root` (normally ~/.claude/projects) — the same
/// local, real-time logs the CLI writes as you work. Read-only, offline,
/// sorted most-recent-first.
pub fn list_sessions(root: &Path, project_dir: &str) -> Vec<SessionHistoryEntry> {
    let dir_path = root.join(encode_project_dir(project_dir));
    let Ok(read_dir) = fs::read_dir(&dir_path) else {
        return Vec::new();
    };

    let mut files: Vec<(PathBuf, std::time::SystemTime)> = read_dir
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().is_some_and(|ext| ext == "jsonl"))
        .filter_map(|e| {
            let mtime = e.metadata().ok()?.modified().ok()?;
            Some((e.path(), mtime))
        })
        .collect();

    files.sort_by(|a, b| b.1.cmp(&a.1));
    files.truncate(MAX_ENTRIES);

    files
        .into_iter()
        .filter_map(|(path, mtime)| {
            let session_id = path.file_stem()?.to_string_lossy().into_owned();
            Some(SessionHistoryEntry {
                session_id,
                preview: read_preview(&path),
                last_used_iso: mtime_iso(mtime),
            })
        })
        .collect()
}

fn valid_session_id(session_id: &str) -> bool {
    !session_id.is_empty()
        && session_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// Deletes a past session's transcript file. Silently no-ops if it's already gone.
pub fn delete_session(root: &Path, project_dir: &str, session_id: &str) -> Result<(), String> {
    if !valid_session_id(session_id) {
        return Err(format!("Invalid session id: {session_id}"));
    }
    let file_path = root
        .join(encode_project_dir(project_dir))
        .join(format!("{session_id}.jsonl"));
    match fs::remove_file(&file_path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_session(root: &Path, project_dir: &str, session_id: &str, lines: &[&str]) -> PathBuf {
        let dir = root.join(encode_project_dir(project_dir));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(format!("{session_id}.jsonl"));
        let mut f = fs::File::create(&path).unwrap();
        for line in lines {
            writeln!(f, "{line}").unwrap();
        }
        path
    }

    #[test]
    fn encodes_windows_and_unix_paths() {
        assert_eq!(encode_project_dir(r"C:\Users\x"), "C--Users-x");
        assert_eq!(encode_project_dir("/home/x"), "-home-x");
        assert_eq!(encode_project_dir("plain"), "plain");
    }

    #[test]
    fn lists_sessions_with_previews() {
        let tmp = tempfile::tempdir().unwrap();
        write_session(
            tmp.path(),
            "/home/x",
            "sess-1",
            &[r#"{"type":"user","message":{"content":"hello   world  from me"}}"#],
        );

        let entries = list_sessions(tmp.path(), "/home/x");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].session_id, "sess-1");
        assert_eq!(entries[0].preview, "hello world from me");
        assert!(entries[0].last_used_iso.ends_with('Z'));
    }

    #[test]
    fn skips_synthetic_messages_but_falls_back_to_them() {
        let tmp = tempfile::tempdir().unwrap();
        write_session(
            tmp.path(),
            "/p",
            "synth-then-real",
            &[
                r#"{"type":"user","message":{"content":"<command-name>/foo</command-name>"}}"#,
                r#"{"type":"user","message":{"content":"real question"}}"#,
            ],
        );
        write_session(
            tmp.path(),
            "/p2",
            "synth-only",
            &[r#"{"type":"user","message":{"content":"<caveat>only synthetic</caveat>"}}"#],
        );

        let entries = list_sessions(tmp.path(), "/p");
        assert_eq!(entries[0].preview, "real question");

        let entries = list_sessions(tmp.path(), "/p2");
        assert_eq!(entries[0].preview, "<caveat>only synthetic</caveat>");
    }

    #[test]
    fn handles_content_blocks_and_bad_json() {
        let tmp = tempfile::tempdir().unwrap();
        write_session(
            tmp.path(),
            "/p",
            "blocks",
            &[
                "this is not json at all",
                r#"{"type":"assistant","message":{"content":"not a user msg"}}"#,
                r#"{"type":"user","message":{"content":[{"type":"text","text":"from a block"}]}}"#,
            ],
        );

        let entries = list_sessions(tmp.path(), "/p");
        assert_eq!(entries[0].preview, "from a block");
    }

    #[test]
    fn truncates_long_previews() {
        let tmp = tempfile::tempdir().unwrap();
        let long = "x".repeat(500);
        write_session(
            tmp.path(),
            "/p",
            "long",
            &[&format!(r#"{{"type":"user","message":{{"content":"{long}"}}}}"#)],
        );

        let entries = list_sessions(tmp.path(), "/p");
        assert_eq!(entries[0].preview.chars().count(), 100);
    }

    #[test]
    fn missing_project_dir_yields_empty() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(list_sessions(tmp.path(), "/does/not/exist").is_empty());
    }

    #[test]
    fn delete_validates_and_noops_on_missing() {
        let tmp = tempfile::tempdir().unwrap();
        let path = write_session(
            tmp.path(),
            "/p",
            "gone",
            &[r#"{"type":"user","message":{"content":"x"}}"#],
        );

        assert!(delete_session(tmp.path(), "/p", "../evil").is_err());
        assert!(delete_session(tmp.path(), "/p", "gone").is_ok());
        assert!(!path.exists());
        // second delete: already gone, still ok
        assert!(delete_session(tmp.path(), "/p", "gone").is_ok());
    }
}
