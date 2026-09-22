use std::collections::HashSet;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::Serialize;
use serde_json::Value;

const MAX_ENTRIES: usize = 50;
const PREVIEW_MAX_CHARS: usize = 100;
const PREVIEW_SCAN_LINE_LIMIT: usize = 300;
/// Upper bound on turns returned by `read_transcript` — a guard against a
/// pathologically long transcript, not a normal limit (few sessions approach it).
const TRANSCRIPT_MAX_TURNS: usize = 4000;
/// One-line tool argument summaries (e.g. a file path or command) are clipped
/// to this so a chip stays a chip.
const TOOL_DETAIL_MAX_CHARS: usize = 600;
/// Characters of context shown around a search hit.
const SNIPPET_MAX_CHARS: usize = 160;
/// Stop counting matches inside one transcript past this — the exact number
/// beyond "lots" changes no decision, and counting costs a full read.
const MATCHES_PER_SESSION_CAP: usize = 50;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionHistoryEntry {
    pub session_id: String,
    pub preview: String,
    pub last_used_iso: String,
}

/// A single renderable piece of a transcript turn. Tool calls collapse to a
/// name + one-line argument so the reading column stays prose; tool *results*,
/// thinking, and images are dropped by the parser to keep a session readable.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TranscriptBlock {
    Text { text: String },
    Tool { name: String, detail: String },
}

/// One message in a session, reduced to what a reader cares about: who spoke,
/// when, and the text/tool blocks in order.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptTurn {
    /// "user" or "assistant".
    pub role: String,
    pub timestamp: Option<String>,
    pub blocks: Vec<TranscriptBlock>,
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

/// Every text block of a message, in order. A turn can carry several; the
/// preview only ever wanted the first, but search has to see all of them.
pub(crate) fn text_blocks(content: &Value) -> Vec<&str> {
    match content {
        Value::String(s) => vec![s.as_str()],
        Value::Array(blocks) => blocks
            .iter()
            .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
            .filter_map(|b| b.get("text").and_then(Value::as_str))
            .collect(),
        _ => Vec::new(),
    }
}

pub(crate) fn extract_text(content: &Value) -> Option<&str> {
    text_blocks(content).into_iter().next()
}

/// True for Too Many Terminals / Claude Code's own synthetic wrapper messages
/// (slash-command echoes, hook notices, caveats) rather than something the
/// human actually typed.
pub(crate) fn looks_synthetic(text: &str) -> bool {
    text.trim_start().starts_with('<')
}

