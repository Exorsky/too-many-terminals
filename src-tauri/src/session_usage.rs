use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::time::SystemTime;

use chrono::{DateTime, Duration, Utc};
use serde::Serialize;
use serde_json::Value;

/// Anthropic doesn't publish an API for this, so the whole module is a local
/// estimate: real rolling-window usage blocks (5-hour session, 7-day week)
/// reconstructed from your own transcript timestamps — the same rolling
/// windows Claude's own rate limiting uses — with each window's ceiling
/// calibrated from the biggest block you've actually hit rather than a
/// hardcoded plan number (which changes over time and isn't the same for
/// everyone). Read-only, offline, no credentials.
const SESSION_DURATION: Duration = Duration::hours(5);
const WEEK_DURATION: Duration = Duration::days(7);
/// How far back to look for block history. Bounds the scan; needs to be well
/// past a week so the 7-day window has enough completed blocks to calibrate
/// from (5 blocks × 7 days = 35 days minimum for a percentile estimate).
const SCAN_DAYS: i64 = 90;
/// Below this many completed blocks, a percentile is just noise — use the
/// plain max instead.
const MIN_BLOCKS_FOR_PERCENTILE: usize = 5;

/// One rolling-window's usage: how much of it you've used, when it resets,
/// and an estimated ceiling calibrated from your own history.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    /// Tokens used in the current block; 0 when idle (no active block).
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

impl UsageWindow {
    fn empty() -> Self {
        Self { tokens_used: 0, block_start_iso: None, block_end_iso: None, estimated_limit_tokens: None, blocks_seen: 0 }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionUsageStats {
    /// False only when there's no transcript history at all to estimate from.
    pub available: bool,
    /// The 5-hour rolling session window.
    pub session: UsageWindow,
    /// The 7-day rolling week window.
    pub week: UsageWindow,
    /// Fresh tokens by model, scoped to the current week's active block (not
    /// all-time) — empty if the week window is idle.
    pub by_model: HashMap<String, u64>,
    /// Cache-read tokens for the current week's active block.
    pub cache_read_tokens: u64,
}

fn u64_field(usage: &Value, key: &str) -> u64 {
    usage.get(key).and_then(Value::as_u64).unwrap_or(0)
}

/// One assistant turn, reduced to what the windows above need.
struct Turn {
    ts: DateTime<Utc>,
    fresh_tokens: u64,
    cache_read_tokens: u64,
    model: String,
}

fn parse_line(line: &str, seen: &mut HashSet<String>) -> Option<Turn> {
    let entry: Value = serde_json::from_str(line).ok()?;
    if entry.get("type").and_then(Value::as_str) != Some("assistant") {
        return None;
    }
    let message = entry.get("message")?;
    let usage = message.get("usage")?;
    let timestamp = entry.get("timestamp").and_then(Value::as_str)?;
    let ts = DateTime::parse_from_rfc3339(timestamp).ok()?.with_timezone(&Utc);

    let dedupe_key = message
        .get("id")
        .and_then(Value::as_str)
        .or_else(|| entry.get("requestId").and_then(Value::as_str));
    if let Some(key) = dedupe_key {
        if !seen.insert(key.to_string()) {
            return None;
        }
    }

    let fresh_tokens = u64_field(usage, "input_tokens")
        + u64_field(usage, "output_tokens")
        + u64_field(usage, "cache_creation_input_tokens");
    let model = message.get("model").and_then(Value::as_str).unwrap_or("unknown").to_string();
    Some(Turn { ts, fresh_tokens, cache_read_tokens: u64_field(usage, "cache_read_input_tokens"), model })
}

/// Walks every transcript modified within `SCAN_DAYS`, returning every
/// assistant turn. A file untouched in that window can't contain anything
/// newer than that, so it's skipped without opening it.
fn collect_turns(root: &Path, cutoff: SystemTime) -> Vec<Turn> {
    let mut turns = Vec::new();
    let mut seen = HashSet::new();
    let Ok(project_dirs) = fs::read_dir(root) else { return turns };

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
                if let Some(turn) = parse_line(&line, &mut seen) {
                    turns.push(turn);
                }
            }
        }
    }
    turns
}

struct Block {
    start: DateTime<Utc>,
    end: DateTime<Utc>,
    tokens: u64,
}

