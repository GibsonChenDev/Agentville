//! Finds the Claude Code CLI (and Codex) on macOS and Windows. Apps started from Finder or
//! the Start menu get a minimal PATH, so we check the official install
//! locations and the user's shell before falling back, verifying each
//! candidate by running `--version`.

use serde::Serialize;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ToolInfo {
    pub path: Option<String>,
    pub version: Option<String>,
    /// Runs and reports a version.
    pub ok: bool,
    /// "config" | "detected" | "none"
    pub source: &'static str,
}

fn home() -> String {
    std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_default()
}

/// Command with no console window on Windows.
pub fn quiet(program: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut cmd = Command::new(program);
    cmd.stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd
}

/// Runs a command, killing it after `timeout`; returns stdout on success.
pub fn output_with_timeout(mut cmd: Command, timeout: Duration) -> Option<String> {
    let mut child = cmd.stdout(Stdio::piped()).stderr(Stdio::null()).spawn().ok()?;
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    return None;
                }
                let mut out = String::new();
                use std::io::Read;
                child.stdout.take()?.read_to_string(&mut out).ok()?;
                return Some(out);
            }
            Ok(None) if Instant::now() > deadline => {
                let _ = child.kill();
                return None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(_) => return None,
        }
    }
}

pub fn claude_candidates() -> Vec<String> {
    let h = home();
    let mut list: Vec<String> = if cfg!(windows) {
        let local = std::env::var("LOCALAPPDATA").unwrap_or_default();
        let appdata = std::env::var("APPDATA").unwrap_or_default();
        vec![
            format!(r"{h}\.local\bin\claude.exe"),
            format!(r"{local}\Microsoft\WinGet\Links\claude.exe"),
            format!(r"{appdata}\npm\claude.cmd"),
            format!(r"{local}\Programs\claude\claude.exe"),
        ]
    } else {
        vec![
            format!("{h}/.local/bin/claude"),
            "/opt/homebrew/bin/claude".into(),
            "/usr/local/bin/claude".into(),
            format!("{h}/.claude/local/claude"),
            "/usr/bin/claude".into(),
        ]
    };
    if let Some(p) = which("claude") {
        list.insert(0, p);
    }
    list
}

/// `name` must be a fixed literal (it is interpolated into a shell command).
fn which(name: &'static str) -> Option<String> {
    let out = if cfg!(windows) {
        let mut c = quiet("where.exe");
        c.arg(name);
        output_with_timeout(c, Duration::from_secs(3))
    } else {
        // A login shell sees the PATH the user's terminal sees.
        let shell = if Path::new("/bin/zsh").exists() { "/bin/zsh" } else { "/bin/bash" };
        let mut c = quiet(shell);
        c.args(["-lc", &format!("command -v {name}")]);
        output_with_timeout(c, Duration::from_secs(5))
    }?;
    out.lines().map(str::trim).find(|l| !l.is_empty() && Path::new(l).is_absolute()).map(String::from)
}

fn version_of(path: &str) -> Option<String> {
    let mut c = quiet(path);
    c.arg("--version");
    let out = output_with_timeout(c, Duration::from_secs(8))?;
    out.split_whitespace().next().map(|v| v.trim_start_matches('v').to_string())
}

pub fn parse_major_minor(v: &str) -> Option<(u32, u32)> {
    let mut parts = v.trim_start_matches('v').split('.');
    Some((parts.next()?.parse().ok()?, parts.next().unwrap_or("0").parse().ok()?))
}

