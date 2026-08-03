use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;

// The official 5-hour / 7-day rate-limit numbers, from the same endpoint
// Claude Code's own `/usage` uses (`fetchUtilization: GET /api/oauth/usage`),
// authenticated with the OAuth token Claude Code already stores locally.
//
// Claude Code also caches its last response in `~/.claude.json` under
// `cachedUsageUtilization`, but only refreshes it when it actually renders
// usage — measured going 30+ minutes stale during continuous API traffic
// (14% cached vs. 26% live). So the cache is the *fallback* for offline or
// expired-token, never the primary, and `fetched_at_ms` is passed through so
// the UI can say "as of N ago" instead of presenting it as live.
//
// We only ever *read* the token: an expired one falls back to the cache
// rather than running a refresh flow, which could disturb Claude Code's own
// session.

const USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
const OAUTH_BETA: &str = "oauth-2025-04-20";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
/// The usage endpoint has its own rate limit and answers 429 when leaned on
/// — a couple of calls ten minutes apart was enough to trip it during
/// development, which is why Claude Code caches it at all. So the backend
/// enforces its own floor between live calls no matter how fast the UI polls;
/// `usage_refresh_seconds` can only ever poll *slower* than this.
const MIN_FETCH_INTERVAL: Duration = Duration::from_secs(300);

/// One rate-limit window as Anthropic reports it.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    /// Percent of the window consumed, 0-100.
    pub percent: u8,
    /// RFC3339 time the window resets.
    pub resets_at_iso: String,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionUsageStats {
    /// False when neither the API nor the cache had anything to report.
    pub available: bool,
    /// The 5-hour session window.
    pub session: Option<UsageWindow>,
    /// The 7-day weekly window.
    pub week: Option<UsageWindow>,
    /// Unix ms these numbers were fetched — now for a live read, the cache's
    /// own timestamp for a fallback read.
    pub fetched_at_ms: Option<u64>,
    /// True when this came from Claude Code's cache rather than the API.
    pub from_cache: bool,
}

pub fn credentials_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude").join(".credentials.json"))
}

pub fn config_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude.json"))
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

/// Both sources carry the same window shape — the cache is literally the API
/// response with a timestamp wrapped around it — so one parser serves both.
/// `utilization` arrives as a float (`26.0`), not an integer.
fn window(utilization: &Value, key: &str) -> Option<UsageWindow> {
    let w = utilization.get(key)?;
    Some(UsageWindow {
        percent: w.get("utilization")?.as_f64()?.round().clamp(0.0, 100.0) as u8,
        resets_at_iso: w.get("resets_at")?.as_str()?.to_string(),
    })
}

fn stats_from(utilization: &Value, fetched_at_ms: Option<u64>, from_cache: bool) -> SessionUsageStats {
    let session = window(utilization, "five_hour");
    let week = window(utilization, "seven_day");
    SessionUsageStats { available: session.is_some() || week.is_some(), session, week, fetched_at_ms, from_cache }
}

// --- Live read ---

