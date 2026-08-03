use std::collections::HashSet;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::time::SystemTime;

use chrono::{DateTime, Duration, Utc};
use serde::Serialize;
use serde_json::Value;

/// Anthropic doesn't publish an API for this, so the whole module is a local
/// estimate: real 5-hour session blocks reconstructed from your own transcript
/// timestamps (same rolling-window scheme Claude's own rate limiting uses),
/// with the ceiling calibrated from the biggest block you've actually hit
/// rather than a hardcoded plan number (which changes over time and isn't the
/// same for everyone). Read-only, offline, no credentials — same principle as
/// `usage.rs`.
const BLOCK_DURATION: Duration = Duration::hours(5);
/// How far back to look for block history. Bounds the scan; recent history is
/// also the most relevant one for calibration (limits can change over time).
const SCAN_DAYS: i64 = 30;
/// Below this many completed blocks, a percentile is just noise — use the
/// plain max instead.
const MIN_BLOCKS_FOR_PERCENTILE: usize = 5;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionUsageStats {
    /// False only when there's no transcript history at all to estimate from.
    pub available: bool,
    /// Tokens used in the current 5-hour block; 0 when idle (no active block).
    pub tokens_used: u64,
    /// RFC3339 UTC start of the current block, if one is active.
    pub block_start_iso: Option<String>,
    /// RFC3339 UTC time the current block resets, if one is active.
    pub block_end_iso: Option<String>,
    /// The biggest completed block on record — an estimate of your typical
    /// ceiling, not an official Anthropic limit. None until at least one
    /// block has fully closed.
    pub estimated_limit_tokens: Option<u64>,
    /// How many completed blocks the estimate is based on, so the UI can
    /// show "still calibrating" on a fresh install.
    pub blocks_seen: usize,
}

fn u64_field(usage: &Value, key: &str) -> u64 {
    usage.get(key).and_then(Value::as_u64).unwrap_or(0)
}

/// One assistant turn's timestamp and "fresh" token cost (input + output +
/// cache-write — cache reads are excluded, same definition `usage.rs` uses).
fn parse_line(line: &str, seen: &mut HashSet<String>) -> Option<(DateTime<Utc>, u64)> {
    let entry: Value = serde_json::from_str(line).ok()?;
    if entry.get("type").and_then(Value::as_str) != Some("assistant") {
        return None;
    }
    let message = entry.get("message")?;
    let usage = message.get("usage")?;
    let timestamp = entry.get("timestamp").and_then(Value::as_str)?;
    let dt = DateTime::parse_from_rfc3339(timestamp).ok()?.with_timezone(&Utc);

    let dedupe_key = message
        .get("id")
        .and_then(Value::as_str)
        .or_else(|| entry.get("requestId").and_then(Value::as_str));
    if let Some(key) = dedupe_key {
        if !seen.insert(key.to_string()) {
            return None;
        }
    }

    let fresh = u64_field(usage, "input_tokens")
        + u64_field(usage, "output_tokens")
        + u64_field(usage, "cache_creation_input_tokens");
    Some((dt, fresh))
}

/// Walks every transcript modified within `SCAN_DAYS`, returning (timestamp,
/// tokens) for each assistant turn. A file untouched in that window can't
/// contain anything newer than that, so it's skipped without opening it.
fn collect_entries(root: &Path, cutoff: SystemTime) -> Vec<(DateTime<Utc>, u64)> {
    let mut entries = Vec::new();
    let mut seen = HashSet::new();
    let Ok(project_dirs) = fs::read_dir(root) else { return entries };

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
            let recent = file
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .is_some_and(|mtime| mtime >= cutoff);
            if !recent {
                continue;
            }
            let Ok(f) = fs::File::open(&path) else { continue };
            for line in BufReader::new(f).lines() {
                let Ok(line) = line else { break };
                if line.is_empty() {
                    continue;
                }
                if let Some(parsed) = parse_line(&line, &mut seen) {
                    entries.push(parsed);
                }
            }
        }
    }
    entries
}

struct Block {
    start: DateTime<Utc>,
    end: DateTime<Utc>,
    tokens: u64,
}

/// Groups timestamped entries into rolling 5-hour blocks: a block starts at
/// its first entry and absorbs everything until 5 hours pass, at which point
/// the next entry starts a new block. This is the same reconstruction
/// community usage-monitor tools use, since Anthropic doesn't publish the
/// exact boundary algorithm.
fn build_blocks(mut entries: Vec<(DateTime<Utc>, u64)>) -> Vec<Block> {
    entries.sort_by_key(|(ts, _)| *ts);
    let mut blocks: Vec<Block> = Vec::new();
    for (ts, tokens) in entries {
        match blocks.last_mut() {
            Some(b) if ts < b.end => b.tokens += tokens,
            _ => blocks.push(Block { start: ts, end: ts + BLOCK_DURATION, tokens }),
        }
    }
    blocks
}

/// The biggest completed block, or (with enough history) the 90th percentile
/// of block sizes — robust to one freak session skewing the estimate.
fn estimate_limit(completed: &[Block]) -> Option<u64> {
    if completed.is_empty() {
        return None;
    }
    let mut totals: Vec<u64> = completed.iter().map(|b| b.tokens).collect();
    totals.sort_unstable();
    if totals.len() < MIN_BLOCKS_FOR_PERCENTILE {
        return totals.last().copied();
    }
    let idx = (((totals.len() as f64) * 0.9).ceil() as usize).clamp(1, totals.len()) - 1;
    Some(totals[idx])
}

