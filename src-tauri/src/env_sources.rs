//! Answers "what credentials will a session opened here actually have, and
//! where does each one come from?"
//!
//! Four files can contribute, and only one of them is ours:
//!
//! | Source | Reaches | Applied by |
//! |---|---|---|
//! | `<cwd>/.env` | every tab, shell included | this app (`dotenv` + `pty_spawn`) |
//! | `~/.claude/settings.json` | Claude tabs only | Claude Code |
//! | `<cwd>/.claude/settings.json` | Claude tabs only | Claude Code |
//! | `<cwd>/.claude/settings.local.json` | Claude tabs only | Claude Code |
//!
//! The app deliberately does **not** apply the `settings.json` blocks itself.
//! Claude Code already does, and doing it again here would push
//! Claude-scoped credentials into shell tabs, which is not what those files
//! mean. This module only *reports* them, so the sidebar and the spawn receipt
//! stop under-reporting what a session is holding.
//!
//! Names only throughout — no value is ever read out of a settings file.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::dotenv::DotEnv;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Source {
    DotEnv,
    Global,
    Project,
    Local,
}

impl Source {
    /// How the source is named in the terminal receipt and the sidebar tooltip.
    pub fn label(self) -> &'static str {
        match self {
            Source::DotEnv => ".env",
            Source::Global => "~/.claude/settings.json",
            Source::Project => ".claude/settings.json",
            Source::Local => ".claude/settings.local.json",
        }
    }

    /// Serialized name the frontend switches on.
    pub fn key(self) -> &'static str {
        match self {
            Source::DotEnv => "dotenv",
            Source::Global => "global",
            Source::Project => "project",
            Source::Local => "local",
        }
    }

    /// Whether the source belongs to *this folder*. The global settings file
    /// applies to every folder equally, so it must not be what lights the
    /// sidebar glyph — an icon on all eight folders distinguishes nothing.
    pub fn is_folder_scoped(self) -> bool {
        self != Source::Global
    }
}

pub struct Collected {
    /// Every variable a session here will hold, with the source that *wins*
    /// for that name. Alphabetical.
    pub vars: Vec<(String, Source)>,
    /// Reserved names the `.env` tried to set (see `dotenv`).
    pub refused: Vec<String>,
    /// The folder has a `.env` that couldn't be read.
    pub dotenv_unreadable: bool,
}

fn global_settings_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude").join("settings.json"))
}

/// Key names in a settings file's `env` block. Missing file, unparseable JSON
/// and a missing `env` key are all just "nothing here" — this is a display
/// path, and it must never be the reason a tab fails to open.
fn settings_env_names(path: &Path) -> Vec<String> {
    let Ok(text) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    let Ok(value) = serde_json::from_str::<Value>(&text) else {
        return Vec::new();
    };
    value
        .get("env")
        .and_then(Value::as_object)
        .map(|env| env.keys().cloned().collect())
        .unwrap_or_default()
}

/// Merges the four sources in the order Claude Code actually resolves them,
/// weakest first: our `.env` goes onto the process environment, then Claude
/// Code applies user → project → local on top inside its own process. So a
/// name set in two places is reported against the strongest one.
///
/// Takes the already-parsed `.env` rather than re-reading it, since `pty_spawn`
/// has one in hand to apply.
pub fn collect(cwd: &Path, dotenv: Option<&DotEnv>) -> Collected {
    let mut winner: BTreeMap<String, Source> = BTreeMap::new();

    if let Some(loaded) = dotenv {
        for (name, _) in &loaded.pairs {
            winner.insert(name.clone(), Source::DotEnv);
        }
    }

    let claude_dir = cwd.join(".claude");
    let candidates = [
        (Source::Global, global_settings_path()),
        (Source::Project, Some(claude_dir.join("settings.json"))),
        (Source::Local, Some(claude_dir.join("settings.local.json"))),
    ];
    for (source, path) in candidates {
        let Some(path) = path else { continue };
        for name in settings_env_names(&path) {
            winner.insert(name, source);
        }
    }

    Collected {
        vars: winner.into_iter().collect(),
        refused: dotenv.map(|d| d.refused.clone()).unwrap_or_default(),
        dotenv_unreadable: dotenv.is_some_and(|d| d.unreadable),
    }
}

impl Collected {
    /// Names contributed by one source, in the merged view (so a name shadowed
    /// by a stronger source doesn't appear under the weaker one).
    pub fn from_source(&self, source: Source) -> Vec<&str> {
        self.vars
            .iter()
            .filter(|(_, s)| *s == source)
            .map(|(name, _)| name.as_str())
            .collect()
    }

    /// True when this folder contributes credentials of its own — the sidebar
    /// glyph's rule. A folder whose only variables come from the global
    /// settings file gets no glyph, because every folder would get one.
    pub fn has_folder_scoped(&self) -> bool {
        self.dotenv_unreadable || self.vars.iter().any(|(_, s)| s.is_folder_scoped())
    }

