//! Read-only git status for a session's folder: branch, ahead/behind and the
//! changed files. One `git status --porcelain=v2` per call — the app never
//! commits, checks out or fetches. No git, or not a repo, is `None`, not an
//! error: the feature just isn't there. See docs/features/git.md.

use std::path::Path;
use std::process::Command;

use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitFile {
    /// Relative to the repo root, `/`-separated.
    pub path: String,
    /// One letter: M modified, A added, D deleted, R renamed, U untracked,
    /// C conflicted.
    pub code: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    /// The repo's top-level folder.
    pub root: String,
    /// `None` when HEAD is detached.
    pub branch: Option<String>,
    /// Short commit id of HEAD; `None` in a repo with no commits yet.
    pub head: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub files: Vec<GitFile>,
}

/// Enough to mark a file tree; a repo with more changes than this is
/// mid-something big, and listing 50 000 paths helps nobody.
const MAX_FILES: usize = 2000;

pub(crate) fn git(dir: &Path) -> Command {
    let mut command = Command::new("git");
    command.arg("-C").arg(dir).env("GIT_OPTIONAL_LOCKS", "0");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

/// Git status of the repo `dir` is in, or `None` when it isn't in one (or git
/// isn't installed). `GIT_OPTIONAL_LOCKS=0`: a status that refreshes the index
/// would take `index.lock` and could make Claude's own `git commit` in the
/// same folder fail — reading must never get in the way of the session.
pub fn status(dir: &Path) -> Option<GitStatus> {
    let top = git(dir).args(["rev-parse", "--show-toplevel"]).output().ok()?;
    if !top.status.success() {
        return None;
    }
    let root = String::from_utf8_lossy(&top.stdout).trim().to_string();
    let out = git(dir)
        .args(["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=normal"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    Some(parse_status(root, &String::from_utf8_lossy(&out.stdout)))
}

/// Parses `git status --porcelain=v2 --branch -z`. Records are NUL-separated;
/// a rename record (`2 …`) is followed by one more field, its original path.
pub fn parse_status(root: String, text: &str) -> GitStatus {
    let mut s = GitStatus { root, branch: None, head: None, upstream: None, ahead: 0, behind: 0, files: Vec::new() };
    let mut fields = text.split('\0');
    while let Some(rec) = fields.next() {
        if let Some(h) = rec.strip_prefix("# branch.head ") {
            s.branch = (h != "(detached)").then(|| h.to_string());
        } else if let Some(oid) = rec.strip_prefix("# branch.oid ") {
            s.head = (oid != "(initial)").then(|| oid.chars().take(7).collect());
        } else if let Some(u) = rec.strip_prefix("# branch.upstream ") {
            s.upstream = Some(u.to_string());
        } else if let Some(ab) = rec.strip_prefix("# branch.ab ") {
            let mut parts = ab.split(' ');
            s.ahead = parts.next().and_then(|a| a.trim_start_matches('+').parse().ok()).unwrap_or(0);
            s.behind = parts.next().and_then(|b| b.trim_start_matches('-').parse().ok()).unwrap_or(0);
        } else if s.files.len() < MAX_FILES {
            if let Some((code, path)) = parse_entry(rec) {
                if rec.starts_with("2 ") {
                    fields.next(); // the rename's original path
                }
                s.files.push(GitFile { path, code });
            }
        }
    }
    s
}

/// One changed-file record: its letter and its path.
fn parse_entry(rec: &str) -> Option<(String, String)> {
    if let Some(path) = rec.strip_prefix("? ") {
        return Some(("U".into(), path.to_string()));
    }
    // `1 XY sub mH mI mW hH hI path`, `2 XY … X<score> path`, `u XY … path`:
    // the path is everything after a fixed number of space-separated fields,
    // and may itself contain spaces.
    let (kind, skip) = match rec.as_bytes().first()? {
        b'1' => ('1', 8),
        b'2' => ('2', 9),
        b'u' => ('u', 10),
        _ => return None,
    };
    let mut parts = rec.splitn(skip + 1, ' ');
    let xy = parts.nth(1)?;
    let path = parts.nth(skip - 2)?.to_string();
    let code = if kind == 'u' {
        "C"
    } else if kind == '2' {
        "R"
    } else if xy.contains('D') {
        "D"
    } else if xy.contains('A') {
        "A"
    } else {
        "M"
    };
    Some((code.into(), path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_branch_and_files() {
        let text = [
            "# branch.oid 156732f92bff622f4fe374dd0abe161a5992adea",
            "# branch.head feat/x",
            "# branch.upstream origin/feat/x",
            "# branch.ab +2 -1",
            "1 .M N... 100644 100644 100644 aaa bbb src/a b.ts",
            "1 A. N... 000000 100644 100644 000 bbb src/new.ts",
            "1 .D N... 100644 100644 000000 aaa aaa gone.ts",
            "2 R. N... 100644 100644 100644 aaa aaa R100 src/renamed.ts",
            "src/old.ts",
            "u UU N... 100644 100644 100644 100644 a b c clash.ts",
            "? notes.md",
            "",
        ]
        .join("\0");
        let s = parse_status("/repo".into(), &text);
        assert_eq!(s.branch.as_deref(), Some("feat/x"));
        assert_eq!(s.head.as_deref(), Some("156732f"));
        assert_eq!(s.upstream.as_deref(), Some("origin/feat/x"));
        assert_eq!((s.ahead, s.behind), (2, 1));
        let files: Vec<_> = s.files.iter().map(|f| format!("{} {}", f.code, f.path)).collect();
        assert_eq!(files, [
            "M src/a b.ts", "A src/new.ts", "D gone.ts", "R src/renamed.ts", "C clash.ts", "U notes.md",
        ]);
    }

    #[test]
    fn detached_and_empty_repo() {
        let s = parse_status("/r".into(), "# branch.oid (initial)\0# branch.head (detached)\0");
        assert_eq!(s.branch, None);
        assert_eq!(s.head, None);
        assert!(s.files.is_empty());
    }

    #[test]
    fn not_a_repo_is_none() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(status(tmp.path()), None);
    }

    #[test]
    fn reads_a_real_repo() {
        let tmp = tempfile::tempdir().unwrap();
        if git(tmp.path()).arg("init").arg("-q").status().map(|s| !s.success()).unwrap_or(true) {
            return; // no git on this machine
        }
        std::fs::write(tmp.path().join("a.txt"), "x").unwrap();
        let s = status(tmp.path()).unwrap();
        assert_eq!(s.files, [GitFile { path: "a.txt".into(), code: "U".into() }]);
    }
}