/// Groups timestamped entries into rolling windows of `duration`: a block
/// starts at its first entry and absorbs everything until `duration` passes,
/// at which point the next entry starts a new block. This is the same
/// reconstruction community usage-monitor tools use, since Anthropic doesn't
/// publish the exact boundary algorithm.
fn build_blocks(mut entries: Vec<(DateTime<Utc>, u64)>, duration: Duration) -> Vec<Block> {
    entries.sort_by_key(|(ts, _)| *ts);
    let mut blocks: Vec<Block> = Vec::new();
    for (ts, tokens) in entries {
        match blocks.last_mut() {
            Some(b) if ts < b.end => b.tokens += tokens,
            _ => blocks.push(Block { start: ts, end: ts + duration, tokens }),
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

/// A computed window plus the active block's raw time range (if any), so the
/// caller can scope other data (like the per-model breakdown) to it without
/// round-tripping through the window's own ISO strings.
struct WindowResult {
    window: UsageWindow,
    active_range: Option<(DateTime<Utc>, DateTime<Utc>)>,
}

fn compute_window(entries: Vec<(DateTime<Utc>, u64)>, now: DateTime<Utc>, duration: Duration) -> WindowResult {
    let blocks = build_blocks(entries, duration);
    let (completed, active): (&[Block], Option<&Block>) = match blocks.split_last() {
        Some((last, rest)) if now < last.end => (rest, Some(last)),
        _ => (blocks.as_slice(), None),
    };
    WindowResult {
        window: UsageWindow {
            tokens_used: active.map_or(0, |b| b.tokens),
            block_start_iso: active.map(|b| b.start.to_rfc3339()),
            block_end_iso: active.map(|b| b.end.to_rfc3339()),
            estimated_limit_tokens: estimate_limit(completed),
            blocks_seen: completed.len(),
        },
        active_range: active.map(|b| (b.start, b.end)),
    }
}

pub fn session_usage_stats(root: &Path) -> SessionUsageStats {
    let now = Utc::now();
    let cutoff = SystemTime::now() - std::time::Duration::from_secs((SCAN_DAYS * 24 * 60 * 60) as u64);
    let turns = collect_turns(root, cutoff);
    if turns.is_empty() {
        return SessionUsageStats {
            available: false,
            session: UsageWindow::empty(),
            week: UsageWindow::empty(),
            by_model: HashMap::new(),
            cache_read_tokens: 0,
        };
    }

    let entries: Vec<(DateTime<Utc>, u64)> = turns.iter().map(|t| (t.ts, t.fresh_tokens)).collect();
    let session_result = compute_window(entries.clone(), now, SESSION_DURATION);
    let week_result = compute_window(entries, now, WEEK_DURATION);

    let mut by_model: HashMap<String, u64> = HashMap::new();
    let mut cache_read_tokens = 0u64;
    if let Some((start, end)) = week_result.active_range {
        for turn in &turns {
            if turn.ts >= start && turn.ts < end {
                *by_model.entry(turn.model.clone()).or_insert(0) += turn.fresh_tokens;
                cache_read_tokens += turn.cache_read_tokens;
            }
        }
    }

    SessionUsageStats {
        available: true,
        session: session_result.window,
        week: week_result.window,
        by_model,
        cache_read_tokens,
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

    fn assistant_line(id: &str, iso: &str, model: &str, input: u64, output: u64, cache_w: u64, cache_r: u64) -> String {
        format!(
            r#"{{"type":"assistant","timestamp":"{iso}","message":{{"id":"{id}","model":"{model}","usage":{{"input_tokens":{input},"output_tokens":{output},"cache_creation_input_tokens":{cache_w},"cache_read_input_tokens":{cache_r}}}}}}}"#
        )
    }

    // --- build_blocks / estimate_limit: pure, no filesystem ---

    fn e(iso: &str, tokens: u64) -> (DateTime<Utc>, u64) {
        (DateTime::parse_from_rfc3339(iso).unwrap().with_timezone(&Utc), tokens)
    }

    #[test]
    fn accumulates_within_a_block_and_splits_after_the_duration() {
        let blocks = build_blocks(
            vec![
                e("2026-01-01T10:00:00Z", 100),
                e("2026-01-01T12:00:00Z", 50), // +2h, same block
                e("2026-01-01T15:30:00Z", 25), // +5.5h from start, new block
            ],
            Duration::hours(5),
        );
        assert_eq!(blocks.len(), 2);
        assert_eq!(blocks[0].tokens, 150);
        assert_eq!(blocks[1].tokens, 25);
    }

    #[test]
    fn a_block_boundary_at_exactly_the_duration_starts_a_new_block() {
        let blocks = build_blocks(
            vec![e("2026-01-01T10:00:00Z", 100), e("2026-01-01T15:00:00Z", 100)], // exactly +5h
            Duration::hours(5),
        );
        assert_eq!(blocks.len(), 2);
    }

    #[test]
    fn a_seven_day_block_absorbs_activity_across_the_whole_week() {
        let blocks = build_blocks(
            vec![e("2026-01-01T00:00:00Z", 100), e("2026-01-06T00:00:00Z", 50)], // +5 days, same week block
            Duration::days(7),
        );
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].tokens, 150);
    }

    #[test]
    fn estimate_uses_max_under_five_blocks() {
        let blocks = build_blocks(
            vec![e("2026-01-01T00:00:00Z", 10), e("2026-01-02T00:00:00Z", 50), e("2026-01-03T00:00:00Z", 30)],
            Duration::hours(5),
        );
        assert_eq!(estimate_limit(&blocks), Some(50));
    }

    #[test]
    fn estimate_uses_p90_with_enough_blocks() {
        let entries: Vec<_> = (1..=10).map(|i| e(&format!("2026-01-{:02}T00:00:00Z", i), i * 10)).collect();
        let blocks = build_blocks(entries, Duration::hours(5));
        assert_eq!(blocks.len(), 10);
        // 90th percentile of [10,20,...,100] (ceil(10*0.9)=9th, 1-indexed) = 90.
        assert_eq!(estimate_limit(&blocks), Some(90));
    }

    // --- session_usage_stats: full read path via tempfile ---

    #[test]
    fn reports_an_active_session_and_week_with_time_remaining() {
        let tmp = tempfile::tempdir().unwrap();
        let now = Utc::now();
        let started = (now - Duration::hours(1)).to_rfc3339();
        write_transcript(tmp.path(), "p1", "s1", &[assistant_line("m1", &started, "claude-sonnet-5", 100, 50, 0, 0)]);

        let stats = session_usage_stats(tmp.path());
        assert!(stats.available);
        assert_eq!(stats.session.tokens_used, 150);
        assert!(stats.session.block_end_iso.is_some());
        assert_eq!(stats.week.tokens_used, 150);
        assert!(stats.week.block_end_iso.is_some());
        assert_eq!(stats.by_model["claude-sonnet-5"], 150);
    }

    #[test]
    fn session_idles_out_after_five_hours_but_the_week_keeps_going() {
        let tmp = tempfile::tempdir().unwrap();
        let now = Utc::now();
        let ts = (now - Duration::hours(8)).to_rfc3339(); // past session window, well within the week
        write_transcript(tmp.path(), "p1", "s1", &[assistant_line("m1", &ts, "claude-sonnet-5", 100, 0, 0, 0)]);

        let stats = session_usage_stats(tmp.path());
        assert_eq!(stats.session.tokens_used, 0);
        assert!(stats.session.block_end_iso.is_none());
        // That expired session block is the only one on record, so it becomes the estimate.
        assert_eq!(stats.session.estimated_limit_tokens, Some(100));
        assert_eq!(stats.week.tokens_used, 100);
        assert!(stats.week.block_end_iso.is_some());
    }

    #[test]
    fn breakdown_is_scoped_to_the_active_week_block_only() {
        let tmp = tempfile::tempdir().unwrap();
        let now = Utc::now();
        let old = (now - Duration::days(30)).to_rfc3339(); // a past, closed week block
        let recent = (now - Duration::hours(1)).to_rfc3339(); // the active week block
        write_transcript(
            tmp.path(),
            "p1",
            "s1",
            &[
                assistant_line("old", &old, "claude-haiku-4-5", 999, 0, 0, 0),
                assistant_line("new", &recent, "claude-sonnet-5", 100, 0, 0, 500),
            ],
        );

        let stats = session_usage_stats(tmp.path());
        assert_eq!(stats.by_model.len(), 1);
        assert_eq!(stats.by_model["claude-sonnet-5"], 100);
        assert_eq!(stats.cache_read_tokens, 500);
    }

    #[test]
    fn dedupes_repeated_message_ids() {
        let tmp = tempfile::tempdir().unwrap();
        let now = Utc::now();
        let ts = (now - Duration::minutes(1)).to_rfc3339();
        let line = assistant_line("dup", &ts, "claude-sonnet-5", 100, 0, 0, 0);
        write_transcript(tmp.path(), "p1", "s1", &[line.clone(), line]);

        let stats = session_usage_stats(tmp.path());
        assert_eq!(stats.session.tokens_used, 100);
    }

    #[test]
    fn missing_root_reports_unavailable() {
        let tmp = tempfile::tempdir().unwrap();
        let stats = session_usage_stats(&tmp.path().join("nope"));
        assert!(!stats.available);
        assert_eq!(stats.session.blocks_seen, 0);
        assert_eq!(stats.week.blocks_seen, 0);
        assert!(stats.by_model.is_empty());
    }
}
