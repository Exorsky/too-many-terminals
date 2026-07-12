use std::sync::OnceLock;

use crate::shell::Platform;

/// Builds the program + args to launch the Claude CLI.
///
/// On Windows `claude` is an npm `.cmd` shim (or a native exe); a pty can't
/// resolve `.cmd` files directly, so we go through `cmd.exe /c`.
pub fn claude_command(platform: Platform, flags: &[String]) -> (String, Vec<String>) {
    match platform {
        Platform::Windows => {
            let mut args = vec!["/c".to_string(), "claude".to_string()];
            args.extend(flags.iter().cloned());
            ("cmd.exe".to_string(), args)
        }
        _ => ("claude".to_string(), flags.to_vec()),
    }
}

/// Flags to resume a past Claude Code session.
pub fn resume_flags(session_id: &str) -> Vec<String> {
    vec!["--resume".to_string(), session_id.to_string()]
}

/// GUI apps launched from Finder/dock (macOS) or a desktop launcher (Linux)
/// inherit a minimal PATH that usually misses `claude`. Resolve the login
/// shell's PATH once and reuse it for every pty we spawn.
pub fn login_shell_path() -> Option<&'static str> {
    static PATH: OnceLock<Option<String>> = OnceLock::new();
    PATH.get_or_init(compute_login_shell_path).as_deref()
}

#[cfg(windows)]
fn compute_login_shell_path() -> Option<String> {
    None // Windows GUI apps inherit the full user PATH already.
}

#[cfg(not(windows))]
fn compute_login_shell_path() -> Option<String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
    let output = std::process::Command::new(&shell)
        .args(["-lc", "echo $PATH"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path.is_empty() { None } else { Some(path) }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn windows_wraps_in_cmd() {
        let (cmd, args) = claude_command(Platform::Windows, &[]);
        assert_eq!(cmd, "cmd.exe");
        assert_eq!(args, s(&["/c", "claude"]));
    }

    #[test]
    fn windows_passes_flags_through() {
        let (cmd, args) = claude_command(Platform::Windows, &s(&["--resume", "abc"]));
        assert_eq!(cmd, "cmd.exe");
        assert_eq!(args, s(&["/c", "claude", "--resume", "abc"]));
    }

    #[test]
    fn unix_runs_claude_directly() {
        for platform in [Platform::MacOs, Platform::Linux] {
            let (cmd, args) = claude_command(platform, &s(&["--resume", "abc"]));
            assert_eq!(cmd, "claude");
            assert_eq!(args, s(&["--resume", "abc"]));
        }
    }

    #[test]
    fn resume_flags_shape() {
        assert_eq!(resume_flags("xyz"), s(&["--resume", "xyz"]));
    }
}
