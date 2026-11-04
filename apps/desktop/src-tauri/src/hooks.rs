//! Opt-in, reversible installation of Agentville's observation hooks into an
//! agent's hooks file (see `providers`): Claude Code's `~/.claude/settings.json`
//! or Codex's `~/.codex/hooks.json`. Both use the same layout — event →
//! matcher groups → handlers — so one implementation serves every provider.
//!
//! Only entries carrying the Agentville marker are ever added, replaced or
//! removed; every other key and hook is preserved (key order too), and a
//! timestamped backup is written before any change.

use crate::providers::{Provider, Transport};
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::fs;
use std::path::{Path, PathBuf};

pub const MARKER: &str = "src=agentville";
/// Argument that turns Agentville's executable into a hook forwarder (see `forwarder`).
pub const FORWARD_ARG: &str = "--agentville-hook";
/// Hooks are synchronous; a stalled receiver must never stall the agent for long.
const HOOK_TIMEOUT_S: u64 = 2;

/// Where hooks should point: the running receiver and, for command hooks, the forwarder.
#[derive(Clone, Debug)]
pub struct Target {
    pub port: u16,
    pub token: String,
    /// Agentville's executable, run by command hooks.
    pub exe: String,
}

pub fn hook_url(provider: &Provider, port: u16) -> String {
    format!("http://127.0.0.1:{port}/hooks/{}?{MARKER}", provider.id)
}

/// Command line for a command hook. Quoted only when needed, so it reads the
/// same in sh, cmd and PowerShell for the usual install locations.
pub fn hook_command(provider: &Provider, exe: &str) -> String {
    let exe = if exe.contains([' ', '\'', '"', '$', '`', '&', '(', ')', ';']) {
        if cfg!(windows) {
            format!("\"{exe}\"")
        } else {
            format!("'{}'", exe.replace('\'', r"'\''"))
        }
    } else {
        exe.to_string()
    };
    format!("{exe} {FORWARD_ARG} {}", provider.id)
}

fn is_ours(hook: &Value) -> bool {
    hook.get("url").and_then(Value::as_str).is_some_and(|u| u.contains(MARKER))
        || hook.get("command").and_then(Value::as_str).is_some_and(|c| c.contains(FORWARD_ARG))
}

