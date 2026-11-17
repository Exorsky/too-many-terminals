//! Auto-names a Claude tab from its first prompt by asking a small/cheap
//! model (Haiku) for a short title, via a one-shot `claude -p` invocation —
//! no direct Anthropic API call, no separate API key. Naming jobs are
//! serialized through a single worker thread since concurrent `claude -p`
//! invocations get rate-limited.

use std::io::Write;
use std::process::{Command, Stdio};
use std::sync::mpsc::{self, Sender};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::claude::{claude_command, login_shell_path};
use crate::shell::Platform;

const NAMING_MODEL: &str = "claude-haiku-4-5-20251001";
const NAME_MAX_CHARS: usize = 50;
const PROMPT_TRUNCATE_CHARS: usize = 500;
const NAMING_TIMEOUT: Duration = Duration::from_secs(30);

pub fn naming_prompt(user_message: &str) -> String {
    let stripped = strip_tagged_blocks(user_message);
    let truncated: String = stripped.trim().chars().take(PROMPT_TRUNCATE_CHARS).collect();
    format!(
        "Generate a short tab title (3-5 words) for a conversation that starts with this message. If it mentions a ticket key like ABC-123, start the title with that key. Reply with ONLY the title, no quotes, no punctuation:\n\n{truncated}"
    )
}

