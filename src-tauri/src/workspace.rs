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
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceState {
    pub cwd: Option<String>,
    pub collapsed: bool,
    pub tabs: Vec<SavedTab>,
}

/// Directory the workspace file lives in (config dir keeps it out of the way
/// of transcripts under the home-relative `~/.claude`).
pub fn config_dir() -> Option<PathBuf> {
    dirs::config_dir().map(|d| d.join("claude-terminal"))
}

fn workspace_path(root: &Path) -> PathBuf {
    root.join("workspace.json")
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
            cwd: Some("/home/x/project".to_string()),
            collapsed: true,
            tabs: vec![
                SavedTab {
                    kind: "claude".to_string(),
                    name: "Claude".to_string(),
                    shell_id: None,
                    resume_session_id: Some("sess-1".to_string()),
                },
                SavedTab {
                    kind: "powershell".to_string(),
                    name: "PowerShell".to_string(),
                    shell_id: Some("powershell".to_string()),
                    resume_session_id: None,
                },
            ],
        };

        save_workspace(tmp.path(), &state).unwrap();
        assert_eq!(load_workspace(tmp.path()), state);
    }

    #[test]
    fn save_creates_missing_directory() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("nested").join("dir");
        save_workspace(&root, &WorkspaceState::default()).unwrap();
        assert!(workspace_path(&root).exists());
    }
}
