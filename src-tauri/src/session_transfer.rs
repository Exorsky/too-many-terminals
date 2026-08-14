//! Handing a Claude Code session to another machine. A "session" is a single
//! transcript file — `~/.claude/projects/<encoded-cwd>/<id>.jsonl` — so transfer
//! is just: copy that file out (export), and drop a received file into the
//! target project's store so `claude --resume <id>` finds it (import). The
//! encoded-cwd differs per machine, so import re-homes the file under the
//! importing machine's path rather than trusting the sender's. See
//! docs/features/session-transfer.md.

use std::fs;
use std::io::{BufRead, BufReader};
use std::path::Path;

use crate::session_history::{encode_project_dir, valid_session_id};

/// Copies a session's transcript out to `dest` (a path the user picked in a save
/// dialog) so it can be handed to a colleague on another machine.
pub fn export_session(
    root: &Path,
    project_dir: &str,
    session_id: &str,
    dest: &Path,
) -> Result<(), String> {
    if !valid_session_id(session_id) {
        return Err(format!("Invalid session id: {session_id}"));
    }
    let src = root
        .join(encode_project_dir(project_dir))
        .join(format!("{session_id}.jsonl"));
    if !src.is_file() {
        return Err("That session's transcript is no longer on disk.".to_string());
    }
    fs::copy(&src, dest).map_err(|e| e.to_string())?;
    Ok(())
}

/// Imports a transcript file received from another machine into `project_dir`'s
/// Claude Code store, re-homed under this machine's encoded path, so
/// `claude --resume <id>` finds it. The session id is the file's own stem;
/// returns it so the caller can open a resumed tab. Overwriting an existing id
/// is fine — same session, same content.
pub fn import_session(root: &Path, project_dir: &str, src: &Path) -> Result<String, String> {
    let session_id = src
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .filter(|s| valid_session_id(s))
        .ok_or("Not a session file — expected a Claude Code <id>.jsonl transcript.")?;

    if !first_line_is_json_object(src) {
        return Err("That file isn't a Claude Code transcript.".to_string());
    }

    let dir = root.join(encode_project_dir(project_dir));
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    fs::copy(src, dir.join(format!("{session_id}.jsonl"))).map_err(|e| e.to_string())?;
    Ok(session_id)
}

/// Light guard against dropping an arbitrary file into the transcript store: the
/// first non-empty line must parse as a JSON object (every Claude Code
/// transcript line is one).
fn first_line_is_json_object(path: &Path) -> bool {
    let Ok(file) = fs::File::open(path) else {
        return false;
    };
    for line in BufReader::new(file).lines().take(50) {
        let Ok(line) = line else { return false };
        if line.trim().is_empty() {
            continue;
        }
        return serde_json::from_str::<serde_json::Value>(&line)
            .map(|v| v.is_object())
            .unwrap_or(false);
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    const LINE: &str = r#"{"type":"user","message":{"content":"hi"}}"#;

    fn write_session(root: &Path, project_dir: &str, id: &str) {
        let dir = root.join(encode_project_dir(project_dir));
        fs::create_dir_all(&dir).unwrap();
        let mut f = fs::File::create(dir.join(format!("{id}.jsonl"))).unwrap();
        writeln!(f, "{LINE}").unwrap();
    }

    #[test]
    fn export_then_import_rehomes_under_the_target_path() {
        let store = tempfile::tempdir().unwrap();
        let out = tempfile::tempdir().unwrap();
        write_session(store.path(), r"C:\Users\alice\proj", "sess-1");

        // Export from machine A's path...
        let bundle = out.path().join("sess-1.jsonl");
        export_session(store.path(), r"C:\Users\alice\proj", "sess-1", &bundle).unwrap();
        assert!(bundle.is_file());

        // ...import into machine B's (different) path.
        let id = import_session(store.path(), "/home/bob/proj", &bundle).unwrap();
        assert_eq!(id, "sess-1");
        let landed = store
            .path()
            .join(encode_project_dir("/home/bob/proj"))
            .join("sess-1.jsonl");
        assert!(landed.is_file());
    }

    #[test]
    fn export_rejects_bad_id_and_missing_file() {
        let store = tempfile::tempdir().unwrap();
        let dest = store.path().join("x.jsonl");
        assert!(export_session(store.path(), "/p", "../evil", &dest).is_err());
        assert!(export_session(store.path(), "/p", "not-there", &dest).is_err());
    }

    #[test]
    fn import_rejects_non_json_and_weirdly_named_files() {
        let store = tempfile::tempdir().unwrap();
        let src = tempfile::tempdir().unwrap();

        // Valid name, but not a transcript.
        let garbage = src.path().join("abc.jsonl");
        fs::write(&garbage, "not json at all\n").unwrap();
        assert!(import_session(store.path(), "/p", &garbage).is_err());

        // A name that isn't a valid session id (spaces, punctuation).
        let bad_name = src.path().join("some notes!.jsonl");
        fs::write(&bad_name, format!("{LINE}\n")).unwrap();
        assert!(import_session(store.path(), "/p", &bad_name).is_err());
    }
}