/// Removes `<tag>…</tag>` blocks (an IDE's `<ide_opened_file>`, system
/// reminders) that ride along with a prompt — they aren't what the user typed,
/// and Haiku used to echo them back as the title. Only tags with a `_` or `-`
/// in the name, which is how every injected one is spelled: HTML the user typed
/// (`fix the <title>Home</title> tag`) stays.
pub fn strip_tagged_blocks(text: &str) -> String {
    let mut out = String::new();
    let mut rest = text;
    while let Some(start) = rest.find('<') {
        let after = &rest[start + 1..];
        let tag: String =
            after.chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-').collect();
        let close = format!("</{tag}>");
        let injected = tag.contains('_') || tag.contains('-');
        let end = (injected && after[tag.len()..].starts_with('>'))
            .then(|| after.find(&close))
            .flatten();
        match end {
            Some(end) => {
                out.push_str(&rest[..start]);
                rest = &after[end + close.len()..];
            }
            None => {
                out.push_str(&rest[..=start]);
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Haiku answers a prompt it can't title (a bare URL, "see the image") with
/// an apology instead of a title. Those used to become the session name.
fn looks_like_refusal(name: &str) -> bool {
    const OPENERS: [&str; 9] = [
        "i can't", "i can\u{2019}t", "i cannot", "i don't", "i do not", "i'm sorry", "i\u{2019}m sorry",
        "i'm unable", "i am unable",
    ];
    let lower = name.to_lowercase();
    lower.starts_with('<') || lower.starts_with("sorry") || OPENERS.iter().any(|o| lower.starts_with(o))
}

/// Trims whitespace/wrapping quotes and caps length; `None` if nothing useful
/// remains or the reply is a refusal rather than a title.
pub fn clean_name(raw: &str) -> Option<String> {
    tidy(raw).filter(|name| !looks_like_refusal(name))
}

/// First line, without wrapping quotes, capped; `None` if blank.
fn tidy(raw: &str) -> Option<String> {
    let first_line = raw.trim().lines().next().unwrap_or("");
    let trimmed = first_line.trim().trim_matches(|c| c == '"' || c == '\'').trim();
    let truncated: String = trimmed.chars().take(NAME_MAX_CHARS).collect();
    (!truncated.is_empty()).then_some(truncated)
}

/// The name to use when the model gives nothing usable: the first few words
/// the user typed, minus tagged blocks and links.
pub fn fallback_name(user_message: &str) -> Option<String> {
    let stripped = strip_tagged_blocks(user_message);
    let words: Vec<&str> = stripped
        .split_whitespace()
        .filter(|w| !w.starts_with("http://") && !w.starts_with("https://"))
        .take(6)
        .collect();
    // Your own words, not the model's: "I can't connect to VPN" is a fine name.
    tidy(&words.join(" "))
}

fn naming_flags() -> Vec<String> {
    [
        "-p", "--no-session-persistence", "--model", NAMING_MODEL, "--tools", "",
        "--setting-sources", "",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect()
}

/// Calls `claude -p` with the prompt on stdin and returns the cleaned reply,
/// or `None` on any spawn failure, non-zero exit, or timeout. Run from
/// `$HOME` so no project `CLAUDE.md` is pulled into context.
pub fn run_naming_subprocess(prompt: &str) -> Option<String> {
    let (program, args) = claude_command(Platform::current(), &naming_flags());
    let home = dirs::home_dir()?;

    let mut command = Command::new(&program);
    command
        .args(&args)
        .current_dir(&home)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    // GUI apps launched from Finder/dock inherit a minimal PATH without
    // `claude` — same problem pty_spawn solves for its children. On Unix,
    // Command resolves the program via the child's PATH when one is set.
    if let Some(path) = login_shell_path() {
        command.env("PATH", path);
    }
    // On Windows `claude` runs through `cmd.exe`; without this flag that spawns
    // a visible console window that flashes on screen every time we auto-name.
    no_window(&mut command);
    let mut child = command.spawn().ok()?;

    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(prompt.as_bytes());
    }
    let pid = child.id();

    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(child.wait_with_output());
    });

    match rx.recv_timeout(NAMING_TIMEOUT) {
        Ok(Ok(output)) if output.status.success() => {
            clean_name(&String::from_utf8_lossy(&output.stdout))
        }
        _ => {
            kill_pid(pid);
            None
        }
    }
}

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Stops the spawned command from popping a console window on Windows. No-op
/// elsewhere.
#[cfg(windows)]
pub(crate) fn no_window(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
pub(crate) fn no_window(_command: &mut Command) {}

#[cfg(windows)]
fn kill_pid(pid: u32) {
    let mut command = Command::new("taskkill");
    command.args(["/PID", &pid.to_string(), "/T", "/F"]);
    no_window(&mut command);
    let _ = command.spawn();
}

#[cfg(not(windows))]
fn kill_pid(pid: u32) {
    let _ = Command::new("kill").args(["-9", &pid.to_string()]).spawn();
}

pub struct NamingJob {
    pub tab_id: String,
    /// The user's first prompt, as typed.
    pub message: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TabNamedPayload {
    tab_id: String,
    name: String,
}

/// Single-worker-thread queue: `Sender` is cheap to clone and hand to every
/// caller; the `mpsc::Receiver` iterator naturally serializes jobs one at a
/// time in submission order.
#[derive(Clone)]
pub struct NamingQueue {
    sender: Sender<NamingJob>,
}

impl NamingQueue {
    pub fn spawn(app: AppHandle) -> Self {
        let (sender, receiver) = mpsc::channel::<NamingJob>();
        std::thread::spawn(move || {
            for job in receiver {
                let name = run_naming_subprocess(&naming_prompt(&job.message))
                    .or_else(|| fallback_name(&job.message));
                if let Some(name) = name {
                    let _ = app.emit(
                        "claude-tab-named",
                        TabNamedPayload { tab_id: job.tab_id, name },
                    );
                }
            }
        });
        NamingQueue { sender }
    }

    pub fn submit(&self, job: NamingJob) {
        let _ = self.sender.send(job);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn naming_prompt_includes_the_message_and_truncates_long_ones() {
        let prompt = naming_prompt("fix the login bug");
        assert!(prompt.contains("fix the login bug"));
        assert!(prompt.contains("3-5 words"));

        let long = "x".repeat(1000);
        let truncated_prompt = naming_prompt(&long);
        // Message body only, not the whole prompt string, is capped at 500 chars.
        let body = truncated_prompt.rsplit("\n\n").next().unwrap();
        assert_eq!(body.chars().count(), 500);
    }

    #[test]
    fn clean_name_strips_quotes_and_whitespace() {
        assert_eq!(clean_name("  \"Fix login bug\"  "), Some("Fix login bug".to_string()));
        assert_eq!(clean_name("'Fix login bug'"), Some("Fix login bug".to_string()));
        assert_eq!(clean_name("Fix login bug"), Some("Fix login bug".to_string()));
    }

    #[test]
    fn clean_name_truncates_to_fifty_chars() {
        let long = "a".repeat(100);
        let cleaned = clean_name(&long).unwrap();
        assert_eq!(cleaned.chars().count(), 50);
    }

    #[test]
    fn clean_name_rejects_refusals() {
        for reply in [
            "I can't help with this. The message you've provided",
            "I cannot access external URLs",
            "I don't see any images attached to your message",
            "I\u{2019}m sorry, I can't",
            "<ide_opened_file>The user opened",
        ] {
            assert_eq!(clean_name(reply), None, "{reply}");
        }
        assert_eq!(clean_name("Icinga alert tuning"), Some("Icinga alert tuning".into()));
    }

    #[test]
    fn clean_name_keeps_only_the_first_line() {
        assert_eq!(clean_name("Fix login bug\nBecause the message is about"), Some("Fix login bug".into()));
    }

    #[test]
    fn strip_tagged_blocks_drops_ide_context_but_keeps_plain_angle_brackets() {
        let msg = "<ide_opened_file>The user opened /a/b.ts</ide_opened_file>review this file";
        assert_eq!(strip_tagged_blocks(msg), "review this file");
        assert_eq!(strip_tagged_blocks("is a < b and b > c"), "is a < b and b > c");
        assert_eq!(strip_tagged_blocks("<unclosed>text"), "<unclosed>text");
        assert_eq!(strip_tagged_blocks("fix the <title>Home</title> tag"), "fix the <title>Home</title> tag");
        assert_eq!(strip_tagged_blocks("<system-reminder>x</system-reminder>go"), "go");
        assert!(!naming_prompt(msg).contains("ide_opened_file"));
    }

    #[test]
    fn fallback_name_uses_the_first_words_without_links() {
        assert_eq!(
            fallback_name("https://teams.microsoft.com/l/x read the last message in this chat please"),
            Some("read the last message in this".into()),
        );
        assert_eq!(fallback_name("https://example.com"), None);
        assert_eq!(fallback_name("I can't connect to VPN from office").as_deref(), Some("I can't connect to VPN from"));
        assert_eq!(fallback_name("<ide_selection>x</ide_selection>  "), None);
    }

    #[test]
    fn clean_name_rejects_blank_output() {
        assert_eq!(clean_name(""), None);
        assert_eq!(clean_name("   "), None);
        assert_eq!(clean_name("\"\""), None);
    }
}
