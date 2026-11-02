use serde::Serialize;
use std::path::{Component, Path, PathBuf};

/// One entry in a directory listing, as shown by the file explorer.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

/// A file above this size is refused rather than pulled into memory and
/// rendered as text — the explorer opens it in the OS file manager instead.
const MAX_READ_BYTES: u64 = 4 * 1024 * 1024;

/// One level of a directory: folders first, then files, both alphabetical
/// (case-insensitive) — the ordering a file explorer is expected to show.
pub fn list_dir(dir: &Path) -> Result<Vec<DirEntry>, String> {
    let mut entries: Vec<DirEntry> = std::fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| entry.ok())
        .map(|entry| DirEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: entry.path().to_string_lossy().into_owned(),
            is_dir: entry.file_type().map(|t| t.is_dir()).unwrap_or(false),
        })
        .collect();
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

/// Reads a file as UTF-8 text for the file viewer. Refuses oversized or
/// non-text files with a message the UI can show as-is.
pub fn read_text(path: &Path) -> Result<String, String> {
    let meta = std::fs::metadata(path).map_err(|e| e.to_string())?;
    if meta.len() > MAX_READ_BYTES {
        return Err("File is larger than 4 MB — open it outside the app".to_string());
    }
    String::from_utf8(read_capped(path)?).map_err(|_| "Not a text file".to_string())
}

/// Regular files only, and never more than the cap. A hover can now point
/// at anything that exists: `/dev/zero` reports size 0 and never ends, and a
/// FIFO blocks forever.
fn read_capped(path: &Path) -> Result<Vec<u8>, String> {
    use std::io::Read;
    // Checked before opening: opening a FIFO for reading blocks until a
    // writer shows up.
    if !std::fs::metadata(path).map_err(|e| e.to_string())?.is_file() {
        return Err("Not a regular file".to_string());
    }
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    file.take(MAX_READ_BYTES + 1).read_to_end(&mut buf).map_err(|e| e.to_string())?;
    if buf.len() as u64 > MAX_READ_BYTES {
        return Err("File is larger than 4 MB — open it outside the app".to_string());
    }
    Ok(buf)
}

/// Reads a file's raw bytes — an image for a hover preview. Same size cap as
/// text, so a stray multi-GB file can't be pulled into the webview.
pub fn read_bytes(path: &Path) -> Result<Vec<u8>, String> {
    read_capped(path)
}

/// A path named in terminal output or a transcript that exists on disk.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PathInfo {
    /// Absolute, lexically normalized (no `.`/`..`; symlinks left alone).
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
}

/// Resolves each candidate the way a shell in `cwd` would read it — absolute
/// as-is, `~` against `home`, anything else against `cwd` — and keeps the ones
/// that exist. One entry per candidate, `None` where nothing is there, so the
/// caller can zip the answer with what it asked.
pub fn stat_paths(cwd: &Path, home: Option<&Path>, candidates: &[String]) -> Vec<Option<PathInfo>> {
    candidates
        .iter()
        .map(|c| {
            let full = match (c.strip_prefix('~'), home) {
                (Some(rest), Some(h)) if rest.is_empty() || rest.starts_with(['/', '\\']) => {
                    h.join(rest.trim_start_matches(['/', '\\']))
                }
                _ => cwd.join(c), // join keeps an absolute `c` as it is
            };
            let full = normalize(&full);
            let meta = std::fs::metadata(&full).ok()?;
            Some(PathInfo {
                path: full.to_string_lossy().into_owned(),
                is_dir: meta.is_dir(),
                size: meta.len(),
            })
        })
        .collect()
}

/// Drops `.` and folds `..` without touching the disk, so `src/../x` shows as
/// `x` and `/tmp` stays `/tmp` (canonicalize would make it `/private/tmp`).
fn normalize(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other),
        }
    }
    out
}

