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

/// A file's share of a change: lines added and deleted. Binary files count 0.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileStat {
    pub path: String,
    pub code: String,
    pub added: u32,
    pub deleted: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    pub oid: String,
    pub short: String,
    pub parents: Vec<String>,
    /// Branch and tag names pointing here (`git log %D`), HEAD first.
    pub refs: Vec<String>,
    pub subject: String,
    /// Unix seconds.
    pub time: i64,
    pub files: Vec<FileStat>,
}

/// What changed in a folder: the working tree against HEAD, and the commits
/// since `since` (the session's starting point), newest first.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitChanges {
    pub uncommitted: Vec<FileStat>,
    pub commits: Vec<GitCommit>,
    /// `since` is no longer an ancestor of HEAD (a reset, a branch switch):
    /// the commits can't be told apart, so none are listed.
    pub diverged: bool,
}

/// The full commit id of HEAD — recorded when a session starts.
pub fn head_oid(dir: &Path) -> Option<String> {
    let out = git(dir).args(["rev-parse", "HEAD"]).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn is_oid(s: &str) -> bool {
    (4..=64).contains(&s.len()) && s.chars().all(|c| c.is_ascii_hexdigit())
}

/// Commits shown at most — a session that made more is reviewed elsewhere.
const MAX_COMMITS: usize = 100;
const SEP: char = '\u{1f}';
const REC: char = '\u{1e}';

pub fn changes(dir: &Path, since: Option<&str>) -> Option<GitChanges> {
    let st = status(dir)?;
    let codes: std::collections::HashMap<&str, &str> = st.files.iter().map(|f| (f.path.as_str(), f.code.as_str())).collect();
    let mut uncommitted = Vec::new();
    if st.head.is_some() {
        let out = git(dir).args(["-c", "core.quotepath=off", "diff", "HEAD", "--numstat", "-M"]).output().ok()?;
        for line in String::from_utf8_lossy(&out.stdout).lines() {
            if let Some(f) = parse_numstat(line) {
                let code = codes.get(f.path.as_str()).copied().unwrap_or("M").to_string();
                uncommitted.push(FileStat { code, ..f });
            }
        }
    }
    // Untracked files have no diff against HEAD; their size is their line count.
    let root = Path::new(&st.root);
    for f in st.files.iter().filter(|f| f.code == "U" && !f.path.ends_with('/')) {
        let added = std::fs::metadata(root.join(&f.path))
            .ok()
            .filter(|m| m.len() < 1_000_000)
            .and_then(|_| std::fs::read(root.join(&f.path)).ok())
            .map(|b| if b.contains(&0) { 0 } else { bytecount_lines(&b) })
            .unwrap_or(0);
        uncommitted.push(FileStat { path: f.path.clone(), code: "U".into(), added, deleted: 0 });
    }
    for f in st.files.iter().filter(|f| f.code == "U" && f.path.ends_with('/')) {
        uncommitted.push(FileStat { path: f.path.clone(), code: "U".into(), added: 0, deleted: 0 });
    }
    uncommitted.sort_by(|a, b| (b.added + b.deleted).cmp(&(a.added + a.deleted)));

    let mut commits = Vec::new();
    let mut diverged = false;
    if let (Some(since), Some(_)) = (since.filter(|s| is_oid(s)), st.head.as_ref()) {
        let ancestor = git(dir).args(["merge-base", "--is-ancestor", since, "HEAD"]).status().map(|s| s.success()).unwrap_or(false);
        if ancestor {
            let format = format!("--format={REC}%H{SEP}%h{SEP}%P{SEP}%D{SEP}%ct{SEP}%s");
            let out = git(dir)
                .args(["-c", "core.quotepath=off", "log", &format, "--numstat", "-M", "-n", &MAX_COMMITS.to_string()])
                .arg(format!("{since}..HEAD"))
                .output()
                .ok()?;
            commits = parse_log(&String::from_utf8_lossy(&out.stdout));
        } else {
            diverged = true;
        }
    }
    Some(GitChanges { uncommitted, commits, diverged })
}

fn bytecount_lines(b: &[u8]) -> u32 {
    let n = b.iter().filter(|&&c| c == b'\n').count();
    (n + usize::from(!b.is_empty() && *b.last().unwrap() != b'\n')) as u32
}

/// `12\t3\tpath` (or `-\t-\tpath` for a binary file). A rename reads
/// `old => new` or `dir/{old => new}/f`; the new path is what's on disk.
fn parse_numstat(line: &str) -> Option<FileStat> {
    let mut parts = line.splitn(3, '\t');
    let added = parts.next()?.parse().unwrap_or(0);
    let deleted = parts.next()?.parse().unwrap_or(0);
    let raw = parts.next()?;
    let path = if let (Some(open), Some(close)) = (raw.find('{'), raw.find('}')) {
        let inner = &raw[open + 1..close];
        let new = inner.split(" => ").nth(1).unwrap_or(inner);
        format!("{}{}{}", &raw[..open], new, &raw[close + 1..]).replace("//", "/")
    } else if let Some((_, new)) = raw.split_once(" => ") {
        new.to_string()
    } else {
        raw.to_string()
    };
    let code = if raw.contains(" => ") { "R" } else { "M" };
    Some(FileStat { path, code: code.into(), added, deleted })
}

fn parse_log(text: &str) -> Vec<GitCommit> {
    text.split(REC)
        .filter(|r| !r.trim().is_empty())
        .filter_map(|rec| {
            let mut lines = rec.lines();
            let head: Vec<&str> = lines.next()?.split(SEP).collect();
            if head.len() < 6 {
                return None;
            }
            let files = lines.filter_map(parse_numstat).collect();
            Some(GitCommit {
                oid: head[0].into(),
                short: head[1].into(),
                parents: head[2].split_whitespace().map(str::to_string).collect(),
                refs: parse_refs(head[3]),
                time: head[4].parse().unwrap_or(0),
                subject: head[5..].join(&SEP.to_string()),
                files,
            })
        })
        .collect()
}

/// `HEAD -> main, origin/main, tag: v1` → `["HEAD", "main", "origin/main", "v1"]`.
fn parse_refs(d: &str) -> Vec<String> {
    d.split(", ")
        .filter(|r| !r.is_empty())
        .flat_map(|r| {
            if let Some(branch) = r.strip_prefix("HEAD -> ") {
                vec!["HEAD".to_string(), branch.to_string()]
            } else {
                vec![r.trim_start_matches("tag: ").to_string()]
            }
        })
        .filter(|r| !r.ends_with("/HEAD"))
        .collect()
}

/// Recent history across local and remote branches, newest first in topo
/// order — enough to draw how the branches fork and merge.
pub fn graph(dir: &Path, limit: usize) -> Option<Vec<GitCommit>> {
    let format = format!("--format={REC}%H{SEP}%h{SEP}%P{SEP}%D{SEP}%ct{SEP}%s");
    let out = git(dir)
        .args(["log", "--topo-order", &format, "-n", &limit.min(300).to_string(), "--branches", "--remotes", "--tags", "HEAD"])
        .output()
        .ok()?;
    out.status.success().then(|| parse_log(&String::from_utf8_lossy(&out.stdout)))
}

/// One file's diff: in `commit` when given, else the working tree against
/// HEAD (an untracked file diffs against nothing). Capped, because a diff
/// pane is for reading, and a 20 MB lockfile diff isn't.
pub fn file_diff(dir: &Path, path: &str, commit: Option<&str>) -> Option<String> {
    if path.starts_with('-') || commit.is_some_and(|c| !is_oid(c)) {
        return None;
    }
    let out = match commit {
        Some(c) => git(dir).args(["show", "--format=", "--patch", "-M", c, "--", path]).output().ok()?,
        None => {
            let tracked = git(dir).args(["diff", "HEAD", "-M", "--", path]).output().ok()?;
            if tracked.stdout.is_empty() {
                git(dir).args(["diff", "--no-index", "--", null_device(), path]).output().ok()?
            } else {
                tracked
            }
        }
    };
    let mut text = String::from_utf8_lossy(&out.stdout).into_owned();
    const CAP: usize = 400_000;
    if text.len() > CAP {
        let mut cut = CAP;
        while !text.is_char_boundary(cut) { cut -= 1; }
        text.truncate(cut);
        text.push_str("\n… diff truncated\n");
    }
    Some(text)
}

fn null_device() -> &'static str {
    if cfg!(windows) { "NUL" } else { "/dev/null" }
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
    fn numstat_lines_and_renames() {
        assert_eq!(parse_numstat("12\t3\tsrc/a.ts").unwrap(), FileStat { path: "src/a.ts".into(), code: "M".into(), added: 12, deleted: 3 });
        assert_eq!(parse_numstat("-\t-\tlogo.png").unwrap().added, 0);
        assert_eq!(parse_numstat("0\t0\tsrc/{old => new}/f.ts").unwrap().path, "src/new/f.ts");
        assert_eq!(parse_numstat("1\t1\ta.ts => b.ts").unwrap().code, "R");
    }

    #[test]
    fn log_records_with_refs_and_files() {
        let text = format!(
            "{REC}aaa{SEP}aa{SEP}bbb ccc{SEP}HEAD -> main, origin/main, origin/HEAD, tag: v1{SEP}100{SEP}feat: x\n\n3\t1\tsrc/a.ts\n{REC}bbb{SEP}bb{SEP}{SEP}{SEP}90{SEP}init\n"
        );
        let c = parse_log(&text);
        assert_eq!(c.len(), 2);
        assert_eq!(c[0].parents, ["bbb", "ccc"]);
        assert_eq!(c[0].refs, ["HEAD", "main", "origin/main", "v1"]);
        assert_eq!(c[0].files[0].added, 3);
        assert!(c[1].parents.is_empty());
    }

    #[test]
    fn a_real_session_since_its_start() {
        let tmp = tempfile::tempdir().unwrap();
        let d = tmp.path();
        let run = |args: &[&str]| git(d).args(args).env("GIT_AUTHOR_NAME", "t").env("GIT_AUTHOR_EMAIL", "t@t").env("GIT_COMMITTER_NAME", "t").env("GIT_COMMITTER_EMAIL", "t@t").output();
        if run(&["init", "-q"]).map(|o| !o.status.success()).unwrap_or(true) {
            return;
        }
        std::fs::write(d.join("a.txt"), "1\n").unwrap();
        run(&["add", "."]).unwrap();
        run(&["commit", "-qm", "start"]).unwrap();
        let start = head_oid(d).unwrap();
        std::fs::write(d.join("a.txt"), "1\n2\n").unwrap();
        run(&["commit", "-qam", "second"]).unwrap();
        std::fs::write(d.join("a.txt"), "1\n2\n3\n").unwrap();
        std::fs::write(d.join("new.txt"), "x\ny\n").unwrap();

        let c = changes(d, Some(&start)).unwrap();
        assert_eq!(c.commits.len(), 1);
        assert_eq!(c.commits[0].subject, "second");
        assert_eq!(c.commits[0].files[0].added, 1);
        let un: Vec<_> = c.uncommitted.iter().map(|f| (f.path.as_str(), f.code.as_str(), f.added)).collect();
        assert_eq!(un, [("new.txt", "U", 2), ("a.txt", "M", 1)]);
        assert!(file_diff(d, "a.txt", None).unwrap().contains("+3"));
        assert!(file_diff(d, "new.txt", None).unwrap().contains("+y"));
        assert_eq!(graph(d, 10).unwrap().len(), 2);
        assert!(file_diff(d, "--output=x", None).is_none());
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