    /// The dim block written into the terminal at spawn, one line per source.
    /// `claude` gates the `settings.json` sources: they only reach Claude
    /// tabs, so claiming them on a shell tab would be a lie.
    pub fn receipt(&self, claude: bool) -> String {
        let mut lines: Vec<String> = Vec::new();

        if self.dotenv_unreadable {
            lines.push(".env → couldn't read the file".to_string());
        } else {
            let names = self.from_source(Source::DotEnv);
            if !names.is_empty() || !self.refused.is_empty() {
                let mut head = format!(".env → {} applied", names.len());
                if !self.refused.is_empty() {
                    head.push_str(&format!(" · {} refused (reserved)", self.refused.join(" ")));
                }
                lines.push(head);
                if !names.is_empty() {
                    lines.push(format!("  {}", names.join(" ")));
                }
            }
        }

        if claude {
            for source in [Source::Local, Source::Project, Source::Global] {
                let names = self.from_source(source);
                if names.is_empty() {
                    continue;
                }
                lines.push(format!(
                    "{} → {} (applied by Claude Code)",
                    source.label(),
                    names.len()
                ));
                lines.push(format!("  {}", names.join(" ")));
            }
        }

        if lines.is_empty() {
            return String::new();
        }
        format!("\x1b[2m{}\x1b[0m\r\n\r\n", lines.join("\r\n"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_settings(dir: &Path, file: &str, json: &str) {
        let claude = dir.join(".claude");
        std::fs::create_dir_all(&claude).unwrap();
        std::fs::write(claude.join(file), json).unwrap();
    }

    fn names(collected: &Collected) -> Vec<&str> {
        collected.vars.iter().map(|(n, _)| n.as_str()).collect()
    }

    #[test]
    fn merges_dotenv_and_both_project_settings_files() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(".env"), "FROM_DOTENV=x\n").unwrap();
        write_settings(dir.path(), "settings.json", r#"{"env":{"FROM_PROJECT":"y"}}"#);
        write_settings(dir.path(), "settings.local.json", r#"{"env":{"FROM_LOCAL":"z"}}"#);

        let loaded = crate::dotenv::load(dir.path());
        let collected = collect(dir.path(), loaded.as_ref());

        assert_eq!(names(&collected), ["FROM_DOTENV", "FROM_LOCAL", "FROM_PROJECT"]);
        assert_eq!(collected.from_source(Source::DotEnv), ["FROM_DOTENV"]);
        assert_eq!(collected.from_source(Source::Project), ["FROM_PROJECT"]);
        assert_eq!(collected.from_source(Source::Local), ["FROM_LOCAL"]);
    }

    #[test]
    fn a_stronger_source_shadows_a_weaker_one() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(".env"), "SHARED=from-dotenv\n").unwrap();
        write_settings(dir.path(), "settings.json", r#"{"env":{"SHARED":"y"}}"#);
        write_settings(dir.path(), "settings.local.json", r#"{"env":{"SHARED":"z"}}"#);

        let loaded = crate::dotenv::load(dir.path());
        let collected = collect(dir.path(), loaded.as_ref());

        // Reported once, against the file that actually wins.
        assert_eq!(names(&collected), ["SHARED"]);
        assert_eq!(collected.from_source(Source::Local), ["SHARED"]);
        assert!(collected.from_source(Source::DotEnv).is_empty());
        assert!(collected.from_source(Source::Project).is_empty());
    }

    #[test]
    fn unparseable_or_env_less_settings_contribute_nothing() {
        let dir = tempfile::tempdir().unwrap();
        write_settings(dir.path(), "settings.json", "{ not json at all");
        write_settings(dir.path(), "settings.local.json", r#"{"hooks":{"Stop":[]}}"#);

        let collected = collect(dir.path(), None);
        assert!(collected.vars.is_empty());
    }

    #[test]
    fn folder_scope_drives_the_glyph() {
        let dir = tempfile::tempdir().unwrap();
        write_settings(dir.path(), "settings.json", r#"{"env":{"FROM_PROJECT":"y"}}"#);
        assert!(collect(dir.path(), None).has_folder_scoped());

        // A folder with nothing of its own — whatever the global file holds,
        // this must stay false or every folder lights up.
        let empty = tempfile::tempdir().unwrap();
        let collected = collect(empty.path(), None);
        assert!(collected.vars.iter().all(|(_, s)| *s == Source::Global));
        assert!(!collected.has_folder_scoped());
    }

    #[test]
    fn receipt_separates_sources_and_never_prints_values() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(".env"), "API_KEY=supersecret\nPATH=/nope\n").unwrap();
        write_settings(dir.path(), "settings.local.json", r#"{"env":{"CLAUDE_ONLY":"topsecret"}}"#);

        let loaded = crate::dotenv::load(dir.path());
        let receipt = collect(dir.path(), loaded.as_ref()).receipt(true);

        assert!(receipt.contains(".env → 1 applied"), "{receipt}");
        assert!(receipt.contains("PATH refused (reserved)"), "{receipt}");
        assert!(receipt.contains(".claude/settings.local.json → 1 (applied by Claude Code)"), "{receipt}");
        assert!(receipt.contains("CLAUDE_ONLY"), "{receipt}");
        assert!(!receipt.contains("supersecret"));
        assert!(!receipt.contains("topsecret"));
    }

    #[test]
    fn a_shell_tab_is_not_told_about_settings_json() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(".env"), "API_KEY=x\n").unwrap();
        write_settings(dir.path(), "settings.local.json", r#"{"env":{"CLAUDE_ONLY":"y"}}"#);

        let loaded = crate::dotenv::load(dir.path());
        let receipt = collect(dir.path(), loaded.as_ref()).receipt(false);

        // Those variables genuinely don't reach a shell tab.
        assert!(receipt.contains("API_KEY"), "{receipt}");
        assert!(!receipt.contains("CLAUDE_ONLY"), "{receipt}");
    }

    #[test]
    fn receipt_is_empty_when_the_folder_contributes_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let collected = Collected { vars: Vec::new(), refused: Vec::new(), dotenv_unreadable: false };
        assert!(collected.receipt(true).is_empty());
        // And with no files at all, nothing folder-scoped to print.
        assert!(collect(dir.path(), None).from_source(Source::DotEnv).is_empty());
    }
}
