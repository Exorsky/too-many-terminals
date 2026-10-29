//! Read-only Jira lookups for the issue card: one GET per issue key, nothing
//! else. The token is never stored by the app — settings hold only the *name*
//! of an environment variable, resolved here from the app's own environment
//! and then from `~/.claude/settings.json`'s `env` block, which is where a
//! Claude Code user already keeps theirs.

use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JiraIssue {
    pub key: String,
    pub summary: String,
    pub status: String,
    /// Jira's status category key: "new", "indeterminate" or "done".
    pub status_category: String,
    pub assignee: Option<String>,
    pub reporter: Option<String>,
    pub priority: Option<String>,
    pub created: Option<String>,
    pub updated: Option<String>,
    /// Who wrote the latest comment, when that isn't the assignee — someone
    /// answered and it's your move. Only filled where comments were asked for
    /// (My issues); the hover card leaves it empty.
    pub reply_from: Option<String>,
    pub reply_at: Option<String>,
    /// Description and latest comment, when the search already carried them
    /// (My issues) — so the inspector needn't ask again.
    pub detail: Option<JiraIssueDetail>,
}

/// What the inspector adds to an issue: its description and latest comment.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JiraIssueDetail {
    pub description: Option<String>,
    pub comment: Option<JiraComment>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JiraComment {
    pub author: Option<String>,
    pub created: Option<String>,
    pub body: String,
}

/// `ABC-123`: an uppercase project key, a dash, digits. Checked before the key
/// goes into a URL, so nothing else can ride along in the path.
pub fn is_issue_key(key: &str) -> bool {
    let Some((project, num)) = key.split_once('-') else { return false };
    let mut chars = project.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_uppercase())
        && chars.all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
        && !num.is_empty()
        && num.chars().all(|c| c.is_ascii_digit())
}

/// The token behind `var`: the process environment first, then the `env`
/// block of Claude Code's global settings file.
pub fn resolve_token(var: &str, claude_settings: &Path) -> Option<String> {
    if var.is_empty() {
        return None;
    }
    if let Ok(v) = std::env::var(var) {
        if !v.is_empty() {
            return Some(v);
        }
    }
    let text = std::fs::read_to_string(claude_settings).ok()?;
    let json: Value = serde_json::from_str(&text).ok()?;
    json.get("env")?.get(var)?.as_str().filter(|s| !s.is_empty()).map(str::to_string)
}

fn parse_issue(json: &Value) -> Option<JiraIssue> {
    let fields = json.get("fields")?;
    let s = |v: Option<&Value>| v.and_then(Value::as_str).map(str::to_string);
    Some(JiraIssue {
        key: s(json.get("key"))?,
        summary: s(fields.get("summary")).unwrap_or_default(),
        status: s(fields.pointer("/status/name")).unwrap_or_default(),
        status_category: s(fields.pointer("/status/statusCategory/key")).unwrap_or_default(),
        assignee: s(fields.pointer("/assignee/displayName")),
        reporter: s(fields.pointer("/reporter/displayName")),
        priority: s(fields.pointer("/priority/name")),
        created: s(fields.get("created")),
        updated: s(fields.get("updated")),
        reply_from: reply(fields).map(|c| c.0),
        reply_at: reply(fields).and_then(|c| c.1),
        detail: fields.get("comment").map(|_| parse_detail(json)),
    })
}

/// The latest comment's author and time, if someone other than the assignee
/// wrote it. People are compared by account (`name` on Server/DC, `accountId`
/// on Cloud), not display name — two people can share one.
fn account(person: Option<&Value>) -> Option<&str> {
    let p = person?;
    p.get("name").or_else(|| p.get("accountId"))?.as_str()
}