/// macOS keeps the credentials in the login keychain instead of a file; the
/// secret's body is the same JSON either way.
#[cfg(target_os = "macos")]
fn credentials_json(path: &Path) -> Option<String> {
    if let Ok(body) = fs::read_to_string(path) {
        return Some(body);
    }
    let out = std::process::Command::new("security")
        .args(["find-generic-password", "-s", "Claude Code-credentials", "-w"])
        .output()
        .ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

#[cfg(not(target_os = "macos"))]
fn credentials_json(path: &Path) -> Option<String> {
    fs::read_to_string(path).ok()
}

/// The stored access token, or None if it's missing or already expired — an
/// expired token is a fall-back-to-cache case, not a refresh case.
fn access_token(path: &Path) -> Option<String> {
    let json: Value = serde_json::from_str(&credentials_json(path)?).ok()?;
    let oauth = json.get("claudeAiOauth")?;
    if oauth.get("expiresAt").and_then(Value::as_u64).is_some_and(|exp| exp <= now_ms()) {
        return None;
    }
    Some(oauth.get("accessToken")?.as_str()?.to_string())
}

async fn live_stats(credentials: &Path) -> Option<SessionUsageStats> {
    let token = access_token(credentials)?;
    let body = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .ok()?
        .get(USAGE_URL)
        .bearer_auth(token)
        .header("anthropic-beta", OAUTH_BETA)
        .header("accept", "application/json")
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?
        .text()
        .await
        .ok()?;
    let utilization: Value = serde_json::from_str(&body).ok()?;
    let stats = stats_from(&utilization, Some(now_ms()), false);
    stats.available.then_some(stats)
}

// --- Cached fallback ---

fn cached_stats(config: &Path) -> SessionUsageStats {
    let Ok(raw) = fs::read_to_string(config) else { return SessionUsageStats::default() };
    let Ok(json) = serde_json::from_str::<Value>(&raw) else { return SessionUsageStats::default() };
    let Some(cached) = json.get("cachedUsageUtilization") else { return SessionUsageStats::default() };
    let Some(utilization) = cached.get("utilization") else { return SessionUsageStats::default() };
    stats_from(utilization, cached.get("fetchedAtMs").and_then(Value::as_u64), true)
}

/// Last successful live read, kept so a 429 or a dropped connection falls
/// back to *our* few-minutes-old number rather than all the way to Claude
/// Code's cache, which can be hours behind.
static LAST_LIVE: Mutex<Option<(Instant, SessionUsageStats)>> = Mutex::new(None);

/// Live where possible, then our own last good read, then Claude Code's
/// cache. Anything but a fresh live read is flagged `from_cache` so the UI
/// ages it honestly.
pub async fn session_usage_stats(credentials: &Path, config: &Path) -> SessionUsageStats {
    let recent = LAST_LIVE.lock().ok().and_then(|last| {
        last.as_ref().map(|(at, stats)| (at.elapsed() < MIN_FETCH_INTERVAL, stats.clone()))
    });
    // Inside the floor, reuse the last read as-is rather than spending a call.
    if let Some((true, stats)) = &recent {
        return stats.clone();
    }

    if let Some(stats) = live_stats(credentials).await {
        if let Ok(mut last) = LAST_LIVE.lock() {
            *last = Some((Instant::now(), stats.clone()));
        }
        return stats;
    }

    match recent {
        Some((_, stats)) => SessionUsageStats { from_cache: true, ..stats },
        None => cached_stats(config),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(name: &str, body: &str) -> (tempfile::TempDir, PathBuf) {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join(name);
        fs::write(&path, body).unwrap();
        (tmp, path)
    }

    // --- window parsing, shared by both sources ---

    #[test]
    fn parses_the_float_percentages_the_api_actually_returns() {
        // The live endpoint sends `26.0`, not `26` — reading these as
        // integers silently yields nothing.
        let v: Value = serde_json::from_str(
            r#"{"five_hour":{"utilization":26.0,"resets_at":"2026-08-03T19:20:00Z"},
                "seven_day":{"utilization":17.4,"resets_at":"2026-08-08T18:00:00Z"}}"#,
        )
        .unwrap();
        let stats = stats_from(&v, None, false);
        assert_eq!(stats.session.unwrap().percent, 26);
        assert_eq!(stats.week.unwrap().percent, 17);
    }

    #[test]
    fn a_null_window_is_skipped_not_faked() {
        let v: Value =
            serde_json::from_str(r#"{"five_hour":{"utilization":3.0,"resets_at":"x"},"seven_day":null,"seven_day_opus":null}"#).unwrap();
        let stats = stats_from(&v, None, false);
        assert!(stats.available);
        assert!(stats.week.is_none());
    }

    // --- token handling ---

    #[test]
    fn reads_an_unexpired_token() {
        let future = now_ms() + 60_000;
        let (_t, path) = write(".credentials.json", &format!(r#"{{"claudeAiOauth":{{"accessToken":"tok","expiresAt":{future}}}}}"#));
        assert_eq!(access_token(&path).as_deref(), Some("tok"));
    }

    #[test]
    fn an_expired_token_falls_back_instead_of_refreshing() {
        let past = now_ms() - 60_000;
        let (_t, path) = write(".credentials.json", &format!(r#"{{"claudeAiOauth":{{"accessToken":"tok","expiresAt":{past}}}}}"#));
        assert_eq!(access_token(&path), None);
    }

    #[test]
    fn missing_or_corrupt_credentials_yield_no_token() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(access_token(&tmp.path().join("nope.json")), None);
        let (_t, path) = write(".credentials.json", "{not json");
        assert_eq!(access_token(&path), None);
    }

    // --- cached fallback ---

    #[test]
    fn falls_back_to_the_cache_and_flags_it_as_cached() {
        let (_t, path) = write(
            ".claude.json",
            r#"{"cachedUsageUtilization":{"fetchedAtMs":1785767449619,"utilization":{
                "five_hour":{"utilization":14.0,"resets_at":"2026-08-03T19:20:00Z"},
                "seven_day":{"utilization":16.0,"resets_at":"2026-08-08T18:00:00Z"}}}}"#,
        );
        let stats = cached_stats(&path);
        assert!(stats.available && stats.from_cache);
        assert_eq!(stats.session.unwrap().percent, 14);
        assert_eq!(stats.fetched_at_ms, Some(1785767449619));
    }

    #[test]
    fn no_cache_and_no_token_reports_unavailable() {
        let (_t, path) = write(".claude.json", r#"{"projects":{}}"#);
        assert!(!cached_stats(&path).available);
        let tmp = tempfile::tempdir().unwrap();
        assert!(!cached_stats(&tmp.path().join("nope.json")).available);
    }

    /// Hits the real endpoint with your real token. Ignored by default —
    /// it needs network and a logged-in Claude Code — but it's the only
    /// thing that proves the URL, headers and response shape still hold:
    /// `cargo test -- --ignored live_fetch`.
    #[tokio::test]
    #[ignore]
    async fn live_fetch_hits_the_real_endpoint() {
        let creds = credentials_path().unwrap();
        assert!(access_token(&creds).is_some(), "no usable token at {creds:?}");

        let status = reqwest::Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .build()
            .unwrap()
            .get(USAGE_URL)
            .bearer_auth(access_token(&creds).unwrap())
            .header("anthropic-beta", OAUTH_BETA)
            .header("accept", "application/json")
            .send()
            .await
            .expect("request failed")
            .status();

        // 429 means the endpoint's own rate limit, not a broken integration —
        // exactly the case the cache fallback exists for.
        if status == 429 {
            eprintln!("usage endpoint rate-limited; auth and URL are fine, try again later");
            return;
        }
        assert_eq!(status, 200);

        let stats = live_stats(&creds).await.expect("live fetch failed");
        assert!(!stats.from_cache);
        assert!(stats.session.is_some(), "no five_hour window in the response");
    }

    #[tokio::test]
    async fn no_credentials_at_all_still_serves_the_cache() {
        let (_t, config) = write(
            ".claude.json",
            r#"{"cachedUsageUtilization":{"utilization":{"five_hour":{"utilization":9.0,"resets_at":"x"}}}}"#,
        );
        let stats = session_usage_stats(Path::new("/nonexistent/.credentials.json"), &config).await;
        assert!(stats.from_cache);
        assert_eq!(stats.session.unwrap().percent, 9);
    }
}