pub fn session_usage_stats(root: &Path) -> SessionUsageStats {
    let now = Utc::now();
    let cutoff = SystemTime::now() - std::time::Duration::from_secs((SCAN_DAYS * 24 * 60 * 60) as u64);
    let entries = collect_entries(root, cutoff);
    if entries.is_empty() {
        return SessionUsageStats {
            available: false,
            tokens_used: 0,
            block_start_iso: None,
            block_end_iso: None,
            estimated_limit_tokens: None,
            blocks_seen: 0,
        };
    }

    let blocks = build_blocks(entries);
    let (completed, active) = match blocks.split_last() {
        Some((last, rest)) if now < last.end => (rest, Some(last)),
        _ => (blocks.as_slice(), None),
    };

    SessionUsageStats {
        available: true,
        tokens_used: active.map_or(0, |b| b.tokens),
        block_start_iso: active.map(|b| b.start.to_rfc3339()),
        block_end_iso: active.map(|b| b.end.to_rfc3339()),
        estimated_limit_tokens: estimate_limit(completed),
        blocks_seen: completed.len(),
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

    fn assistant_line(id: &str, iso: &str, input: u64, output: u64, cache_w: u64) -> String {
        format!(
            r#"{{"type":"assistant","timestamp":"{iso}","message":{{"id":"{id}","usage":{{"input_tokens":{input},"output_tokens":{output},"cache_creation_input_tokens":{cache_w}}}}}}}"#
        )
    }

    // --- build_blocks / estimate_limit: pure, no filesystem ---

    fn e(iso: &str, tokens: u64) -> (DateTime<Utc>, u64) {
        (DateTime::parse_from_rfc3339(iso).unwrap().with_timezone(&Utc), tokens)
    }

    #[test]
    fn accumulates_within_a_block_and_splits_after_five_hours() {
        let blocks = build_blocks(vec![
            e("2026-01-01T10:00:00Z", 100),
            e("2026-01-01T12:00:00Z", 50), // +2h, same block
            e("2026-01-01T15:30:00Z", 25), // +5.5h from start, new block
        ]);
        assert_eq!(blocks.len(), 2);
        assert_eq!(blocks[0].tokens, 150);
        assert_eq!(blocks[1].tokens, 25);
    }

    #[test]
    fn a_block_boundary_at_exactly_five_hours_starts_a_new_block() {
        let blocks = build_blocks(vec![
            e("2026-01-01T10:00:00Z", 100),
            e("2026-01-01T15:00:00Z", 100), // exactly +5h — block already ended
        ]);
        assert_eq!(blocks.len(), 2);
    }

    #[test]
    fn estimate_uses_max_under_five_blocks() {
        let blocks = build_blocks(vec![
            e("2026-01-01T00:00:00Z", 10),
            e("2026-01-02T00:00:00Z", 50),
            e("2026-01-03T00:00:00Z", 30),
        ]);
        assert_eq!(estimate_limit(&blocks), Some(50));
    }

    #[test]
    fn estimate_uses_p90_with_enough_blocks() {
        // Ten single-entry blocks, well over 5h apart, tokens 10..=100 by tens.
        let entries: Vec<_> = (1..=10)
            .map(|i| e(&format!("2026-01-{:02}T00:00:00Z", i), i * 10))
            .collect();
        let blocks = build_blocks(entries);
        assert_eq!(blocks.len(), 10);
        // 90th percentile of [10,20,...,100] (ceil(10*0.9)=9th, 1-indexed) = 90.
        assert_eq!(estimate_limit(&blocks), Some(90));
    }

    // --- session_usage_stats: full read path via tempfile ---

    #[test]
    fn reports_an_active_block_with_time_remaining() {
        let tmp = tempfile::tempdir().unwrap();
        let now = Utc::now();
        let started = (now - Duration::hours(1)).to_rfc3339();
        write_transcript(tmp.path(), "p1", "s1", &[assistant_line("m1", &started, 100, 50, 0)]);

        let stats = session_usage_stats(tmp.path());
        assert!(stats.available);
        assert_eq!(stats.tokens_used, 150);
        assert!(stats.block_start_iso.is_some());
        assert!(stats.block_end_iso.is_some());
    }

    #[test]
    fn reports_idle_once_the_last_block_has_expired() {
        let tmp = tempfile::tempdir().unwrap();
        let now = Utc::now();
        let stale = (now - Duration::hours(8)).to_rfc3339();
        write_transcript(tmp.path(), "p1", "s1", &[assistant_line("m1", &stale, 100, 0, 0)]);

        let stats = session_usage_stats(tmp.path());
        assert!(stats.available);
        assert_eq!(stats.tokens_used, 0);
        assert!(stats.block_start_iso.is_none());
        // That expired block is the only one on record, so it becomes the estimate.
        assert_eq!(stats.estimated_limit_tokens, Some(100));
        assert_eq!(stats.blocks_seen, 1);
    }

    #[test]
    fn dedupes_repeated_message_ids() {
        let tmp = tempfile::tempdir().unwrap();
        let now = Utc::now();
        let ts = (now - Duration::minutes(1)).to_rfc3339();
        let line = assistant_line("dup", &ts, 100, 0, 0);
        write_transcript(tmp.path(), "p1", "s1", &[line.clone(), line]);

        let stats = session_usage_stats(tmp.path());
        assert_eq!(stats.tokens_used, 100);
    }

    #[test]
    fn missing_root_reports_unavailable() {
        let tmp = tempfile::tempdir().unwrap();
        let stats = session_usage_stats(&tmp.path().join("nope"));
        assert!(!stats.available);
        assert_eq!(stats.blocks_seen, 0);
    }
}