fn reply(fields: &Value) -> Option<(String, Option<String>)> {
    let last = fields.pointer("/comment/comments")?.as_array()?.last()?;
    let author = account(last.get("author"));
    if author.is_some() && author == account(fields.get("assignee")) {
        return None;
    }
    let who = last.pointer("/author/displayName").and_then(Value::as_str).or(author).unwrap_or("Someone");
    Some((who.to_string(), last.get("created").and_then(Value::as_str).map(str::to_string)))
}

/// Until when the app sends Jira nothing at all. Set by a 429 (for as long as
/// `Retry-After` says) and by a refused token: on Jira Server, repeated 401s
/// count toward a CAPTCHA lockout of the account, so a wrong token must not be
/// retried on every hover.
static PAUSED_UNTIL: Mutex<Option<Instant>> = Mutex::new(None);

/// A refused token waits this long before the next try.
const AUTH_PAUSE: Duration = Duration::from_secs(5 * 60);

fn pause(for_: Duration) {
    *PAUSED_UNTIL.lock().unwrap() = Some(Instant::now() + for_);
}

fn paused_for() -> Option<Duration> {
    let until = (*PAUSED_UNTIL.lock().unwrap())?;
    until.checked_duration_since(Instant::now()).filter(|d| !d.is_zero())
}

/// `Retry-After` in seconds (Jira sends the delta form), clamped so a missing
/// or absurd header still means "a minute", never "now" or "a day".
pub fn retry_after_secs(header: Option<&str>) -> u64 {
    header.and_then(|v| v.trim().parse::<u64>().ok()).unwrap_or(60).clamp(10, 3600)
}

/// Nothing reaches Jira while the integration is switched off or has no URL.
pub fn check_enabled(enabled: bool, base_url: &str) -> Result<(), String> {
    if !enabled {
        return Err("Jira is turned off".into());
    }
    if base_url.is_empty() {
        return Err("Jira URL is not set".into());
    }
    Ok(())
}

const FIELDS: &str = "summary,status,assignee,reporter,priority,created,updated";

pub async fn fetch_issue(base_url: &str, token: Option<&str>, key: &str) -> Result<JiraIssue, String> {
    if !is_issue_key(key) {
        return Err(format!("not an issue key: {key}"));
    }
    let json = get_json(base_url, token, &format!("issue/{key}"), &[("fields", FIELDS)])
        .await
        .map_err(|e| if e == "not found" { format!("{key} not found") } else { e })?;
    parse_issue(&json).ok_or_else(|| "unexpected Jira response".into())
}

/// Open issues assigned to the token's owner, most recently updated first.
/// One request; at most 50 — a list longer than that isn't a to-do list.
pub async fn fetch_my_issues(base_url: &str, token: &str) -> Result<Vec<JiraIssue>, String> {
    let jql = "assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC";
    // With comments (whose move is it) and descriptions (the inspector) —
    // still the one request, and clicking through the list asks nothing.
    let fields = format!("{FIELDS},description,comment");
    let json = get_json(base_url, Some(token), "search", &[("jql", jql), ("fields", &fields), ("maxResults", "50")]).await?;
    Ok(parse_search(&json))
}

/// Description and latest comment of one issue — one GET, asked only when an
/// issue is opened in the inspector.
pub async fn fetch_issue_detail(base_url: &str, token: Option<&str>, key: &str) -> Result<JiraIssueDetail, String> {
    if !is_issue_key(key) {
        return Err(format!("not an issue key: {key}"));
    }
    let json = get_json(base_url, token, &format!("issue/{key}"), &[("fields", "description,comment")])
        .await
        .map_err(|e| if e == "not found" { format!("{key} not found") } else { e })?;
    Ok(parse_detail(&json))
}

fn parse_detail(json: &Value) -> JiraIssueDetail {
    let s = |v: Option<&Value>| v.and_then(Value::as_str).map(str::to_string);
    let comment = json
        .pointer("/fields/comment/comments")
        .and_then(Value::as_array)
        .and_then(|c| c.last())
        .map(|c| JiraComment {
            author: s(c.pointer("/author/displayName")),
            created: s(c.get("created")),
            body: s(c.get("body")).unwrap_or_default(),
        });
    JiraIssueDetail {
        description: s(json.pointer("/fields/description")).filter(|d| !d.trim().is_empty()),
        comment,
    }
}

