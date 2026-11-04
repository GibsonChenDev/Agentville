//! The coding agents Agentville can observe. Each provider describes where its
//! hooks live and how they reach the receiver; everything else (installing,
//! inspecting, receiving, streaming) is shared. Adding or removing an agent is
//! a change to `ALL` here plus its normalizer in `packages/integrations`.

use std::path::PathBuf;

/// How the agent's hooks reach the receiver.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Transport {
    /// The agent POSTs the hook payload itself (`type: "http"`).
    Http,
    /// The agent runs a command with the payload on stdin (`type: "command"`);
    /// Agentville's own executable forwards it (`--agentville-hook <id>`).
    Command,
}

#[derive(Debug)]
pub struct Provider {
    /// Stable id used in URLs, RPC params and the UI ("claude", "codex").
    pub id: &'static str,
    pub transport: Transport,
    pub events: &'static [&'static str],
    /// Events whose matcher filters tool names; they get a match-all matcher.
    pub tool_events: &'static [&'static str],
    /// Environment variable that overrides the hooks file (development and tests only).
    pub path_override: &'static str,
    /// Default hooks file under the user's home directory.
    default_path: fn(home: PathBuf) -> PathBuf,
}

impl PartialEq for Provider {
    fn eq(&self, other: &Self) -> bool {
        self.id == other.id
    }
}

impl Provider {
    pub fn hooks_path(&self) -> PathBuf {
        std::env::var_os(self.path_override).map(PathBuf::from).unwrap_or_else(|| (self.default_path)(home_dir()))
    }
}

pub fn home_dir() -> PathBuf {
    std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from).unwrap_or_default()
}

/// Claude Code: http hooks in `~/.claude/settings.json`
/// (`%USERPROFILE%\.claude\settings.json` on Windows).
pub const CLAUDE: Provider = Provider {
    id: "claude",
    transport: Transport::Http,
    events: &[
        "SessionStart",
        "SessionEnd",
        "UserPromptSubmit",
        "PreToolUse",
        "PostToolUse",
        "PostToolUseFailure",
        "PermissionRequest",
        "Notification",
        "Stop",
        "SubagentStart",
        "SubagentStop",
        "TaskCreated",
        "TaskCompleted",
        "TeammateIdle",
        "CwdChanged",
    ],
    // Deliberately NOT observed: WorktreeCreate replaces Claude Code's own worktree
    // creation (the hook must return the path), so hooking it would break worktrees.
    tool_events: &["PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionRequest"],
    path_override: "AGENTVILLE_SETTINGS_PATH",
    default_path: |home| home.join(".claude").join("settings.json"),
};

/// OpenAI Codex: command hooks in `$CODEX_HOME/hooks.json` (default `~/.codex`).
/// Codex has no http hooks, and new hooks run only after the user trusts them
/// in Codex (`/hooks`, or Settings → Hooks in the desktop app).
pub const CODEX: Provider = Provider {
    id: "codex",
    transport: Transport::Command,
    events: &[
        "SessionStart",
        "SessionEnd",
        "UserPromptSubmit",
        "PreToolUse",
        "PostToolUse",
        "PermissionRequest",
        "Stop",
        "Interrupt",
        "SubagentStart",
        "SubagentStop",
    ],
    tool_events: &["PreToolUse", "PostToolUse", "PermissionRequest"],
    path_override: "AGENTVILLE_CODEX_HOOKS_PATH",
    default_path: |home| std::env::var_os("CODEX_HOME").map(PathBuf::from).unwrap_or_else(|| home.join(".codex")).join("hooks.json"),
};

pub const ALL: [&Provider; 2] = [&CLAUDE, &CODEX];

pub fn get(id: &str) -> Option<&'static Provider> {
    ALL.into_iter().find(|p| p.id == id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_unique_and_url_safe() {
        for (i, p) in ALL.iter().enumerate() {
            assert!(p.id.chars().all(|c| c.is_ascii_lowercase()), "{}", p.id);
            assert!(ALL[i + 1..].iter().all(|q| q.id != p.id));
            assert!(p.tool_events.iter().all(|e| p.events.contains(e)));
            assert!(!p.events.contains(&"WorktreeCreate"));
        }
        assert_eq!(get("codex"), Some(&CODEX));
        assert_eq!(get("nope"), None);
    }

    #[test]
    fn default_paths() {
        let home = PathBuf::from("/h");
        assert_eq!((CLAUDE.default_path)(home.clone()), PathBuf::from("/h/.claude/settings.json"));
        if std::env::var_os("CODEX_HOME").is_none() {
            assert_eq!((CODEX.default_path)(home), PathBuf::from("/h/.codex/hooks.json"));
        }
    }
}
