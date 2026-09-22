use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SavedTab {
    /// Stable across restarts, so anything that references a session by id —
    /// a linked To-Do, a scratch directory — still points at it next launch.
    /// Empty in files written before it existed; the frontend mints one then.
    #[serde(default)]
    pub id: String,
    /// "claude" | a shell id from shell.rs
    pub kind: String,
    pub name: String,
    pub shell_id: Option<String>,
    /// Set once a fresh Claude tab's session id is learned, or copied through
    /// when resuming a past session — lets the tab continue on next launch.
    pub resume_session_id: Option<String>,
    /// Where the process actually runs. For a project session this is the
    /// project folder; for a scratch session it is its own directory under
    /// `~/.tmt/scratch`, which is never in `projects`.
    pub cwd: String,
    /// Which project this session is *filed under*, independent of `cwd` —
    /// `None` means the Inbox. Absent in older files, where the frontend
    /// derives it: a `cwd` that is an open project is that project, anything
    /// else is Inbox. Kept apart from `cwd` so filing a scratch session under
    /// a project never has to move a live working directory out from under a
    /// running Claude process (its transcript is keyed by path).
    #[serde(default)]
    pub project_dir: Option<String>,
    /// Out of the main list, still on disk and resumable from Archived.
    #[serde(default)]
    pub archived: bool,
    /// User-pinned to the sidebar's Pinned section. Defaulted so workspace
    /// files saved before this field existed still load.
    #[serde(default)]
    pub pinned: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceState {
    /// Open project folders, in the order they were added.
    pub projects: Vec<String>,
    pub collapsed: bool,
    pub tabs: Vec<SavedTab>,
    /// Session id → the name that session was last known by, kept apart from
    /// `tabs` so closing a tab doesn't erase it: History and the sidebar then
    /// call the same session the same thing, and resuming it restores its name
    /// instead of inventing one from the transcript's first line.
    ///
    /// ponytail: never pruned — one short string per session ever opened.
    /// Prune against the transcript files on load if it ever gets big.
    #[serde(default)]
    pub session_names: std::collections::HashMap<String, String>,
    /// Which shape this file is in. Absent (0) means "written before sessions
    /// were filed under projects" and triggers [`migrate`] on load.
    ///
    /// This exists because `Option<String>` cannot tell "the field was missing"
    /// from "the field was null": serde fills the first with `None` and
    /// serializes it back as `null`, so the frontend saw an explicit Inbox for
    /// every session and the migration could never run. A version number says
    /// it outright instead of inferring it from a value.
    #[serde(default)]
    pub schema_version: u32,
}

/// The shape [`migrate`] brings a file up to.
pub const SCHEMA_VERSION: u32 = 1;

/// v0 → v1: sessions gained `project_dir`, and a file written before that has
/// none. Under the old model a session's `cwd` *was* its project, so a `cwd`
/// that is one of the open projects becomes that project and anything else
/// (a scratch directory, a folder since closed) is the Inbox — which is
/// exactly what those sessions already meant. Nothing appears to move.
///
/// Idempotent: a file already at `SCHEMA_VERSION` is left alone, so a session
/// deliberately filed into the Inbox is never dragged back into a project.
pub fn migrate(state: &mut WorkspaceState) {
    if state.schema_version >= SCHEMA_VERSION {
        return;
    }
    let projects: std::collections::HashSet<&str> =
        state.projects.iter().map(String::as_str).collect();
    for tab in &mut state.tabs {
        if tab.project_dir.is_none() && projects.contains(tab.cwd.as_str()) {
            tab.project_dir = Some(tab.cwd.clone());
        }
    }
    state.schema_version = SCHEMA_VERSION;
}

/// Working directory for a scratch session — one per session, under
/// `~/.tmt/scratch`, created on demand.
///
/// Not the config dir: Claude Code keys a transcript by its working directory,
/// so this path ends up in `~/.claude/projects/<slug>` and is read back by
/// History. It wants to be short, stable and legible, which rules out both a
/// platform config path and `/tmp` (cleaned out from under a live session).
pub fn create_scratch_dir(home: &Path, session_id: &str) -> Result<String, String> {
    let dir = home.join(".tmt").join("scratch").join(session_id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
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
/// yet or the file is unreadable/corrupt. Older files are migrated on the way
/// out, so callers only ever see the current shape.
pub fn load_workspace(root: &Path) -> WorkspaceState {
    let mut state: WorkspaceState = fs::read_to_string(workspace_path(root))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    migrate(&mut state);
    state
}

/// Writes the workspace, stamping the current schema version on the way out.
///
/// Stamped here rather than by the caller so the frontend never has to know a
/// version exists — and, more importantly, so a file *we* wrote is never
/// re-migrated: a second migration pass would drag a session the user had
/// deliberately filed into the Inbox back under the project its `cwd` names.
pub fn save_workspace(root: &Path, state: &WorkspaceState) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let stamped = WorkspaceState { schema_version: SCHEMA_VERSION, ..state.clone() };
    let json = serde_json::to_string_pretty(&stamped).map_err(|e| e.to_string())?;
    fs::write(workspace_path(root), json).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `Default` plus the version every loaded file carries.
    fn empty() -> WorkspaceState {
        WorkspaceState { schema_version: SCHEMA_VERSION, ..Default::default() }
    }

    #[test]
    fn missing_file_loads_default() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(load_workspace(tmp.path()), empty());
    }

    #[test]
    fn tab_saved_before_pinned_existed_loads_as_unpinned() {
        let tmp = tempfile::tempdir().unwrap();
        fs::create_dir_all(tmp.path()).unwrap();
        let json = r#"{"projects":["/home/x/project"],"collapsed":false,"tabs":[
            {"kind":"claude","name":"Claude","shellId":null,"resumeSessionId":null,"cwd":"/home/x/project"}
        ]}"#;
        fs::write(workspace_path(tmp.path()), json).unwrap();
        let state = load_workspace(tmp.path());
        assert_eq!(state.tabs[0].pinned, false);
        // Same file predates session_names — it must load as empty, not fail.
        assert!(state.session_names.is_empty());
        // ...and predates the fields the Inbox needs. An absent id is what
        // tells the frontend to mint one.
        assert_eq!(state.tabs[0].id, "");
        // ...and is migrated on load: its cwd is an open project, so that is
        // where it belongs. See `migrate`.
        assert_eq!(state.tabs[0].project_dir.as_deref(), Some("/home/x/project"));
        assert!(!state.tabs[0].archived);
    }

    #[test]
    fn migrates_a_pre_inbox_file_by_filing_sessions_under_their_cwd() {
        let mut state = WorkspaceState {
            projects: vec!["/proj".to_string()],
            tabs: vec![
                SavedTab {
                    id: "a".into(), kind: "claude".into(), name: "Alpha".into(), shell_id: None,
                    resume_session_id: None, cwd: "/proj".into(), project_dir: None,
                    archived: false, pinned: false,
                },
                SavedTab {
                    id: "b".into(), kind: "claude".into(), name: "Loose".into(), shell_id: None,
                    resume_session_id: None, cwd: "/home/u/.tmt/scratch/x".into(),
                    project_dir: None, archived: false, pinned: false,
                },
            ],
            ..Default::default()
        };
        migrate(&mut state);
        assert_eq!(state.tabs[0].project_dir.as_deref(), Some("/proj"));
        // Not an open project, so it was never filed anywhere: the Inbox.
        assert_eq!(state.tabs[1].project_dir, None);
        assert_eq!(state.schema_version, SCHEMA_VERSION);
    }

    #[test]
    fn migration_never_runs_twice_over_a_deliberate_inbox() {
        // Once migrated, a null project_dir means the user put it there. A
        // second pass must not drag it back under the project its cwd names.
        let mut state = WorkspaceState {
            projects: vec!["/proj".to_string()],
            schema_version: SCHEMA_VERSION,
            tabs: vec![SavedTab {
                id: "a".into(), kind: "claude".into(), name: "Alpha".into(), shell_id: None,
                resume_session_id: None, cwd: "/proj".into(), project_dir: None,
                archived: false, pinned: false,
            }],
            ..Default::default()
        };
        migrate(&mut state);
        assert_eq!(state.tabs[0].project_dir, None);
    }

    #[test]
    fn loading_an_old_file_migrates_it() {
        let tmp = tempfile::tempdir().unwrap();
        fs::create_dir_all(tmp.path()).unwrap();
        // Exactly the shape v0.24 wrote: no schemaVersion, no projectDir.
        let json = r#"{"projects":["/home/x/project"],"collapsed":false,"tabs":[
            {"kind":"claude","name":"Claude","shellId":null,"resumeSessionId":null,"cwd":"/home/x/project"}
        ]}"#;
        fs::write(workspace_path(tmp.path()), json).unwrap();
        let state = load_workspace(tmp.path());
        assert_eq!(state.tabs[0].project_dir.as_deref(), Some("/home/x/project"));
        assert_eq!(state.schema_version, SCHEMA_VERSION);
    }

    #[test]
    fn scratch_dir_is_created_under_home() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = create_scratch_dir(tmp.path(), "abc123").unwrap();
        assert!(Path::new(&dir).is_dir());
        assert!(dir.ends_with("abc123"));
        // Idempotent: reopening the same session must not fail.
        assert_eq!(create_scratch_dir(tmp.path(), "abc123").unwrap(), dir);
    }

    #[test]
    fn corrupt_file_loads_default() {
        let tmp = tempfile::tempdir().unwrap();
        fs::create_dir_all(tmp.path()).unwrap();
        fs::write(workspace_path(tmp.path()), "not json").unwrap();
        assert_eq!(load_workspace(tmp.path()), empty());
    }

    #[test]
    fn round_trips_through_save_and_load() {
        let tmp = tempfile::tempdir().unwrap();
        let state = WorkspaceState {
            projects: vec!["/home/x/project".to_string(), "/home/x/other".to_string()],
            collapsed: true,
            tabs: vec![
                SavedTab {
                    id: "tab-1".to_string(),
                    kind: "claude".to_string(),
                    name: "Claude".to_string(),
                    shell_id: None,
                    resume_session_id: Some("sess-1".to_string()),
                    cwd: "/home/x/project".to_string(),
                    project_dir: Some("/home/x/project".to_string()),
                    archived: false,
                    pinned: true,
                },
                SavedTab {
                    id: "tab-2".to_string(),
                    kind: "powershell".to_string(),
                    name: "PowerShell".to_string(),
                    shell_id: Some("powershell".to_string()),
                    resume_session_id: None,
                    cwd: "/home/x/other".to_string(),
                    project_dir: None,
                    archived: true,
                    pinned: false,
                },
            ],
            // Outlives its tab on purpose — "sess-2" has no tab here.
            session_names: [
                ("sess-1".to_string(), "Fixing history".to_string()),
                ("sess-2".to_string(), "A closed session".to_string()),
            ]
            .into_iter()
            .collect(),
            schema_version: SCHEMA_VERSION,
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
            ..Default::default()
        };
        save_workspace(&legacy, &state).unwrap();

        assert!(migrate_legacy_workspace(&new, &legacy));
        assert_eq!(load_workspace(&new), WorkspaceState { schema_version: SCHEMA_VERSION, ..state });
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
        assert_eq!(load_workspace(&new), WorkspaceState { schema_version: SCHEMA_VERSION, ..new_state });
    }

    #[test]
    fn a_file_we_wrote_is_never_migrated_again() {
        // The regression this guards: without the stamp, every launch re-ran
        // the migration and undid "move this session to the Inbox".
        let tmp = tempfile::tempdir().unwrap();
        let state = WorkspaceState {
            projects: vec!["/proj".to_string()],
            tabs: vec![SavedTab {
                id: "a".into(), kind: "claude".into(), name: "Alpha".into(), shell_id: None,
                resume_session_id: None, cwd: "/proj".into(), project_dir: None,
                archived: false, pinned: false,
            }],
            ..Default::default()
        };
        save_workspace(tmp.path(), &state).unwrap();
        assert_eq!(load_workspace(tmp.path()).tabs[0].project_dir, None);
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
