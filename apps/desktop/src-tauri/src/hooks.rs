//! Opt-in, reversible installation of Agentville's observation hooks into
//! Claude Code user settings (`~/.claude/settings.json`, or
//! `%USERPROFILE%\.claude\settings.json` on Windows).
//!
//! Only entries whose URL carries the Agentville marker are ever added,
//! replaced or removed; every other key and hook is preserved (key order too),
//! and a timestamped backup is written before any change.

use serde::Serialize;
use serde_json::{json, Map, Value};
use std::fs;
use std::path::{Path, PathBuf};

pub const MARKER: &str = "src=agentville";
pub const OBSERVED_EVENTS: [&str; 15] = [
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
];
// Deliberately NOT observed: WorktreeCreate replaces Claude Code's own worktree
// creation (the hook must return the path), so hooking it would break worktrees.
const TOOL_EVENTS: [&str; 4] = ["PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionRequest"];
/// Hooks are synchronous; a stalled receiver must never stall Claude for long.
const HOOK_TIMEOUT_S: u64 = 2;

pub fn hook_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}/hooks/claude?{MARKER}")
}

fn is_ours(hook: &Value) -> bool {
    hook.get("url").and_then(Value::as_str).is_some_and(|u| u.contains(MARKER))
}

pub fn home_dir() -> PathBuf {
    std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from).unwrap_or_default()
}

/// `AGENTVILLE_SETTINGS_PATH` overrides the location (development and tests only).
pub fn settings_path() -> PathBuf {
    std::env::var_os("AGENTVILLE_SETTINGS_PATH").map(PathBuf::from).unwrap_or_else(|| home_dir().join(".claude").join("settings.json"))
}

/// Removes every Agentville hook, dropping matcher groups and events that become empty.
pub fn without_agentville(settings: &Value) -> Value {
    let mut next = settings.clone();
    let Some(obj) = next.as_object_mut() else { return next };
    let Some(Value::Object(hooks)) = obj.get("hooks").cloned() else { return next };
    let mut kept_hooks = Map::new();
    for (event, groups) in hooks {
        let Value::Array(groups) = groups else {
            kept_hooks.insert(event, groups);
            continue;
        };
        let kept: Vec<Value> = groups
            .into_iter()
            .filter_map(|mut g| {
                if let Some(Value::Array(list)) = g.get_mut("hooks") {
                    list.retain(|h| !is_ours(h));
                    if list.is_empty() {
                        return None;
                    }
                }
                Some(g)
            })
            .collect();
        if !kept.is_empty() {
            kept_hooks.insert(event, Value::Array(kept));
        }
    }
    if kept_hooks.is_empty() {
        obj.shift_remove("hooks");
    } else {
        obj.insert("hooks".into(), Value::Object(kept_hooks));
    }
    next
}