pub(crate) fn clean_preview(text: &str) -> String {
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

pub(crate) fn mtime_iso(mtime: std::time::SystemTime) -> String {
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

pub(crate) fn valid_session_id(session_id: &str) -> bool {
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

/// Session ids (jsonl file stems) that already exist for a project — take a
/// snapshot of this right before spawning a fresh (non-resumed) Claude tab,
/// then diff against it with `find_new_session` once the CLI has started.
pub fn existing_session_ids(root: &Path, project_dir: &str) -> HashSet<String> {
    let dir_path = root.join(encode_project_dir(project_dir));
    let Ok(entries) = fs::read_dir(&dir_path) else {
        return HashSet::new();
    };
    entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().is_some_and(|ext| ext == "jsonl"))
        .filter_map(|e| e.path().file_stem().map(|s| s.to_string_lossy().into_owned()))
        .collect()
}

/// Finds the session a freshly spawned (non-resumed) Claude tab was assigned,
/// by looking for a transcript file that didn't exist in `existing` and was
/// modified at or after `after`. Claude Code creates the file promptly once
/// the CLI starts, so callers poll this a few times after spawning.
pub fn find_new_session(
    root: &Path,
    project_dir: &str,
    existing: &HashSet<String>,
    after: SystemTime,
) -> Option<String> {
    let dir_path = root.join(encode_project_dir(project_dir));
    let entries = fs::read_dir(&dir_path).ok()?;
    entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().is_some_and(|ext| ext == "jsonl"))
        .filter_map(|e| {
            let stem = e.path().file_stem()?.to_string_lossy().into_owned();
            if existing.contains(&stem) {
                return None;
            }
            let mtime = e.metadata().ok()?.modified().ok()?;
            (mtime >= after).then_some((stem, mtime))
        })
        .max_by_key(|(_, mtime)| *mtime)
        .map(|(stem, _)| stem)
}

/// Reduces a tool call's raw input to the one field worth showing on a chip —
/// the file it touched, the command it ran, the pattern it searched. Falls back
/// to the first recognizable string field, then to empty (chip shows name only).
fn summarize_tool_input(name: &str, input: &Value) -> String {
    let Value::Object(obj) = input else {
        return String::new();
    };
    let pick = |keys: &[&str]| keys.iter().find_map(|k| obj.get(*k).and_then(Value::as_str));
    let raw = match name {
        "Read" | "Edit" | "Write" | "NotebookEdit" => pick(&["file_path", "notebook_path"]),
        "Bash" | "PowerShell" => pick(&["command"]),
        "Grep" | "Glob" => pick(&["pattern"]),
        "WebSearch" => pick(&["query"]),
        "WebFetch" => pick(&["url"]),
        "Skill" => pick(&["skill", "command"]),
        "Task" | "Agent" => pick(&["description"]),
        _ => pick(&[
            "file_path", "command", "pattern", "query", "url", "description", "path",
        ]),
    };
    raw.map(|s| {
        // Collapse runs of spaces/tabs within a line but keep line breaks, so a
        // multi-line command (Bash/PowerShell) stays readable instead of being
        // flattened into one long strip. Blank lines are dropped.
        let cleaned = s
            .lines()
            .map(|line| line.split_whitespace().collect::<Vec<_>>().join(" "))
            .filter(|line| !line.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        cleaned.chars().take(TOOL_DETAIL_MAX_CHARS).collect()
    })
    .unwrap_or_default()
}

/// Turns one message's `content` (a string, or an array of typed blocks) into
/// the blocks a reader sees. Synthetic user text (slash-command echoes, hook
/// caveats — see `looks_synthetic`) is dropped; so are tool results, thinking,
/// and images, which are noise when you're reading the conversation back.
fn message_blocks(role: &str, content: &Value) -> Vec<TranscriptBlock> {
    let push_text = |blocks: &mut Vec<TranscriptBlock>, text: &str| {
        let text = text.trim();
        if text.is_empty() || (role == "user" && looks_synthetic(text)) {
            return;
        }
        blocks.push(TranscriptBlock::Text {
            text: text.to_string(),
        });
    };

    let mut blocks = Vec::new();
    match content {
        Value::String(s) => push_text(&mut blocks, s),
        Value::Array(items) => {
            for b in items {
                match b.get("type").and_then(Value::as_str) {
                    Some("text") => {
                        if let Some(t) = b.get("text").and_then(Value::as_str) {
                            push_text(&mut blocks, t);
                        }
                    }
                    Some("tool_use") if role == "assistant" => {
                        let name = b
                            .get("name")
                            .and_then(Value::as_str)
                            .unwrap_or("tool")
                            .to_string();
                        let detail = b
                            .get("input")
                            .map(|i| summarize_tool_input(&name, i))
                            .unwrap_or_default();
                        blocks.push(TranscriptBlock::Tool { name, detail });
                    }
                    // tool_result / thinking / image: intentionally dropped.
                    _ => {}
                }
            }
        }
        _ => {}
    }
    blocks
}

/// Parses a full session transcript into ordered user/assistant turns for the
/// reader. Same local `.jsonl` files `list_sessions` reads; malformed or
/// non-message lines are skipped rather than failing the whole read.
pub fn read_transcript(
    root: &Path,
    project_dir: &str,
    session_id: &str,
) -> Result<Vec<TranscriptTurn>, String> {
    if !valid_session_id(session_id) {
        return Err(format!("Invalid session id: {session_id}"));
    }
    let path = root
        .join(encode_project_dir(project_dir))
        .join(format!("{session_id}.jsonl"));
    let file = fs::File::open(&path).map_err(|e| e.to_string())?;
    let reader = BufReader::new(file);

    let mut turns = Vec::new();
    for line in reader.lines() {
        if turns.len() >= TRANSCRIPT_MAX_TURNS {
            break;
        }
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let Ok(entry) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let role = match entry.get("type").and_then(Value::as_str) {
            Some("user") => "user",
            Some("assistant") => "assistant",
            _ => continue,
        };
        let Some(content) = entry.get("message").and_then(|m| m.get("content")) else {
            continue;
        };
        let blocks = message_blocks(role, content);
        if blocks.is_empty() {
            continue;
        }
        turns.push(TranscriptTurn {
            role: role.to_string(),
            timestamp: entry
                .get("timestamp")
                .and_then(Value::as_str)
                .map(str::to_string),
            blocks,
        });
    }
    Ok(turns)
}

/// One session whose transcript contains the query.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptHit {
    pub session_id: String,
    /// The directory Claude was started in — recovered, not guessed, so the hit
    /// can be resumed and read through the same commands as any other session.
    pub project_dir: String,
    pub snippet: String,
    /// "user" or "assistant" — which side of the conversation matched.
    pub role: String,
    pub match_count: usize,
    pub last_used_iso: String,
}

/// Case-insensitive search over a char slice. Used only to place a snippet
/// around a hit we already know is there, so the quadratic shape is bounded by
/// one message; the cheap `contains` below does the filtering.
fn find_ci(hay: &[char], needle: &[char]) -> Option<usize> {
    if needle.is_empty() || needle.len() > hay.len() {
        return None;
    }
    (0..=hay.len() - needle.len()).find(|&i| {
        hay[i..i + needle.len()]
            .iter()
            .zip(needle)
            .all(|(a, b)| a.to_lowercase().eq(b.to_lowercase()))
    })
}

/// A window of text around the match. Indexes by `char`, never by byte — a
/// transcript is full of non-ASCII and byte slicing panics mid-codepoint.
fn snippet_around(text: &str, needle: &str) -> String {
    let flat: Vec<char> = text.split_whitespace().collect::<Vec<_>>().join(" ").chars().collect();
    let needle_chars: Vec<char> = needle.chars().collect();
    let Some(at) = find_ci(&flat, &needle_chars) else {
        return flat.iter().take(SNIPPET_MAX_CHARS).collect();
    };
    // Budget the window so the whole snippet honours SNIPPET_MAX_CHARS, rather
    // than the match sitting between two full-size halves.
    let half = SNIPPET_MAX_CHARS.saturating_sub(needle_chars.len()) / 2;
    let start = at.saturating_sub(half);
    let end = (at + needle_chars.len() + half).min(flat.len());
    let mut out = String::new();
    if start > 0 {
        out.push('…');
    }
    out.extend(&flat[start..end]);
    if end < flat.len() {
        out.push('…');
    }
    out
}

/// The real directory behind one of Claude Code's encoded folder names.
///
/// The encoding maps `/`, `\` and `:` all to `-`, so it cannot be inverted —
/// but a transcript records the `cwd` it ran in, and the folder is always that
/// path or one of its ancestors. Walking up until the encodings agree recovers
/// it exactly. Uses `Path::parent` rather than splitting on a separator, so it
/// works the same on Windows, and compares case-insensitively because both
/// Windows and macOS hand back paths whose case may not match what was encoded.
fn recover_project_dir(folder: &str, cwd: &str) -> Option<String> {
    let mut candidate = cwd;
    loop {
        // Full Unicode case folding, not `eq_ignore_ascii_case`: project folders
        // are named by people, and a Cyrillic or accented one would fold to
        // itself under the ASCII version and silently never match. A false
        // positive here is implausible (we are comparing a path against the
        // folder Claude derived from that same path); a false negative means the
        // hit is dropped on the floor.
        if encode_project_dir(candidate).to_lowercase() == folder.to_lowercase() {
            return Some(candidate.to_string());
        }
        // Trim one segment on either separator. Deliberately not `Path::parent`:
        // that is host-aware, and on Unix it does not treat '\' as a separator
        // at all, so a transcript recorded on Windows would be one opaque
        // component and never resolve. Transcripts travel between machines, so
        // the parsing must not depend on which machine is reading.
        let cut = candidate.rfind(['/', '\\'])?;
        if cut == 0 {
            return None;
        }
        candidate = &candidate[..cut];
    }
}

/// Searches every transcript under `root` for `query`, newest session first.
///
/// A plain streaming scan, no index: the whole corpus is a couple of hundred
/// megabytes and reads in well under a second, and an index would need
/// invalidating on every turn Claude writes. Revisit if that stops being true.
pub fn search_transcripts(root: &Path, query: &str, limit: usize) -> Vec<TranscriptHit> {
    let needle = query.trim().to_lowercase();
    if needle.len() < 2 {
        return Vec::new();
    }
    let Ok(folders) = fs::read_dir(root) else {
        return Vec::new();
    };

    let mut hits: Vec<TranscriptHit> = Vec::new();
    for folder in folders.flatten().filter(|f| f.path().is_dir()) {
        let folder_name = folder.file_name().to_string_lossy().into_owned();
        let Ok(files) = fs::read_dir(folder.path()) else { continue };
        for file in files.flatten() {
            let path = file.path();
            if path.extension().is_none_or(|ext| ext != "jsonl") {
                continue;
            }
            if let Some(hit) = search_one(&path, &folder_name, &needle) {
                hits.push(hit);
            }
        }
    }
    hits.sort_by(|a, b| b.last_used_iso.cmp(&a.last_used_iso));
    hits.truncate(limit);
    hits
}

/// The best hit in one transcript, plus how many more there were. Returns
/// `None` when the file holds no match at all.
fn search_one(path: &Path, folder: &str, needle: &str) -> Option<TranscriptHit> {
    let file = fs::File::open(path).ok()?;
    let reader = BufReader::new(file);

    let mut best: Option<(String, String)> = None; // (snippet, role)
    let mut matches = 0usize;
    let mut cwd: Option<String> = None;

    for line in reader.lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let Ok(record) = serde_json::from_str::<Value>(&line) else { continue };

        if cwd.is_none() {
            if let Some(found) = record.get("cwd").and_then(Value::as_str) {
                cwd = Some(found.to_string());
            }
        }

        let Some(message) = record.get("message") else { continue };
        let role = message.get("role").and_then(Value::as_str).unwrap_or("");
        if role != "user" && role != "assistant" {
            continue;
        }
        let Some(content) = message.get("content") else { continue };

        for text in text_blocks(content) {
            if looks_synthetic(text) {
                continue;
            }
            if !text.to_lowercase().contains(needle) {
                continue;
            }
            matches += 1;
            if best.is_none() {
                best = Some((snippet_around(text, needle), role.to_string()));
            }
            if matches >= MATCHES_PER_SESSION_CAP {
                break;
            }
        }
        if matches >= MATCHES_PER_SESSION_CAP {
            break;
        }
    }

    let (snippet, role) = best?;
    let session_id = path.file_stem()?.to_string_lossy().into_owned();
    let project_dir = recover_project_dir(folder, cwd.as_deref()?)?;
    let last_used_iso = fs::metadata(path).ok().and_then(|m| m.modified().ok()).map_or_else(
        || String::from("1970-01-01T00:00:00Z"),
        mtime_iso,
    );

    Some(TranscriptHit { session_id, project_dir, snippet, role, match_count: matches, last_used_iso })
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

    fn msg(role: &str, text: &str, cwd: &str) -> String {
        serde_json::json!({
            "type": role, "cwd": cwd,
            "message": { "role": role, "content": text }
        })
        .to_string()
    }

    #[test]
    fn recovers_a_unix_project_dir_from_a_nested_cwd() {
        // The folder is the directory Claude started in; cwd may be deeper.
        let got = recover_project_dir("-home-x-proj", "/home/x/proj/src/deep");
        assert_eq!(got.as_deref(), Some("/home/x/proj"));
    }

    #[test]
    fn recovers_a_windows_project_dir() {
        // Guards the one place this could quietly become POSIX-only: recovery
        // walks with Path::parent rather than splitting on a separator.
        let got = recover_project_dir(r"C--Users-x-proj", r"C:\Users\x\proj\src");
        assert_eq!(got.as_deref(), Some(r"C:\Users\x\proj"));
    }

    #[test]
    fn recovers_a_project_dir_whose_case_drifted() {
        // Windows and macOS both hand back paths whose case needn't match.
        let got = recover_project_dir("-home-X-Proj", "/home/x/proj/sub");
        assert_eq!(got.as_deref(), Some("/home/x/proj"));
    }

    #[test]
    fn recovers_a_project_dir_named_in_cyrillic() {
        // ASCII-only case folding would drop this one on the floor.
        let got = recover_project_dir("-home-x-Проект", "/home/x/проект/src");
        assert_eq!(got.as_deref(), Some("/home/x/проект"));
    }

    #[test]
    fn gives_up_rather_than_guessing_when_nothing_matches() {
        assert_eq!(recover_project_dir("-home-other", "/home/x/proj"), None);
    }

    #[test]
    fn snippets_centre_on_the_match_without_splitting_a_codepoint() {
        // Byte slicing here would panic outright on Cyrillic.
        let text = format!("{} ошибка 429 в логах {}", "п".repeat(300), "х".repeat(300));
        let snip = snippet_around(&text, "429");
        assert!(snip.contains("429"), "snippet lost the match: {snip}");
        assert!(snip.starts_with('…') && snip.ends_with('…'));
        assert!(snip.chars().count() <= SNIPPET_MAX_CHARS + 2);
    }

    #[test]
    fn short_text_keeps_both_ends() {
        let snip = snippet_around("rate limit exceeded", "limit");
        assert_eq!(snip, "rate limit exceeded");
    }

    #[test]
    fn finds_a_match_anywhere_in_the_transcript_not_just_the_preview() {
        let tmp = tempfile::tempdir().unwrap();
        write_session(
            tmp.path(),
            "/home/x/proj",
            "sess-1",
            &[
                &msg("user", "hello there", "/home/x/proj"),
                &msg("assistant", "nothing yet", "/home/x/proj"),
                &msg("user", "why do we keep getting 429 responses", "/home/x/proj"),
            ],
        );
        let hits = search_transcripts(tmp.path(), "429", 10);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].session_id, "sess-1");
        assert_eq!(hits[0].project_dir, "/home/x/proj");
        assert_eq!(hits[0].role, "user");
        assert!(hits[0].snippet.contains("429"));
    }

    #[test]
    fn counts_every_match_and_ignores_synthetic_turns() {
        let tmp = tempfile::tempdir().unwrap();
        write_session(
            tmp.path(),
            "/home/x/proj",
            "sess-1",
            &[
                &msg("user", "<command-name>429</command-name>", "/home/x/proj"),
                &msg("user", "a 429 here", "/home/x/proj"),
                &msg("assistant", "and a 429 there", "/home/x/proj"),
            ],
        );
        let hits = search_transcripts(tmp.path(), "429", 10);
        // The synthetic wrapper is not something the human wrote, so it neither
        // counts nor becomes the snippet.
        assert_eq!(hits[0].match_count, 2);
        assert_eq!(hits[0].role, "user");
        assert!(hits[0].snippet.starts_with("a 429"));
    }

    #[test]
    fn matches_case_insensitively_and_ignores_a_one_character_query() {
        let tmp = tempfile::tempdir().unwrap();
        write_session(
            tmp.path(),
            "/home/x/proj",
            "sess-1",
            &[&msg("user", "Rate Limit trouble", "/home/x/proj")],
        );
        assert_eq!(search_transcripts(tmp.path(), "rate limit", 10).len(), 1);
        assert_eq!(search_transcripts(tmp.path(), "RATE", 10).len(), 1);
        // One character would match nearly everything; not worth a full scan.
        assert!(search_transcripts(tmp.path(), "r", 10).is_empty());
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

    #[test]
    fn read_transcript_parses_turns_and_tool_chips() {
        let tmp = tempfile::tempdir().unwrap();
        write_session(
            tmp.path(),
            "/p",
            "conv",
            &[
                r#"{"type":"user","message":{"content":"fix the bug"},"timestamp":"2026-07-11T14:22:00Z"}"#,
                r#"{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"hmm"},{"type":"text","text":"On it."},{"type":"tool_use","name":"Read","input":{"file_path":"src/pty.rs"}}]}}"#,
                r#"{"type":"user","message":{"content":[{"type":"tool_result","is_error":false,"content":"ok"}]}}"#,
                r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Done."}]}}"#,
            ],
        );

        let turns = read_transcript(tmp.path(), "/p", "conv").unwrap();
        // user typed → assistant(text+tool) → tool_result-only user (dropped) → assistant text.
        assert_eq!(turns.len(), 3);
        assert_eq!(turns[0].role, "user");
        assert_eq!(turns[0].timestamp.as_deref(), Some("2026-07-11T14:22:00Z"));
        assert_eq!(turns[0].blocks, vec![TranscriptBlock::Text { text: "fix the bug".into() }]);

        // thinking is dropped; text kept; tool_use becomes a chip with its file path.
        assert_eq!(
            turns[1].blocks,
            vec![
                TranscriptBlock::Text { text: "On it.".into() },
                TranscriptBlock::Tool { name: "Read".into(), detail: "src/pty.rs".into() },
            ],
        );
        assert_eq!(turns[2].blocks, vec![TranscriptBlock::Text { text: "Done.".into() }]);
    }

    #[test]
    fn read_transcript_skips_synthetic_user_text_and_bad_lines() {
        let tmp = tempfile::tempdir().unwrap();
        write_session(
            tmp.path(),
            "/p",
            "noise",
            &[
                "not json",
                r#"{"type":"summary","summary":"ignored"}"#,
                r#"{"type":"user","message":{"content":"<command-name>/foo</command-name>"}}"#,
                r#"{"type":"user","message":{"content":"real question"}}"#,
            ],
        );

        let turns = read_transcript(tmp.path(), "/p", "noise").unwrap();
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].blocks, vec![TranscriptBlock::Text { text: "real question".into() }]);
    }

    #[test]
    fn read_transcript_validates_id_and_reports_missing_file() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(read_transcript(tmp.path(), "/p", "../evil").is_err());
        assert!(read_transcript(tmp.path(), "/p", "does-not-exist").is_err());
    }

    #[test]
    fn summarizes_command_and_falls_back() {
        let bash = serde_json::json!({"command": "taskkill /T /F", "description": "kill"});
        assert_eq!(summarize_tool_input("Bash", &bash), "taskkill /T /F");
        let unknown = serde_json::json!({"path": "/x"});
        assert_eq!(summarize_tool_input("Mystery", &unknown), "/x");
        let empty = serde_json::json!({"todos": []});
        assert_eq!(summarize_tool_input("TodoWrite", &empty), "");
    }

    #[test]
    fn keeps_line_breaks_in_multiline_commands() {
        // A real multi-line PowerShell command keeps its lines (intra-line
        // whitespace collapsed, blank lines dropped) so it reads like code.
        let ps = serde_json::json!({
            "command": "$s = \"C:\\path\\cvlv.js\"\n\nSet-Location   \"C:\\Temp\"\nnode $s list"
        });
        assert_eq!(
            summarize_tool_input("PowerShell", &ps),
            "$s = \"C:\\path\\cvlv.js\"\nSet-Location \"C:\\Temp\"\nnode $s list"
        );
    }

    #[test]
    fn finds_a_newly_created_session_not_in_the_snapshot() {
        let tmp = tempfile::tempdir().unwrap();
        write_session(tmp.path(), "/p", "old", &[r#"{"type":"user","message":{"content":"x"}}"#]);
        let existing = existing_session_ids(tmp.path(), "/p");
        assert_eq!(existing.len(), 1);

        let after = SystemTime::now();
        std::thread::sleep(std::time::Duration::from_millis(10));
        write_session(tmp.path(), "/p", "new", &[r#"{"type":"user","message":{"content":"y"}}"#]);

        assert_eq!(find_new_session(tmp.path(), "/p", &existing, after), Some("new".to_string()));
    }

    #[test]
    fn ignores_files_older_than_after_or_already_known() {
        let tmp = tempfile::tempdir().unwrap();
        write_session(tmp.path(), "/p", "old", &[r#"{"type":"user","message":{"content":"x"}}"#]);
        let existing = existing_session_ids(tmp.path(), "/p");

        // Same file exists but is already in the snapshot — must be ignored.
        assert_eq!(find_new_session(tmp.path(), "/p", &existing, SystemTime::UNIX_EPOCH), None);

        // A file older than `after` (in the future) must be ignored too.
        let far_future = SystemTime::now() + std::time::Duration::from_secs(3600);
        assert_eq!(find_new_session(tmp.path(), "/p", &HashSet::new(), far_future), None);
    }
}
