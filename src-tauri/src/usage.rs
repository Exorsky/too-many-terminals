use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::time::SystemTime;

use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageStats {
    /// False if there's nothing to report (e.g. brand-new install, no activity today).
    pub available: bool,
    /// ISO date (YYYY-MM-DD) the stats are for — always "today" in UTC.
    pub date: String,
    /// "Fresh" tokens: input + output + cache-write. Excludes cache reads,
    /// which are near-free re-reads of already-primed context.
    pub total_tokens: u64,
    pub by_model: HashMap<String, u64>,
    /// Cache-read tokens, tracked separately since they're billed at a small
    /// fraction of the input rate and aren't "new" consumption.
    pub cache_read_tokens: u64,
}

fn today_utc() -> String {
    chrono::Utc::now().format("%Y-%m-%d").to_string()
}

fn start_of_day_utc(today: &str) -> Option<SystemTime> {
    let date = chrono::NaiveDate::parse_from_str(today, "%Y-%m-%d").ok()?;
    let dt = date.and_hms_opt(0, 0, 0)?.and_utc();
    Some(SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(dt.timestamp().max(0) as u64))
}

fn u64_field(usage: &Value, key: &str) -> u64 {
    usage.get(key).and_then(Value::as_u64).unwrap_or(0)
}

#[derive(Default)]
struct ScanTotals {
    by_model: HashMap<String, u64>,
    cache_read_tokens: u64,
}

/// Scan one session transcript, adding today's token usage into totals.
/// Dedupes repeated log lines for the same API response (Claude Code can log
/// a turn more than once) using message.id / requestId.
fn scan_file(file_path: &Path, today: &str, seen: &mut HashSet<String>, totals: &mut ScanTotals) {
    let Ok(file) = fs::File::open(file_path) else { return };
    for line in BufReader::new(file).lines() {
        let Ok(line) = line else { break };
        if line.is_empty() {
            continue;
        }
        let Ok(entry) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if entry.get("type").and_then(Value::as_str) != Some("assistant") {
            continue;
        }
        let Some(message) = entry.get("message") else { continue };
        let Some(usage) = message.get("usage") else { continue };
        let same_day = entry
            .get("timestamp")
            .and_then(Value::as_str)
            .is_some_and(|ts| ts.get(..10) == Some(today));
        if !same_day {
            continue;
        }

        let dedupe_key = message
            .get("id")
            .and_then(Value::as_str)
            .or_else(|| entry.get("requestId").and_then(Value::as_str));
        if let Some(key) = dedupe_key {
            if !seen.insert(key.to_string()) {
                continue;
            }
        }

        // "Fresh" tokens for one turn: input + output + cache-write.
        let fresh = u64_field(usage, "input_tokens")
            + u64_field(usage, "output_tokens")
            + u64_field(usage, "cache_creation_input_tokens");
        let model = message
            .get("model")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        *totals.by_model.entry(model.to_string()).or_insert(0) += fresh;
        totals.cache_read_tokens += u64_field(usage, "cache_read_input_tokens");
    }
}