fn entry(provider: &Provider, target: &Target) -> Value {
    match provider.transport {
        Transport::Http => json!({
            "type": "http",
            "url": hook_url(provider, target.port),
            "timeout": HOOK_TIMEOUT_S,
            "headers": { "Authorization": format!("Bearer {}", target.token) }
        }),
        // The token stays out of the hooks file: the forwarder reads it from Agentville's config.
        Transport::Command => json!({ "type": "command", "command": hook_command(provider, &target.exe), "timeout": HOOK_TIMEOUT_S }),
    }
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

pub fn with_agentville(provider: &Provider, settings: &Value, target: &Target) -> Value {
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
    for &event in provider.events {
        let entry = entry(provider, target);
        let group = if provider.tool_events.contains(&event) { json!({ "matcher": "*", "hooks": [entry] }) } else { json!({ "hooks": [entry] }) };
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
    /// Installed for another port/token/executable, or missing events added in a newer Agentville.
    pub stale: bool,
    pub events: Vec<String>,
}

pub fn inspect(provider: &Provider, settings: &Value, target: &Target) -> Inspection {
    let expected = entry(provider, target);
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
                    // Another port/token/executable, or a hook left behind by another provider's format.
                    if *h != expected {
                        stale = true;
                    }
                }
            }
        }
    }
    let installed = !events.is_empty();
    if installed && provider.events.iter().any(|e| !events.iter().any(|x| x == e)) {
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
    use crate::providers::{CLAUDE, CODEX};

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

    fn target(port: u16, token: &str) -> Target {
        Target { port, token: token.into(), exe: "/Applications/Agentville.app/Contents/MacOS/agentville".into() }
    }

    #[test]
    fn adds_every_event_and_keeps_user_entries_and_key_order() {
        for p in [&CLAUDE, &CODEX] {
            let next = with_agentville(p, &user(), &target(47821, "tok"));
            for e in p.events {
                assert!(next["hooks"].get(e).is_some(), "{} {e}", p.id);
            }
            assert_eq!(next["hooks"]["PreToolUse"].as_array().unwrap().len(), 2);
            assert_eq!(next["hooks"]["PreToolUse"][0], user()["hooks"]["PreToolUse"][0]);
            let keys: Vec<_> = next.as_object().unwrap().keys().cloned().collect();
            assert_eq!(keys, ["model", "permissions", "hooks"]);
            assert!(!serialize(&next).contains("WorktreeCreate"));
        }
    }

    #[test]
    fn is_idempotent_and_uninstall_restores_exactly() {
        for p in [&CLAUDE, &CODEX] {
            let once = with_agentville(p, &user(), &target(47821, "tok"));
            assert_eq!(with_agentville(p, &once, &target(47821, "tok")), once);
            assert_eq!(without_agentville(&once), user());
            assert_eq!(without_agentville(&with_agentville(p, &json!({}), &target(1, "t"))), json!({}));
        }
    }

    #[test]
    fn detects_installed_and_stale() {
        for p in [&CLAUDE, &CODEX] {
            let installed = with_agentville(p, &user(), &target(47821, "tok"));
            let ok = inspect(p, &installed, &target(47821, "tok"));
            assert!(ok.installed && !ok.stale, "{}", p.id);
            assert_eq!(ok.events.len(), p.events.len());
            assert!(!inspect(p, &user(), &target(47821, "tok")).installed);
            let mut old = with_agentville(p, &json!({}), &target(47821, "tok"));
            old["hooks"].as_object_mut().unwrap().shift_remove("SubagentStop");
            let i = inspect(p, &old, &target(47821, "tok"));
            assert!(i.installed && i.stale);
            let mut moved = target(47821, "tok");
            moved.exe = "/elsewhere/agentville".into();
            // Command hooks don't carry port or token; only the executable matters.
            assert_eq!(inspect(p, &installed, &moved).stale, p.id == "codex");
        }
        let claude = with_agentville(&CLAUDE, &user(), &target(47821, "tok"));
        assert!(inspect(&CLAUDE, &claude, &target(50000, "tok")).stale);
        assert!(inspect(&CLAUDE, &claude, &target(47821, "other")).stale);
        let codex = with_agentville(&CODEX, &json!({}), &target(47821, "tok"));
        assert!(!inspect(&CODEX, &codex, &target(50000, "other")).stale);
    }

    #[test]
    fn uses_short_http_hooks_on_loopback_for_claude() {
        let next = with_agentville(&CLAUDE, &json!({}), &target(47821, "tok"));
        let group = &next["hooks"]["PreToolUse"][0];
        assert_eq!(group["matcher"], "*");
        assert_eq!(group["hooks"][0], json!({ "type": "http", "url": "http://127.0.0.1:47821/hooks/claude?src=agentville", "timeout": 2, "headers": { "Authorization": "Bearer tok" } }));
    }

    #[test]
    fn uses_forwarder_command_without_token_for_codex() {
        let next = with_agentville(&CODEX, &json!({}), &target(47821, "secret-token"));
        assert_eq!(next["hooks"]["PreToolUse"][0]["matcher"], "*");
        assert!(next["hooks"]["Stop"][0].get("matcher").is_none());
        assert_eq!(
            next["hooks"]["Stop"][0]["hooks"][0],
            json!({ "type": "command", "command": "/Applications/Agentville.app/Contents/MacOS/agentville --agentville-hook codex", "timeout": 2 })
        );
        assert!(!serialize(&next).contains("secret-token"));
    }

    #[test]
    fn quotes_executables_only_when_needed() {
        assert_eq!(hook_command(&CODEX, "/opt/av/agentville"), "/opt/av/agentville --agentville-hook codex");
        if cfg!(windows) {
            assert_eq!(hook_command(&CODEX, r"C:\Users\A B\agentville.exe"), r#""C:\Users\A B\agentville.exe" --agentville-hook codex"#);
        } else {
            assert_eq!(hook_command(&CODEX, "/Users/a b/agentville"), "'/Users/a b/agentville' --agentville-hook codex");
            assert_eq!(hook_command(&CODEX, "/x/it's/av"), r"'/x/it'\''s/av' --agentville-hook codex");
        }
    }

    #[test]
    fn uninstall_removes_both_formats() {
        let both = with_agentville(&CODEX, &with_agentville(&CLAUDE, &user(), &target(1, "t")), &target(1, "t"));
        assert_eq!(without_agentville(&both), user());
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
        let backup = write_settings(&path, &with_agentville(&CLAUDE, &v, &target(1, "t")), 123).unwrap().unwrap();
        assert!(backup.to_string_lossy().ends_with("agentville-backup-123"));
        assert_eq!(serde_json::from_str::<Value>(&fs::read_to_string(&backup).unwrap()).unwrap(), user());
        assert!(!fs::read_dir(&dir).unwrap().any(|e| e.unwrap().file_name().to_string_lossy().contains("agentville-tmp")));
        assert_eq!(read_settings(&dir.join("missing.json")).unwrap().0, json!({}));
    }
}
