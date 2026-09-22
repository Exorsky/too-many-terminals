use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

/// To-Dos, stored as opaque JSON next to `workspace.json`.
///
/// Deliberately untyped here, the same way `AppSettings::custom_themes` is:
/// the shape is owned by the frontend (`src/lib/tasks.ts`), which is the only
/// thing that reads a task's fields. Mirroring the struct in Rust would buy
/// nothing but a second place to edit whenever a task grows a field.
fn tasks_path(root: &Path) -> PathBuf {
    root.join("tasks.json")
}

/// Reads saved tasks, or an empty list if there's no file yet or it is
/// unreadable/corrupt — a broken file must not cost you the To-Do view.
pub fn load_tasks(root: &Path) -> Vec<Value> {
    fs::read_to_string(tasks_path(root))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save_tasks(root: &Path, tasks: &[Value]) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(tasks).map_err(|e| e.to_string())?;
    fs::write(tasks_path(root), json).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_loads_empty() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(load_tasks(tmp.path()).is_empty());
    }

    #[test]
    fn corrupt_file_loads_empty() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tasks_path(tmp.path()), "not json").unwrap();
        assert!(load_tasks(tmp.path()).is_empty());
    }

    #[test]
    fn round_trips_through_save_and_load() {
        let tmp = tempfile::tempdir().unwrap();
        let tasks = vec![
            serde_json::json!({ "id": "t1", "title": "Investigate 429s", "done": false }),
            serde_json::json!({ "id": "t2", "title": "Update docs", "done": true, "tags": ["docs"] }),
        ];
        save_tasks(tmp.path(), &tasks).unwrap();
        assert_eq!(load_tasks(tmp.path()), tasks);
    }

    #[test]
    fn save_creates_missing_directory() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("nested").join("dir");
        save_tasks(&root, &[]).unwrap();
        assert!(tasks_path(&root).exists());
    }
}