/// Sums today's token usage by scanning Claude Code's own session transcripts
/// under `root` (normally ~/.claude/projects) — the same local, real-time
/// logs the CLI writes as you work. Read-only, offline, no credentials.
///
/// Skips any file not modified today before opening it, so this stays cheap
/// even with months of transcript history on disk.
pub fn usage_stats(root: &Path) -> UsageStats {
    let today = today_utc();
    let mut totals = ScanTotals::default();
    let mut seen: HashSet<String> = HashSet::new();
    let start_of_today = start_of_day_utc(&today);

    let Ok(project_dirs) = fs::read_dir(root) else {
        return UsageStats {
            available: false,
            date: today,
            total_tokens: 0,
            by_model: HashMap::new(),
            cache_read_tokens: 0,
        };
    };

    for dir_entry in project_dirs.filter_map(|e| e.ok()) {
        if !dir_entry.file_type().is_ok_and(|t| t.is_dir()) {
            continue;
        }
        let Ok(files) = fs::read_dir(dir_entry.path()) else { continue };
        for file in files.filter_map(|e| e.ok()) {
            let path = file.path();
            if path.extension().is_none_or(|ext| ext != "jsonl") {
                continue;
            }
            let modified_today = file
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .zip(start_of_today)
                .is_some_and(|(mtime, start)| mtime >= start);
            if !modified_today {
                continue;
            }
            scan_file(&path, &today, &mut seen, &mut totals);
        }
    }

    let total_tokens = totals.by_model.values().sum();
    UsageStats {
        available: true,
        date: today,
        total_tokens,
        by_model: totals.by_model,
        cache_read_tokens: totals.cache_read_tokens,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_transcript(root: &Path, project: &str, name: &str, lines: &[String]) {
        let dir = root.join(project);
        fs::create_dir_all(&dir).unwrap();
        let mut f = fs::File::create(dir.join(format!("{name}.jsonl"))).unwrap();
        for line in lines {
            writeln!(f, "{line}").unwrap();
        }
    }

    fn assistant_line(id: &str, model: &str, input: u64, output: u64, cache_w: u64, cache_r: u64, date: &str) -> String {
        format!(
            r#"{{"type":"assistant","timestamp":"{date}T10:00:00.000Z","message":{{"id":"{id}","model":"{model}","usage":{{"input_tokens":{input},"output_tokens":{output},"cache_creation_input_tokens":{cache_w},"cache_read_input_tokens":{cache_r}}}}}}}"#
        )
    }

    #[test]
    fn sums_fresh_tokens_per_model_and_cache_reads() {
        let tmp = tempfile::tempdir().unwrap();
        let today = today_utc();
        write_transcript(
            tmp.path(),
            "p1",
            "s1",
            &[
                assistant_line("m1", "claude-sonnet-5", 100, 50, 25, 1000, &today),
                assistant_line("m2", "claude-haiku-4-5", 10, 5, 0, 0, &today),
                r#"{"type":"user","message":{"content":"hi"}}"#.to_string(),
            ],
        );

        let stats = usage_stats(tmp.path());
        assert!(stats.available);
        assert_eq!(stats.by_model["claude-sonnet-5"], 175);
        assert_eq!(stats.by_model["claude-haiku-4-5"], 15);
        assert_eq!(stats.total_tokens, 190);
        assert_eq!(stats.cache_read_tokens, 1000);
    }

    #[test]
    fn dedupes_by_message_id_across_files() {
        let tmp = tempfile::tempdir().unwrap();
        let today = today_utc();
        let line = assistant_line("dup", "claude-sonnet-5", 100, 0, 0, 0, &today);
        write_transcript(tmp.path(), "p1", "s1", &[line.clone(), line.clone()]);
        write_transcript(tmp.path(), "p2", "s2", &[line]);

        let stats = usage_stats(tmp.path());
        assert_eq!(stats.total_tokens, 100);
    }

    #[test]
    fn ignores_entries_from_other_days() {
        let tmp = tempfile::tempdir().unwrap();
        write_transcript(
            tmp.path(),
            "p1",
            "s1",
            &[assistant_line("old", "claude-sonnet-5", 999, 0, 0, 0, "2020-01-01")],
        );

        let stats = usage_stats(tmp.path());
        assert!(stats.available);
        assert_eq!(stats.total_tokens, 0);
    }

    #[test]
    fn missing_root_reports_unavailable() {
        let tmp = tempfile::tempdir().unwrap();
        let stats = usage_stats(&tmp.path().join("nope"));
        assert!(!stats.available);
        assert_eq!(stats.total_tokens, 0);
    }

    #[test]
    fn tolerates_bad_json_lines() {
        let tmp = tempfile::tempdir().unwrap();
        let today = today_utc();
        write_transcript(
            tmp.path(),
            "p1",
            "s1",
            &[
                "garbage not json".to_string(),
                assistant_line("ok", "claude-sonnet-5", 7, 3, 0, 0, &today),
            ],
        );

        let stats = usage_stats(tmp.path());
        assert_eq!(stats.total_tokens, 10);
    }
}
