use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// App-wide settings (currently: theming). Lives in `settings.json` next to
/// `workspace.json` — kept separate because the workspace file is rewritten
/// on every tab change. Custom themes are opaque JSON: their shape is owned
/// by the frontend (`src/lib/themes.ts`), which validates on load.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub selected_theme_id: String,
    pub custom_themes: Vec<serde_json::Value>,
    /// Show the per-session bar above the terminal. Missing in older settings
    /// files → filled from `Default` (true), so the bar is opt-out, not opt-in.
    pub show_session_bar: bool,
    /// Show the Terminal/Markdown toggle within the session bar.
    pub show_markdown_toggle: bool,
    /// Fire a desktop notification when an unfocused Claude session needs input
    /// or finishes. Defaults to true (opt-out) so it works out of the box.
    pub notifications_enabled: bool,
    /// Minutes an idle, off-screen Claude session may stay running before it's
    /// auto-slept. 0 disables auto-sleep. Defaults to 15.
    pub auto_sleep_minutes: u32,
    /// How often the sidebar re-reads token usage from disk. Defaults to 60.
    pub usage_refresh_seconds: u32,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            selected_theme_id: "default".to_string(),
            custom_themes: Vec::new(),
            show_session_bar: true,
            show_markdown_toggle: true,
            notifications_enabled: true,
            auto_sleep_minutes: 15,
            usage_refresh_seconds: 60,
        }
    }
}

fn settings_path(root: &Path) -> PathBuf {
    root.join("settings.json")
}

/// Reads saved settings, or the default if there's no file yet or it is
/// unreadable/corrupt.
pub fn load_settings(root: &Path) -> AppSettings {
    fs::read_to_string(settings_path(root))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save_settings(root: &Path, settings: &AppSettings) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(settings_path(root), json).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_loads_default() {
        let tmp = tempfile::tempdir().unwrap();
        let settings = load_settings(tmp.path());
        assert_eq!(settings, AppSettings::default());
        assert_eq!(settings.selected_theme_id, "default");
    }

    #[test]
    fn corrupt_file_loads_default() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(settings_path(tmp.path()), "not json").unwrap();
        assert_eq!(load_settings(tmp.path()), AppSettings::default());
    }

    #[test]
    fn round_trips_through_save_and_load() {
        let tmp = tempfile::tempdir().unwrap();
        let settings = AppSettings {
            selected_theme_id: "my-theme".to_string(),
            custom_themes: vec![serde_json::json!({
                "id": "my-theme",
                "name": "My Theme",
                "colors": { "background": "#101010", "primary": "#ffcc00" }
            })],
            show_session_bar: false,
            show_markdown_toggle: true,
            notifications_enabled: false,
            auto_sleep_minutes: 30,
            usage_refresh_seconds: 300,
        };

        save_settings(tmp.path(), &settings).unwrap();
        assert_eq!(load_settings(tmp.path()), settings);
    }

    #[test]
    fn ui_prefs_default_true_when_absent() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(settings_path(tmp.path()), r#"{"selectedThemeId":"amber"}"#).unwrap();
        let settings = load_settings(tmp.path());
        assert_eq!(settings.selected_theme_id, "amber");
        assert!(settings.show_session_bar);
        assert!(settings.show_markdown_toggle);
        assert!(settings.notifications_enabled);
        assert_eq!(settings.auto_sleep_minutes, 15);
        assert_eq!(settings.usage_refresh_seconds, 60);
    }

    #[test]
    fn missing_fields_fall_back_to_defaults() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(settings_path(tmp.path()), "{}").unwrap();
        assert_eq!(load_settings(tmp.path()), AppSettings::default());
    }

    #[test]
    fn save_creates_missing_directory() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("nested").join("dir");
        save_settings(&root, &AppSettings::default()).unwrap();
        assert!(settings_path(&root).exists());
    }
}