pub fn with_agentville(settings: &Value, port: u16, token: &str) -> Value {
    let mut next = without_agentville(settings);
    if !next.is_object() {
        next = json!({});
    }
    let obj = next.as_object_mut().unwrap();
    let hooks = obj.entry("hooks").or_insert_with(|| json!({}));
    if !hooks.is_object() {
        *hooks = json!({});
    }
    let hooks = hooks.as_object_mut().unwrap();
    for event in OBSERVED_EVENTS {
        let entry = json!({
            "type": "http",
            "url": hook_url(port),
            "timeout": HOOK_TIMEOUT_S,
            "headers": { "Authorization": format!("Bearer {token}") }
        });
        let group = if TOOL_EVENTS.contains(&event) { json!({ "matcher": "*", "hooks": [entry] }) } else { json!({ "hooks": [entry] }) };
        match hooks.get_mut(event) {
            Some(Value::Array(list)) => list.push(group),
            _ => {
                hooks.insert(event.into(), json!([group]));
            }
        }
    }
    next
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Inspection {
    pub installed: bool,
    /// Installed for another port/token, or missing events added in a newer Agentville.
    pub stale: bool,
    pub events: Vec<String>,
}

pub fn inspect(settings: &Value, port: u16, token: &str) -> Inspection {
    let mut events: Vec<String> = Vec::new();
    let mut stale = false;
    if let Some(Value::Object(hooks)) = settings.get("hooks") {
        for (event, groups) in hooks {
            for g in groups.as_array().into_iter().flatten() {
                for h in g.get("hooks").and_then(Value::as_array).into_iter().flatten() {
                    if !is_ours(h) {
                        continue;
                    }
                    if !events.contains(event) {
                        events.push(event.clone());
                    }
                    let auth = h.pointer("/headers/Authorization").and_then(Value::as_str);
                    if h.get("url").and_then(Value::as_str) != Some(&hook_url(port)) || auth != Some(&format!("Bearer {token}")) {
                        stale = true;
                    }
                }
            }
        }
    }
    let installed = !events.is_empty();
    if installed && OBSERVED_EVENTS.iter().any(|e| !events.iter().any(|x| x == e)) {
        stale = true;
    }
    Inspection { installed, stale, events }
}

/// Returns the parsed settings and the raw text (empty when the file doesn't exist).
pub fn read_settings(path: &Path) -> Result<(Value, String), String> {
    if !path.exists() {
        return Ok((json!({}), String::new()));
    }
    let raw = fs::read_to_string(path).map_err(|e| format!("settings_unreadable: {e}"))?;
    if raw.trim().is_empty() {
        return Ok((json!({}), raw));
    }
    // Never rewrite a file we can't parse — the user may be mid-edit.
    let value: Value = serde_json::from_str(&raw).map_err(|e| format!("settings_invalid_json: {e}"))?;
    if !value.is_object() {
        return Err("settings_not_object".into());
    }
    Ok((value, raw))
}

pub fn serialize(value: &Value) -> String {
    format!("{}\n", serde_json::to_string_pretty(value).unwrap_or_else(|_| "{}".into()))
}

/// Atomically writes settings after backing up the previous file; returns the backup path.
pub fn write_settings(path: &Path, value: &Value, now_ms: i64) -> Result<Option<PathBuf>, String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("settings_unwritable: {e}"))?;
    }
    let backup = if path.exists() {
        let b = PathBuf::from(format!("{}.agentville-backup-{now_ms}", path.display()));
        fs::copy(path, &b).map_err(|e| format!("settings_unwritable: {e}"))?;
        Some(b)
    } else {
        None
    };
    let tmp = PathBuf::from(format!("{}.agentville-tmp-{}", path.display(), std::process::id()));
    fs::write(&tmp, serialize(value)).map_err(|e| format!("settings_unwritable: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600));
    }
    fs::rename(&tmp, path).map_err(|e| format!("settings_unwritable: {e}"))?;
    Ok(backup)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn user() -> Value {
        json!({
            "model": "opus",
            "permissions": { "allow": ["Bash(npm test)"] },
            "hooks": {
                "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "echo mine" }] }],
                "Stop": [{ "hooks": [{ "type": "command", "command": "say done" }] }]
            }
        })
    }

    #[test]
    fn adds_every_event_and_keeps_user_entries_and_key_order() {
        let next = with_agentville(&user(), 47821, "tok");
        for e in OBSERVED_EVENTS {
            assert!(next["hooks"].get(e).is_some(), "{e}");
        }
        assert_eq!(next["hooks"]["PreToolUse"].as_array().unwrap().len(), 2);
        assert_eq!(next["hooks"]["PreToolUse"][0], user()["hooks"]["PreToolUse"][0]);
        let keys: Vec<_> = next.as_object().unwrap().keys().cloned().collect();
        assert_eq!(keys, ["model", "permissions", "hooks"]);
        assert!(!serialize(&next).contains("WorktreeCreate"));
    }

    #[test]
    fn is_idempotent_and_uninstall_restores_exactly() {
        let once = with_agentville(&user(), 47821, "tok");
        assert_eq!(with_agentville(&once, 47821, "tok"), once);
        assert_eq!(without_agentville(&once), user());
        assert_eq!(without_agentville(&with_agentville(&json!({}), 1, "t")), json!({}));
    }

    #[test]
    fn detects_installed_and_stale() {
        let installed = with_agentville(&user(), 47821, "tok");
        let ok = inspect(&installed, 47821, "tok");
        assert!(ok.installed && !ok.stale);
        assert_eq!(ok.events.len(), OBSERVED_EVENTS.len());
        assert!(inspect(&installed, 50000, "tok").stale);
        assert!(inspect(&installed, 47821, "other").stale);
        assert!(!inspect(&user(), 47821, "tok").installed);
        let mut old = with_agentville(&json!({}), 47821, "tok");
        old["hooks"].as_object_mut().unwrap().shift_remove("TeammateIdle");
        let i = inspect(&old, 47821, "tok");
        assert!(i.installed && i.stale);
    }

    #[test]
    fn uses_short_http_hooks_on_loopback() {
        let next = with_agentville(&json!({}), 47821, "tok");
        let group = &next["hooks"]["PreToolUse"][0];
        assert_eq!(group["matcher"], "*");
        assert_eq!(group["hooks"][0], json!({ "type": "http", "url": hook_url(47821), "timeout": 2, "headers": { "Authorization": "Bearer tok" } }));
        assert!(hook_url(1).starts_with("http://127.0.0.1:"));
    }

    #[test]
    fn refuses_unparsable_files_and_backs_up() {
        let dir = std::env::temp_dir().join(format!("av-hooks-{}", crate::config::random_token()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("settings.json");
        fs::write(&path, "{ \"model\": \"opus\", ").unwrap();
        assert!(read_settings(&path).unwrap_err().starts_with("settings_invalid_json"));
        fs::write(&path, "[1]").unwrap();
        assert_eq!(read_settings(&path).unwrap_err(), "settings_not_object");
        fs::write(&path, serde_json::to_string(&user()).unwrap()).unwrap();
        let (v, _) = read_settings(&path).unwrap();
        let backup = write_settings(&path, &with_agentville(&v, 1, "t"), 123).unwrap().unwrap();
        assert!(backup.to_string_lossy().ends_with("agentville-backup-123"));
        assert_eq!(serde_json::from_str::<Value>(&fs::read_to_string(&backup).unwrap()).unwrap(), user());
        assert!(!fs::read_dir(&dir).unwrap().any(|e| e.unwrap().file_name().to_string_lossy().contains("agentville-tmp")));
        assert_eq!(read_settings(&dir.join("missing.json")).unwrap().0, json!({}));
    }
}
