use serde::Serialize;
use std::path::Path;

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
    std::fs::read_to_string(path).map_err(|_| "Not a text file".to_string())
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