fn parse_search(json: &Value) -> Vec<JiraIssue> {
    json.get("issues").and_then(Value::as_array).map(|a| a.iter().filter_map(parse_issue).collect()).unwrap_or_default()
}

/// One GET against `/rest/api/2/{path}`, with every rule the app keeps toward
/// a rate-limited Jira: nothing while paused, https only, no redirects, and a
/// 429 or a refused token pausing everything after it.
async fn get_json(base_url: &str, token: Option<&str>, path: &str, query: &[(&str, &str)]) -> Result<Value, String> {
    if let Some(left) = paused_for() {
        return Err(format!("Jira paused — retrying in {}s", left.as_secs().max(1)));
    }
    let base = base_url.trim_end_matches('/');
    // https only: the request carries a bearer token.
    if !base.starts_with("https://") {
        return Err("Jira URL must start with https://".into());
    }
    let url = format!("{base}/rest/api/2/{path}");
    // No redirects: behind an SSO proxy, being off the VPN answers with a 302
    // to the login page, and following it would read as a confusing parse error.
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())?;
    let mut req = client.get(&url).query(query).header("accept", "application/json");
    if let Some(t) = token {
        req = req.bearer_auth(t);
    }
    let resp = req.send().await.map_err(|e| {
        if e.is_timeout() || e.is_connect() { "Jira unreachable — VPN?".to_string() } else { e.to_string() }
    })?;
    let status = resp.status();
    if status.is_redirection() {
        return Err("Jira redirected to sign-in — VPN?".into());
    }
    if status.as_u16() == 429 {
        let secs = retry_after_secs(resp.headers().get("retry-after").and_then(|v| v.to_str().ok()));
        pause(Duration::from_secs(secs));
        return Err(format!("Jira rate limit — paused for {secs}s"));
    }
    if status.as_u16() == 401 || status.as_u16() == 403 {
        pause(AUTH_PAUSE);
        return Err("Jira refused the token — paused for 5 min".into());
    }
    if status.as_u16() == 404 {
        return Err("not found".into());
    }
    if !status.is_success() {
        return Err(format!("Jira answered {status}"));
    }
    let text = resp.text().await.map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn issue_keys() {
        assert!(is_issue_key("PROJ-4821"));
        assert!(is_issue_key("A1-1"));
        assert!(!is_issue_key("proj-1"));
        assert!(!is_issue_key("PROJ-"));
        assert!(!is_issue_key("PROJ-1/../x"));
        assert!(!is_issue_key("-1"));
    }

    #[test]
    fn switched_off_or_unset_asks_nothing() {
        assert!(check_enabled(false, "https://jira.example.com").is_err());
        assert!(check_enabled(true, "").is_err());
        assert!(check_enabled(true, "https://jira.example.com").is_ok());
    }

    #[test]
    fn retry_after_is_clamped() {
        assert_eq!(retry_after_secs(Some("120")), 120);
        assert_eq!(retry_after_secs(Some(" 30 ")), 30);
        assert_eq!(retry_after_secs(None), 60);
        assert_eq!(retry_after_secs(Some("Wed, 21 Oct 2026 07:28:00 GMT")), 60);
        assert_eq!(retry_after_secs(Some("0")), 10);
        assert_eq!(retry_after_secs(Some("999999")), 3600);
    }

    #[test]
    fn a_pause_blocks_until_it_runs_out() {
        pause(Duration::from_secs(30));
        assert!(paused_for().is_some());
        pause(Duration::ZERO);
        assert!(paused_for().is_none());
    }

    #[test]
    fn token_from_claude_settings() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("settings.json");
        std::fs::write(&path, r#"{"env":{"TMT_TEST_JIRA_TOKEN_X":"secret"}}"#).unwrap();
        assert_eq!(resolve_token("TMT_TEST_JIRA_TOKEN_X", &path).as_deref(), Some("secret"));
        assert_eq!(resolve_token("TMT_TEST_MISSING", &path), None);
        assert_eq!(resolve_token("", &path), None);
    }

    #[test]
    fn parses_issue() {
        let json = serde_json::json!({
            "key": "PROJ-1",
            "fields": {
                "summary": "Disk alert",
                "status": { "name": "In Progress", "statusCategory": { "key": "indeterminate" } },
                "assignee": { "displayName": "J.Doe" },
                "reporter": { "displayName": "A.Roe" },
                "priority": null,
                "created": "2026-10-20T09:00:00.000+0300",
                "updated": "2026-10-28T13:02:00.000+0200"
            }
        });
        let issue = parse_issue(&json).unwrap();
        assert_eq!(issue.summary, "Disk alert");
        assert_eq!(issue.status_category, "indeterminate");
        assert_eq!(issue.assignee.as_deref(), Some("J.Doe"));
        assert_eq!(issue.reporter.as_deref(), Some("A.Roe"));
        assert_eq!(issue.created.as_deref(), Some("2026-10-20T09:00:00.000+0300"));
        assert_eq!(issue.priority, None);
    }

    #[test]
    fn parses_detail_with_the_latest_comment() {
        let json = serde_json::json!({ "fields": {
            "description": "Cut over MX",
            "comment": { "comments": [
                { "author": { "displayName": "A" }, "created": "1", "body": "first" },
                { "author": { "displayName": "B" }, "created": "2", "body": "latest" }
            ]}
        }});
        let d = parse_detail(&json);
        assert_eq!(d.description.as_deref(), Some("Cut over MX"));
        assert_eq!(d.comment.unwrap().body, "latest");
        let empty = parse_detail(&serde_json::json!({ "fields": { "description": "  ", "comment": { "comments": [] } } }));
        assert_eq!(empty, JiraIssueDetail { description: None, comment: None });
    }

    #[test]
    fn a_reply_is_a_latest_comment_by_someone_else() {
        let issue = |last_by: &str| serde_json::json!({ "key": "PROJ-1", "fields": {
            "assignee": { "name": "me", "displayName": "Me" },
            "comment": { "comments": [
                { "author": { "name": "other", "displayName": "A. Roe" }, "created": "1" },
                { "author": { "name": last_by, "displayName": "Whoever" }, "created": "2" }
            ]}
        }});
        let theirs = parse_issue(&issue("other")).unwrap();
        assert_eq!(theirs.reply_from.as_deref(), Some("Whoever"));
        assert_eq!(theirs.reply_at.as_deref(), Some("2"));
        assert_eq!(parse_issue(&issue("me")).unwrap().reply_from, None);
        // No comments asked for (the hover card): no reply.
        let bare = serde_json::json!({ "key": "PROJ-1", "fields": { "summary": "x" } });
        assert_eq!(parse_issue(&bare).unwrap().reply_from, None);
        // Comments carried by the search fill the inspector's detail too.
        assert_eq!(theirs.detail.unwrap().comment.unwrap().created.as_deref(), Some("2"));
        assert!(parse_issue(&bare).unwrap().detail.is_none());
    }

    #[test]
    fn parses_search() {
        let json = serde_json::json!({ "issues": [
            { "key": "PROJ-1", "fields": { "summary": "A" } },
            { "fields": {} },
            { "key": "PROJ-2", "fields": { "summary": "B" } }
        ]});
        let keys: Vec<_> = parse_search(&json).into_iter().map(|i| i.key).collect();
        assert_eq!(keys, ["PROJ-1", "PROJ-2"]);
        assert!(parse_search(&serde_json::json!({})).is_empty());
    }
}
