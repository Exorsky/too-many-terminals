//! Which tool calls change something *outside* this machine — a Jira comment,
//! a pushed branch, an MR, a `kubectl apply`, an MCP call that sends or
//! updates. Used live by the PostToolUse hook (the sidebar's write badge) and
//! after the fact by `session_stats` (the inspector's Activity list).
//! Plain Rust, no I/O.
//!
//! ponytail: a word-list heuristic over the command line and the MCP tool
//! name. It misses writes hidden in scripts (`./deploy.sh`) and counts a
//! `curl -d` against a read-only search endpoint. Good enough for "did this
//! session touch anything"; the transcript stays the record.

use serde_json::Value;

const LABEL_MAX_CHARS: usize = 72;
const HTTP_WRITE_VERBS: [&str; 4] = ["POST", "PUT", "PATCH", "DELETE"];

/// Words in an MCP tool name that mean it changes state. Matched against the
/// tool name split on `_`/`-`, so `users_suspend` and `outlook_send_mail` hit
/// while `users_get` and `list_members` don't.
const MCP_WRITE_WORDS: [&str; 38] = [
    "create", "update", "delete", "remove", "add", "send", "post", "reply", "assign", "revoke", "reset",
    "suspend", "unsuspend", "undelete", "transfer", "move", "rename", "set", "modify", "trash", "untrash",
    "upload", "forward", "invalidate", "issue", "turn", "change", "edit", "write", "comment", "transition",
    "merge", "approve", "publish", "share", "unshare", "respond", "copy",
];

/// A short label for a tool call that writes outside the machine, or `None`
/// for a read, a local edit, or anything unrecognised.
pub fn write_label(tool_name: &str, input: Option<&Value>) -> Option<String> {
    if tool_name == "Bash" || tool_name == "PowerShell" {
        let command = input?.get("command")?.as_str()?;
        return command_segments(command).find(|s| segment_writes(s)).map(|s| truncate(s, LABEL_MAX_CHARS));
    }
    let rest = tool_name.strip_prefix("mcp__")?;
    let (server, tool) = rest.split_once("__")?;
    let writes = tool.to_lowercase().split(['_', '-']).any(|w| MCP_WRITE_WORDS.contains(&w));
    writes.then(|| truncate(&format!("{} · {tool}", server.trim_start_matches("claude_ai_")), LABEL_MAX_CHARS))
}

/// The individual commands of a shell line: `a && b | c; d` → a, b, c, d.
fn command_segments(command: &str) -> impl Iterator<Item = &str> {
    command.split(['\n', ';', '|', '&']).map(str::trim).filter(|s| !s.is_empty())
}

fn segment_writes(segment: &str) -> bool {
    let tokens: Vec<&str> = segment.split_whitespace().skip_while(|t| *t == "sudo" || t.contains('=')).collect();
    let Some(first) = tokens.first() else { return false };
    let program = first.rsplit('/').next().unwrap_or(first);
    let has = |words: &[&str]| tokens.iter().skip(1).any(|t| words.contains(t));
    let sub = |i: usize| tokens.get(i).copied().unwrap_or("");

    // `api jira POST …`, `http PUT …`, `curl -X DELETE …`, `glab api -X POST`.
    if tokens.iter().skip(1).any(|t| HTTP_WRITE_VERBS.contains(t)) {
        return true;
    }
    match program {
        "git" => sub(1) == "push",
        "glab" | "gh" => match sub(1) {
            "mr" | "pr" | "issue" => {
                matches!(sub(2), "create" | "merge" | "note" | "comment" | "approve" | "close" | "update" | "edit")
            }
            "release" => sub(2) == "create",
            _ => false,
        },
        "curl" => has(&["-d", "--data", "--data-raw", "--data-binary", "--json", "-F", "--form", "-T"]),
        "kubectl" | "oc" => matches!(
            sub(1),
            "apply" | "create" | "delete" | "patch" | "edit" | "replace" | "scale" | "label" | "annotate" | "set"
                | "rollout" | "cordon" | "drain"
        ),
        "terraform" | "terragrunt" | "tofu" => matches!(sub(1), "apply" | "destroy" | "import"),
        "helm" => matches!(sub(1), "install" | "upgrade" | "uninstall" | "rollback"),
        "aws" => tokens.get(2).is_some_and(|op| {
            ["create-", "delete-", "put-", "update-", "modify-", "terminate-", "attach-", "detach-"]
                .iter()
                .any(|p| op.starts_with(p))
        }),
        "gcloud" | "az" => has(&["create", "delete", "update", "deploy", "set", "add-iam-policy-binding"]),
        _ => false,
    }
}

fn truncate(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let mut out: String = text.chars().take(max - 1).collect();
    out.push('…');
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn bash(command: &str) -> Option<String> {
        write_label("Bash", Some(&json!({ "command": command })))
    }

    #[test]
    fn shell_writes_are_labelled_with_the_command_that_wrote() {
        assert_eq!(bash("git push origin feat/x").as_deref(), Some("git push origin feat/x"));
        assert_eq!(
            bash("cd repo && ~/.claude/bin/api jira POST /rest/api/2/issue/ITA-1/comment '{}'").as_deref(),
            Some("~/.claude/bin/api jira POST /rest/api/2/issue/ITA-1/comment '{}'"),
        );
        for command in [
            "glab mr create --title x",
            "gh pr merge 12",
            "curl -s -X PUT https://x/api",
            "curl https://x -d a=b",
            "kubectl apply -f deploy.yaml",
            "sudo terraform apply",
            "aws ec2 terminate-instances --instance-ids i-1",
            "gcloud run deploy svc",
            "AWS_PROFILE=x helm upgrade app ./chart",
        ] {
            assert!(bash(command).is_some(), "{command}");
        }
    }

    #[test]
    fn reads_and_local_work_are_not_writes() {
        for command in [
            "git status",
            "git commit -m 'x'",
            "api jira GET /rest/api/2/issue/ITA-1",
            "curl -s https://x/api | jq .",
            "kubectl get pods",
            "glab mr view 62",
            "terraform plan",
            "aws ec2 describe-instances",
            "echo POSTED",
            "pnpm test",
        ] {
            assert_eq!(bash(command), None, "{command}");
        }
    }

    #[test]
    fn mcp_tools_write_when_their_name_says_so() {
        assert_eq!(
            write_label("mcp__gws-helpdesk-mcp__users_suspend", None).as_deref(),
            Some("gws-helpdesk-mcp · users_suspend"),
        );
        assert_eq!(
            write_label("mcp__claude_ai_Microsoft_365__outlook_send_mail", None).as_deref(),
            Some("Microsoft_365 · outlook_send_mail"),
        );
        assert_eq!(write_label("mcp__gws-helpdesk-mcp__users_get", None), None);
        assert_eq!(write_label("mcp__gws-helpdesk-mcp__list_members", None), None);
    }

    #[test]
    fn other_tools_are_not_writes() {
        assert_eq!(write_label("Edit", Some(&json!({ "file_path": "/a" }))), None);
        assert_eq!(write_label("Read", None), None);
        assert_eq!(write_label("Bash", None), None);
    }

    #[test]
    fn long_labels_are_truncated() {
        let label = bash(&format!("git push origin {}", "x".repeat(200))).unwrap();
        assert_eq!(label.chars().count(), LABEL_MAX_CHARS);
        assert!(label.ends_with('…'));
    }
}
