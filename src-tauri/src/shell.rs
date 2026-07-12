use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform {
    Windows,
    MacOs,
    Linux,
}

impl Platform {
    pub fn current() -> Self {
        if cfg!(target_os = "windows") {
            Platform::Windows
        } else if cfg!(target_os = "macos") {
            Platform::MacOs
        } else {
            Platform::Linux
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ShellOption {
    pub id: &'static str,
    pub label: &'static str,
    pub command: &'static str,
}

/// All shell options for a platform (may not all be installed).
pub fn all_shell_options(platform: Platform) -> Vec<ShellOption> {
    match platform {
        Platform::Windows => vec![
            ShellOption { id: "powershell", label: "PowerShell", command: "powershell.exe" },
            ShellOption { id: "cmd", label: "Command Prompt", command: "cmd.exe" },
        ],
        Platform::MacOs => vec![
            ShellOption { id: "zsh", label: "Zsh", command: "/bin/zsh" },
            ShellOption { id: "bash", label: "Bash", command: "/bin/bash" },
        ],
        Platform::Linux => vec![
            ShellOption { id: "bash", label: "Bash", command: "/bin/bash" },
            ShellOption { id: "zsh", label: "Zsh", command: "/usr/bin/zsh" },
            ShellOption { id: "fish", label: "Fish", command: "/usr/bin/fish" },
        ],
    }
}

pub fn shell_option(platform: Platform, shell_id: &str) -> Option<ShellOption> {
    all_shell_options(platform).into_iter().find(|s| s.id == shell_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_has_powershell_and_cmd() {
        let ids: Vec<_> = all_shell_options(Platform::Windows).iter().map(|s| s.id).collect();
        assert_eq!(ids, vec!["powershell", "cmd"]);
    }

    #[test]
    fn macos_has_zsh_and_bash() {
        let ids: Vec<_> = all_shell_options(Platform::MacOs).iter().map(|s| s.id).collect();
        assert_eq!(ids, vec!["zsh", "bash"]);
    }

    #[test]
    fn linux_has_bash_zsh_fish() {
        let ids: Vec<_> = all_shell_options(Platform::Linux).iter().map(|s| s.id).collect();
        assert_eq!(ids, vec!["bash", "zsh", "fish"]);
    }

    #[test]
    fn lookup_by_id() {
        assert_eq!(shell_option(Platform::Windows, "cmd").unwrap().command, "cmd.exe");
        assert!(shell_option(Platform::Windows, "wsl").is_none());
        assert!(shell_option(Platform::Linux, "powershell").is_none());
    }
}
