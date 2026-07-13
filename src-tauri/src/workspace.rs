use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SavedTab {
    /// "claude" | a shell id from shell.rs
    pub kind: String,
    pub name: String,
    pub shell_id: Option<String>,
    /// Set once a fresh Claude tab's session id is learned, or copied through
    /// when resuming a past session — lets the tab continue on next launch.
    pub resume_session_id: Option<String>,
    /// Which open project this tab belongs to (multiple folders can be open
    /// at once, each with its own tabs).
    pub cwd: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceState {
    /// Open project folders, in the order they were added.
    pub projects: Vec<String>,
    pub collapsed: bool,
    pub tabs: Vec<SavedTab>,
}

/// Directory the workspace file lives in (config dir keeps it out of the way
/// of transcripts under the home-relative `~/.claude`).
pub fn config_dir() -> Option<PathBuf> {
    dirs::config_dir().map(|d| d.join("too-many-terminals"))
}

/// Config dir used before the app was renamed to Too Many Terminals. A saved
/// workspace here is migrated once into [`config_dir`] on first load.
pub fn legacy_config_dir() -> Option<PathBuf> {
    dirs::config_dir().map(|d| d.join("claude-terminal"))
}

fn workspace_path(root: &Path) -> PathBuf {
    root.join("workspace.json")
}

/// One-time migration after the rename: if `new_root` has no workspace file yet
/// but `legacy_root` does, copy it over so restarting doesn't lose the user's
/// saved folders/tabs. The legacy file is left in place (harmless). Returns
/// whether a copy happened.
pub fn migrate_legacy_workspace(new_root: &Path, legacy_root: &Path) -> bool {
    let new_path = workspace_path(new_root);
    let legacy_path = workspace_path(legacy_root);
    if new_path.exists() || !legacy_path.exists() {
        return false;
    }
    if fs::create_dir_all(new_root).is_err() {
        return false;
    }
    fs::copy(&legacy_path, &new_path).is_ok()
}

/// Reads the saved workspace, or the default (empty) state if there's none
/// yet or the file is unreadable/corrupt.
pub fn load_workspace(root: &Path) -> WorkspaceState {
    fs::read_to_string(workspace_path(root))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save_workspace(root: &Path, state: &WorkspaceState) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    fs::write(workspace_path(root), json).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_loads_default() {
        let tmp = tempfile::tempdir().unwrap();
        let state = load_workspace(tmp.path());
        assert_eq!(state, WorkspaceState::default());
    }

    #[test]
    fn corrupt_file_loads_default() {
        let tmp = tempfile::tempdir().unwrap();
        fs::create_dir_all(tmp.path()).unwrap();
        fs::write(workspace_path(tmp.path()), "not json").unwrap();
        let state = load_workspace(tmp.path());
        assert_eq!(state, WorkspaceState::default());
    }

    #[test]
    fn round_trips_through_save_and_load() {
        let tmp = tempfile::tempdir().unwrap();
        let state = WorkspaceState {
            projects: vec!["/home/x/project".to_string(), "/home/x/other".to_string()],
            collapsed: true,
            tabs: vec![
                SavedTab {
                    kind: "claude".to_string(),
                    name: "Claude".to_string(),
                    shell_id: None,
                    resume_session_id: Some("sess-1".to_string()),
                    cwd: "/home/x/project".to_string(),
                },
                SavedTab {
                    kind: "powershell".to_string(),
                    name: "PowerShell".to_string(),
                    shell_id: Some("powershell".to_string()),
                    resume_session_id: None,
                    cwd: "/home/x/other".to_string(),
                },
            ],
        };

        save_workspace(tmp.path(), &state).unwrap();
        assert_eq!(load_workspace(tmp.path()), state);
    }

    #[test]
    fn migrates_legacy_workspace_when_new_is_absent() {
        let tmp = tempfile::tempdir().unwrap();
        let legacy = tmp.path().join("claude-terminal");
        let new = tmp.path().join("too-many-terminals");
        let state = WorkspaceState {
            projects: vec!["/home/x/project".to_string()],
            collapsed: false,
            tabs: vec![],
        };
        save_workspace(&legacy, &state).unwrap();

        assert!(migrate_legacy_workspace(&new, &legacy));
        assert_eq!(load_workspace(&new), state);
        // Legacy file is left in place.
        assert!(workspace_path(&legacy).exists());
    }

    #[test]
    fn migration_does_not_overwrite_existing_new_workspace() {
        let tmp = tempfile::tempdir().unwrap();
        let legacy = tmp.path().join("claude-terminal");
        let new = tmp.path().join("too-many-terminals");
        let legacy_state = WorkspaceState { collapsed: true, ..Default::default() };
        let new_state = WorkspaceState { collapsed: false, ..Default::default() };
        save_workspace(&legacy, &legacy_state).unwrap();
        save_workspace(&new, &new_state).unwrap();

        assert!(!migrate_legacy_workspace(&new, &legacy));
        assert_eq!(load_workspace(&new), new_state);
    }

    #[test]
    fn migration_is_a_noop_when_legacy_is_missing() {
        let tmp = tempfile::tempdir().unwrap();
        let legacy = tmp.path().join("claude-terminal");
        let new = tmp.path().join("too-many-terminals");
        assert!(!migrate_legacy_workspace(&new, &legacy));
        assert!(!workspace_path(&new).exists());
    }

    #[test]
    fn save_creates_missing_directory() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("nested").join("dir");
        save_workspace(&root, &WorkspaceState::default()).unwrap();
        assert!(workspace_path(&root).exists());
    }
}
