//! Hands a live Claude session off to the VS Code Claude Code extension.
//! Both tools read/write the same `~/.claude/projects/<encoded-cwd>/<id>.jsonl`
//! transcript (see `session_history::projects_root`), so there is nothing to
//! migrate — the handoff is just "focus VS Code on this folder, then tell its
//! Claude Code extension which session to open".

use crate::shell::Platform;

/// Program + args to open/focus VS Code on a folder. On Windows `code` is an
/// npm `.cmd` shim (same reason `claude_command` in `claude.rs` goes through
/// `cmd.exe` rather than spawning it directly).
pub fn code_command(platform: Platform, dir: &str) -> (String, Vec<String>) {
    match platform {
        Platform::Windows => (
            "cmd.exe".to_string(),
            vec!["/c".to_string(), "code".to_string(), dir.to_string()],
        ),
        _ => ("code".to_string(), vec![dir.to_string()]),
    }
}

/// The deep link the Claude Code VS Code extension's `registerUriHandler`
/// answers on ("/open"), resuming `session` in whichever workspace is
/// currently focused.
pub fn session_uri(session_id: &str) -> String {
    format!("vscode://anthropic.claude-code/open?session={session_id}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_wraps_in_cmd() {
        let (cmd, args) = code_command(Platform::Windows, "C:\\proj");
        assert_eq!(cmd, "cmd.exe");
        assert_eq!(args, vec!["/c", "code", "C:\\proj"]);
    }

    #[test]
    fn unix_runs_code_directly() {
        for platform in [Platform::MacOs, Platform::Linux] {
            let (cmd, args) = code_command(platform, "/proj");
            assert_eq!(cmd, "code");
            assert_eq!(args, vec!["/proj"]);
        }
    }

    #[test]
    fn session_uri_shape() {
        assert_eq!(
            session_uri("abc-123"),
            "vscode://anthropic.claude-code/open?session=abc-123"
        );
    }
}
