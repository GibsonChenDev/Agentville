//! Guided installation of Claude Code with Anthropic's official installers
//! (https://code.claude.com/docs/en/setup) on macOS and Windows.
//!
//! Commands are fixed — nothing from the UI is interpolated into a shell. The
//! UI shows the exact command and asks for confirmation before running it;
//! output streams back line by line and the run can be stopped.

use crate::detect::quiet;
use serde::Serialize;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

#[cfg(not(windows))]
const CLAUDE_INSTALL: &str = "curl -fsSL https://claude.ai/install.sh | bash";
#[cfg(windows)]
const CLAUDE_INSTALL: &str = "irm https://claude.ai/install.ps1 | iex";
const CLAUDE_DOCS_URL: &str = "https://code.claude.com/docs/en/setup";
const CLAUDE_QUICKSTART_URL: &str = "https://code.claude.com/docs/en/quickstart";
const GIT_WINDOWS_URL: &str = "https://git-scm.com/downloads/win";

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", tag = "method")]
pub enum InstallPlan {
    /// Run `command` (PowerShell on Windows, a login shell elsewhere).
    Shell { command: String, shell: &'static str },
}

#[derive(Serialize, Clone)]
struct LogLine {
    tool: String,
    line: String,
}

#[derive(Serialize, Clone)]
struct Done {
    tool: String,
    ok: bool,
    code: Option<i32>,
}

pub fn plan_for(tool: &str) -> Result<InstallPlan, String> {
    match tool {
        "claude" => Ok(InstallPlan::Shell { command: CLAUDE_INSTALL.into(), shell: if cfg!(windows) { "powershell" } else { "shell" } }),
        _ => Err("unknown_tool".into()),
    }
}

#[derive(Default)]
pub struct Installer {
    running: Arc<Mutex<Option<(String, u32)>>>,
}

impl Installer {
    pub fn install(&self, app: &AppHandle, tool: &str) -> Result<(), String> {
        let InstallPlan::Shell { command, .. } = plan_for(tool)?;
        let mut guard = self.running.lock().unwrap();
        if guard.is_some() {
            return Err("installer_busy".into());
        }
        #[cfg(windows)]
        let mut cmd = {
            let mut c = quiet("powershell.exe");
            c.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", &command]);
            c
        };
        #[cfg(not(windows))]
        let mut cmd = {
            let shell = if Path::new("/bin/zsh").exists() { "/bin/zsh" } else { "/bin/bash" };
            let mut c = quiet(shell);
            c.args(["-lc", &command]);
            // Own process group so Stop also ends curl/bash children.
            use std::os::unix::process::CommandExt;
            c.process_group(0);
            c
        };
        let mut child = cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).env("NONINTERACTIVE", "1").spawn().map_err(|e| format!("installer_failed: {e}"))?;
        *guard = Some((tool.to_string(), child.id()));
        drop(guard);

        let emitter = |app: AppHandle, tool: String| move |line: String| {
            let _ = app.emit("installer://log", LogLine { tool: tool.clone(), line });
        };
        let _ = app.emit("installer://log", LogLine { tool: tool.into(), line: format!("> {command}") });
        let err = child.stderr.take().expect("piped stderr");
        let out = child.stdout.take().expect("piped stdout");
        let err_emit = emitter(app.clone(), tool.into());
        std::thread::spawn(move || BufReader::new(err).lines().map_while(Result::ok).for_each(err_emit));
        let out_emit = emitter(app.clone(), tool.into());
        let running = self.running.clone();
        let app = app.clone();
        let tool = tool.to_string();
        std::thread::spawn(move || {
            BufReader::new(out).lines().map_while(Result::ok).for_each(out_emit);
            let status = child.wait().ok();
            running.lock().unwrap().take();
            let _ = app.emit("installer://done", Done { tool, ok: status.map(|s| s.success()).unwrap_or(false), code: status.and_then(|s| s.code()) });
        });
        Ok(())
    }

    pub fn cancel(&self) {
        let Some((_, pid)) = self.running.lock().unwrap().clone() else { return };
        #[cfg(windows)]
        let _ = quiet("taskkill.exe").args(["/PID", &pid.to_string(), "/T", "/F"]).status();
        #[cfg(not(windows))]
        let _ = quiet("/bin/kill").args(["-TERM", "--", &format!("-{pid}")]).status();
    }

    pub fn running_tool(&self) -> Option<String> {
        self.running.lock().unwrap().as_ref().map(|(t, _)| t.clone())
    }
}

fn open_url(url: &str) -> Result<(), String> {
    #[cfg(windows)]
    let status = quiet("explorer.exe").arg(url).status();
    #[cfg(not(windows))]
    let status = quiet("/usr/bin/open").arg(url).status();
    status.map(|_| ()).map_err(|e| format!("open_failed: {e}"))
}

/// Opens one of a fixed set of official pages in the default browser.
pub fn open_link(which: &str) -> Result<(), String> {
    let url = match which {
        "claude_docs" => CLAUDE_DOCS_URL,
        "claude_quickstart" => CLAUDE_QUICKSTART_URL,
        "git_windows" => GIT_WINDOWS_URL,
        _ => return Err("unknown_link".into()),
    };
    open_url(url)
}

/// Opens a terminal running `claude` in the home folder (first run walks the
/// user through login). macOS uses a `.command` file so no Automation
/// permission is needed; Windows prefers Windows Terminal, else PowerShell.
pub fn open_terminal_with_claude(cache_dir: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        let _ = cache_dir;
        let home = crate::providers::home_dir();
        let has_wt = {
            let mut c = quiet("where.exe");
            c.arg("wt.exe");
            crate::detect::output_with_timeout(c, std::time::Duration::from_secs(3)).is_some()
        };
        let mut c = quiet("cmd.exe");
        if has_wt {
            c.args(["/c", "start", "", "wt.exe", "-d"]).arg(&home).arg("claude");
        } else {
            c.args(["/c", "start", "", "/D"]).arg(&home).args(["powershell.exe", "-NoExit", "-Command", "claude"]);
        }
        c.status().map(|_| ()).map_err(|e| format!("open_failed: {e}"))
    }
    #[cfg(not(windows))]
    {
        std::fs::create_dir_all(cache_dir).map_err(|e| format!("open_failed: {e}"))?;
        let script = cache_dir.join("start-claude.command");
        std::fs::write(&script, "#!/bin/zsh -l\ncd ~\nclear\nexec claude\n").map_err(|e| format!("open_failed: {e}"))?;
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).map_err(|e| format!("open_failed: {e}"))?;
        quiet("/usr/bin/open").args(["-a", "Terminal"]).arg(&script).status().map(|_| ()).map_err(|e| format!("open_failed: {e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uses_the_official_installer_for_this_platform() {
        let InstallPlan::Shell { command, shell } = plan_for("claude").unwrap();
        if cfg!(windows) {
            assert_eq!((command.as_str(), shell), ("irm https://claude.ai/install.ps1 | iex", "powershell"));
        } else {
            assert_eq!((command.as_str(), shell), ("curl -fsSL https://claude.ai/install.sh | bash", "shell"));
        }
    }

    #[test]
    fn rejects_unknown_tools_and_links() {
        assert_eq!(plan_for("node").unwrap_err(), "unknown_tool");
        assert_eq!(plan_for("rm -rf /").unwrap_err(), "unknown_tool");
        assert_eq!(open_link("https://evil.example").unwrap_err(), "unknown_link");
    }
}
