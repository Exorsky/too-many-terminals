//! Reads a project's `.env` so a session spawned in that folder inherits the
//! project's credentials without anyone having to paste them into the
//! conversation. Claude Code's own `env` block in `settings.json` covers the
//! case where you're willing to write the values there; this covers the far
//! more common one, where they already live in a `.env` next to the code.
//!
//! Values never leave this process: `commands::pty_spawn` applies them to the
//! child, and only the key names are ever reported — see `env_sources`, which
//! merges this with the `settings.json` blocks Claude Code applies itself.

use std::path::Path;

/// Variables the app sets on every PTY itself (see `commands::pty_spawn`). A
/// `.env` that tries to set one is refused rather than honored: a stray `PATH=`
/// would leave the tab unable to find `claude` at all, and the
/// `TOO_MANY_TERMINALS_*` pair is how the status hooks find their way back to
/// the app. `pty_spawn` also writes its own variables *after* these, so the
/// ordering backs the filter up.
const RESERVED: [&str; 2] = ["PATH", "TERM"];
const RESERVED_PREFIX: &str = "TOO_MANY_TERMINALS_";

fn is_reserved(key: &str) -> bool {
    RESERVED.contains(&key) || key.starts_with(RESERVED_PREFIX)
}

pub struct DotEnv {
    /// `KEY -> value`, in file order, with reserved names already removed.
    pub pairs: Vec<(String, String)>,
    /// Reserved names the file tried to set. Kept so the refusal can be shown
    /// rather than silently swallowed.
    pub refused: Vec<String>,
    /// The file is there but couldn't be read (permissions, or it's a
    /// directory). Distinct from "no `.env`", which is [`load`] returning
    /// `None`.
    pub unreadable: bool,
}

/// Splits `KEY=value` lines. Blank lines and whole-line `#` comments are
/// skipped, a leading `export ` is tolerated, and surrounding quotes are
/// stripped. A trailing `# …` is deliberately *not* treated as a comment —
/// `#` is a perfectly ordinary character inside a secret, and silently
/// truncating a key at one would be far worse than keeping a stray comment.
/// Lines that aren't assignments are skipped, never fatal: a tab that refuses
/// to open because of a typo in a `.env` is a worse outcome than a missing
/// variable.
fn parse(text: &str) -> Vec<(String, String)> {
    text.lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                return None;
            }
            let line = line.strip_prefix("export ").unwrap_or(line).trim_start();
            let (key, value) = line.split_once('=')?;
            let key = key.trim();
            if key.is_empty()
                || key.starts_with(|c: char| c.is_ascii_digit())
                || !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
            {
                return None;
            }
            Some((key.to_string(), unquote(value.trim()).to_string()))
        })
        .collect()
}

fn unquote(value: &str) -> &str {
    for q in ['"', '\''] {
        if let Some(inner) = value.strip_prefix(q).and_then(|v| v.strip_suffix(q)) {
            return inner;
        }
    }
    value
}

/// Reads `<cwd>/.env`. Only the directory the tab actually opens in — no
/// walking up to parents, because a credential arriving from two levels above
/// the folder you opened is a surprise, and surprises with secrets are bugs.
///
/// `None` means the folder has no `.env` at all, which is the common case and
/// prints nothing.
pub fn load(cwd: &Path) -> Option<DotEnv> {
    let path = cwd.join(".env");
    if !path.exists() {
        return None;
    }
    let Ok(text) = std::fs::read_to_string(&path) else {
        return Some(DotEnv { pairs: Vec::new(), refused: Vec::new(), unreadable: true });
    };
    let (refused, pairs): (Vec<_>, Vec<_>) =
        parse(&text).into_iter().partition(|(k, _)| is_reserved(k));
    Some(DotEnv {
        pairs,
        refused: refused.into_iter().map(|(k, _)| k).collect(),
        unreadable: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keys(text: &str) -> Vec<String> {
        parse(text).into_iter().map(|(k, _)| k).collect()
    }

    fn value_of(text: &str, key: &str) -> Option<String> {
        parse(text).into_iter().find(|(k, _)| k == key).map(|(_, v)| v)
    }

    #[test]
    fn skips_blanks_and_comments() {
        let text = "\n# a comment\n\nAPI_KEY=abc\n   \n";
        assert_eq!(keys(text), ["API_KEY"]);
    }

    #[test]
    fn tolerates_export_prefix_and_strips_quotes() {
        assert_eq!(value_of("export API_KEY=\"abc123\"", "API_KEY").unwrap(), "abc123");
        assert_eq!(value_of("API_KEY='abc123'", "API_KEY").unwrap(), "abc123");
        // A lone quote isn't a pair — leave the value exactly as written.
        assert_eq!(value_of("API_KEY=\"abc", "API_KEY").unwrap(), "\"abc");
    }

    #[test]
    fn keeps_everything_after_the_first_equals() {
        let v = value_of("DATABASE_URL=postgres://u:p@host/db?x=1", "DATABASE_URL").unwrap();
        assert_eq!(v, "postgres://u:p@host/db?x=1");
    }

    #[test]
    fn hash_inside_a_value_is_not_a_comment() {
        // Truncating a secret at a `#` would be a silent, very confusing bug.
        assert_eq!(value_of("SECRET=a#b#c", "SECRET").unwrap(), "a#b#c");
    }

    #[test]
    fn malformed_lines_are_skipped_not_fatal() {
        let text = "GOOD=1\nthis is not an assignment\n=novalue\n9LEADING=x\nBAD KEY=x\nALSO_GOOD=2";
        assert_eq!(keys(text), ["GOOD", "ALSO_GOOD"]);
    }

    #[test]
    fn reserved_names_are_refused_not_applied() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join(".env"),
            "API_KEY=ok\nPATH=/nope\nTERM=dumb\nTOO_MANY_TERMINALS_PIPE=/tmp/evil\n",
        )
        .unwrap();

        let loaded = load(dir.path()).unwrap();
        assert_eq!(loaded.pairs, [("API_KEY".to_string(), "ok".to_string())]);
        assert_eq!(loaded.refused, ["PATH", "TERM", "TOO_MANY_TERMINALS_PIPE"]);
    }

    #[test]
    fn missing_file_loads_nothing() {
        let dir = tempfile::tempdir().unwrap();
        assert!(load(dir.path()).is_none());
    }

    #[test]
    fn a_directory_named_dot_env_reads_as_unreadable() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join(".env")).unwrap();
        let loaded = load(dir.path()).unwrap();
        assert!(loaded.unreadable);
        assert!(loaded.pairs.is_empty());
    }


}