pub fn detect_claude(configured: Option<&str>) -> ToolInfo {
    if let Some(p) = configured {
        let version = Path::new(p).is_file().then(|| version_of(p)).flatten();
        let ok = version.as_deref().and_then(parse_major_minor).is_some();
        return ToolInfo { path: Some(p.into()), version, ok, source: "config" };
    }
    let mut seen = std::collections::HashSet::new();
    for c in claude_candidates() {
        if !seen.insert(c.clone()) || !Path::new(&c).is_file() {
            continue;
        }
        if let Some(v) = version_of(&c) {
            let ok = parse_major_minor(&v).is_some();
            return ToolInfo { path: Some(c), version: Some(v), ok, source: "detected" };
        }
    }
    ToolInfo { path: None, version: None, ok: false, source: "none" }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CodexInfo {
    /// The `codex` CLI, when found. The desktop app and IDE extension don't install one.
    pub path: Option<String>,
    pub version: Option<String>,
    /// Codex's home directory (`$CODEX_HOME` or `~/.codex`), when it exists.
    pub home: Option<String>,
    /// Any sign of Codex: the CLI, its home directory or the desktop app.
    pub installed: bool,
}

pub fn codex_home() -> std::path::PathBuf {
    std::env::var_os("CODEX_HOME").map(Into::into).unwrap_or_else(|| Path::new(&home()).join(".codex"))
}

fn codex_candidates() -> Vec<String> {
    let h = home();
    let mut list: Vec<String> = if cfg!(windows) {
        let appdata = std::env::var("APPDATA").unwrap_or_default();
        vec![format!(r"{appdata}\npm\codex.cmd"), format!(r"{h}\.local\bin\codex.exe")]
    } else {
        vec![
            "/opt/homebrew/bin/codex".into(),
            "/usr/local/bin/codex".into(),
            format!("{h}/.local/bin/codex"),
            // Bundled with the desktop apps (Codex inside ChatGPT, or the standalone Codex app).
            "/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex".into(),
            "/Applications/Codex.app/Contents/Resources/codex-cli/bin/codex".into(),
        ]
    };
    if let Some(p) = which("codex") {
        list.insert(0, p);
    }
    list
}

/// `codex --version` prints e.g. "codex-cli 0.130.0".
pub fn parse_codex_version(out: &str) -> Option<String> {
    let v = out.split_whitespace().last()?.trim_start_matches('v');
    parse_major_minor(v).map(|_| v.to_string())
}

pub fn detect_codex() -> CodexInfo {
    let home = codex_home();
    let home = home.is_dir().then(|| home.to_string_lossy().into_owned());
    let app = cfg!(target_os = "macos") && ["/Applications/Codex.app", "/Applications/ChatGPT.app/Contents/Resources/codex-cli"].iter().any(|p| Path::new(p).exists());
    let mut seen = std::collections::HashSet::new();
    for c in codex_candidates() {
        if !seen.insert(c.clone()) || !Path::new(&c).is_file() {
            continue;
        }
        let mut cmd = quiet(&c);
        cmd.arg("--version");
        if let Some(v) = output_with_timeout(cmd, Duration::from_secs(8)).as_deref().and_then(parse_codex_version) {
            return CodexInfo { path: Some(c), version: Some(v), home, installed: true };
        }
    }
    let installed = home.is_some() || app;
    CodexInfo { path: None, version: None, home, installed }
}

/// `claude auth status` prints JSON with `loggedIn`; `None` when unknown (older CLI, error).
pub fn claude_logged_in(path: &str) -> Option<bool> {
    let mut c = quiet(path);
    c.args(["auth", "status"]);
    let out = output_with_timeout(c, Duration::from_secs(8))?;
    parse_logged_in(&out)
}

pub fn parse_logged_in(out: &str) -> Option<bool> {
    let start = out.find('{')?;
    let v: serde_json::Value = serde_json::from_str(&out[start..]).ok()?;
    v.get("loggedIn").and_then(serde_json::Value::as_bool)
}

/// Git is optional (branch/worktree display only).
pub fn git_available() -> bool {
    let mut c = quiet("git");
    c.arg("--version");
    output_with_timeout(c, Duration::from_secs(3)).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_versions_and_login_status() {
        assert_eq!(parse_major_minor("2.1.277"), Some((2, 1)));
        assert_eq!(parse_major_minor("abc"), None);
        assert_eq!(parse_logged_in(r#"{ "loggedIn": true, "authMethod": "claude.ai" }"#), Some(true));
        assert_eq!(parse_logged_in("note\n{\"loggedIn\": false}"), Some(false));
        assert_eq!(parse_logged_in("not json"), None);
    }

    #[test]
    fn parses_codex_versions() {
        assert_eq!(parse_codex_version("codex-cli 0.130.0\n").as_deref(), Some("0.130.0"));
        assert_eq!(parse_codex_version("v1.2.3").as_deref(), Some("1.2.3"));
        assert_eq!(parse_codex_version("codex-cli"), None);
        assert_eq!(parse_codex_version(""), None);
    }

    #[test]
    fn configured_missing_path_is_reported_not_ok() {
        let info = detect_claude(Some("/definitely/not/here/claude"));
        assert_eq!(info.source, "config");
        assert!(!info.ok);
    }

    #[test]
    fn candidates_are_absolute_platform_paths() {
        for c in claude_candidates() {
            assert!(c.ends_with("claude") || c.ends_with("claude.exe") || c.ends_with("claude.cmd"), "{c}");
        }
    }
}