/// Overwrites an existing file with editor contents. `root` must be the open
/// project folder the file was opened from — canonicalizing both sides and
/// checking containment closes off `../` and symlink escapes, since this is
/// the one call in the app that writes wherever it's pointed.
pub fn write_text(path: &Path, root: &Path, contents: &str) -> Result<(), String> {
    let real_root = root.canonicalize().map_err(|e| e.to_string())?;
    let real_path = path.canonicalize().map_err(|e| e.to_string())?;
    if !real_path.starts_with(&real_root) {
        return Err("File is outside the open project folder".to_string());
    }
    std::fs::write(real_path, contents).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_dirs_before_files_case_insensitively() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir(tmp.path().join("Zeta")).unwrap();
        std::fs::create_dir(tmp.path().join("alpha")).unwrap();
        std::fs::write(tmp.path().join("readme.md"), "hi").unwrap();
        std::fs::write(tmp.path().join("App.tsx"), "hi").unwrap();

        let entries = list_dir(tmp.path()).unwrap();
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["alpha", "Zeta", "App.tsx", "readme.md"]);
        assert!(entries[0].is_dir);
        assert!(!entries[2].is_dir);
    }

    #[test]
    fn reads_text_file_contents() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("hello.txt");
        std::fs::write(&file, "hello world").unwrap();
        assert_eq!(read_text(&file).unwrap(), "hello world");
    }

    #[test]
    fn refuses_oversized_file() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("big.txt");
        std::fs::write(&file, vec![b'a'; (MAX_READ_BYTES + 1) as usize]).unwrap();
        assert!(read_text(&file).is_err());
    }

    #[test]
    fn refuses_binary_file() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("bin.dat");
        std::fs::write(&file, [0xff, 0xfe, 0x00, 0xff, 0x00, 0x01]).unwrap();
        assert!(read_text(&file).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn refuses_device_files_and_fifos() {
        assert!(read_text(Path::new("/dev/zero")).is_err());
        assert!(read_bytes(Path::new("/dev/zero")).is_err());
        let tmp = tempfile::tempdir().unwrap();
        let fifo = tmp.path().join("pipe");
        let made = std::process::Command::new("mkfifo").arg(&fifo).status().unwrap();
        assert!(made.success());
        assert!(read_text(&fifo).is_err()); // returns, rather than waiting for a writer
        assert!(read_bytes(&fifo).is_err());
    }

    #[test]
    fn stats_only_paths_that_exist() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tempfile::tempdir().unwrap();
        std::fs::create_dir(tmp.path().join("src")).unwrap();
        std::fs::write(tmp.path().join("src/a.ts"), "abc").unwrap();
        std::fs::write(home.path().join("notes.md"), "x").unwrap();
        let abs = tmp.path().join("src/a.ts").to_string_lossy().into_owned();
        let ask: Vec<String> = ["src/a.ts", "./src/../src", "and/or", "~/notes.md", &abs]
            .iter()
            .map(|s| s.to_string())
            .collect();

        let got = stat_paths(tmp.path(), Some(home.path()), &ask);

        let file = got[0].as_ref().unwrap();
        assert_eq!(file.path, abs);
        assert!(!file.is_dir);
        assert_eq!(file.size, 3);
        let dir = got[1].as_ref().unwrap();
        assert!(dir.is_dir);
        assert_eq!(dir.path, tmp.path().join("src").to_string_lossy());
        assert!(got[2].is_none());
        assert_eq!(got[3].as_ref().unwrap().path, home.path().join("notes.md").to_string_lossy());
        assert_eq!(got[4].as_ref().unwrap().path, abs);
    }

    #[test]
    fn writes_a_file_inside_the_root() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("notes.md");
        std::fs::write(&file, "old").unwrap();

        write_text(&file, tmp.path(), "new content").unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "new content");
    }

    #[test]
    fn refuses_to_write_outside_the_root() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let file = outside.path().join("secret.txt");
        std::fs::write(&file, "old").unwrap();

        let err = write_text(&file, root.path(), "new content").unwrap_err();
        assert!(err.contains("outside"));
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "old");
    }
}
