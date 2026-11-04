//! Monitor Mode settings, stored as JSON (0600) in the app config directory.
//! No API keys are involved: Agentville only observes coding agents via hooks.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

pub const DEFAULT_HOOK_PORT: u16 = 47821;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationConfig {
    /// Unused since the receiver moved into the app; kept so older config files still load.
    #[serde(default, skip_serializing)]
    pub node_path: Option<String>,
    /// Explicit Claude Code CLI binary (used for status checks only); `None` = auto-detect.
    #[serde(default)]
    pub claude_path: Option<String>,
    pub hook_port: u16,
    /// Shared secret hooks send to the local receiver. Generated once.
    pub hook_token: String,
    pub auto_start: bool,
}

impl IntegrationConfig {
    pub fn with_defaults(hook_token: String) -> Self {
        Self {
            node_path: None,
            claude_path: None,
            hook_port: DEFAULT_HOOK_PORT,
            hook_token,
            auto_start: true,
        }
    }

    /// Returns a stable error code for the first invalid field.
    pub fn validate(&self) -> Result<(), String> {
        if self.hook_port < 1024 {
            return Err("invalid_port".into());
        }
        for p in [&self.claude_path].into_iter().flatten() {
            if !p.is_empty() && !Path::new(p).is_absolute() {
                return Err("path_not_absolute".into());
            }
        }
        if self.hook_token.len() < 16 {
            return Err("invalid_hook_token".into());
        }
        Ok(())
    }

    /// Empty strings from the form mean "auto".
    pub fn normalized(mut self) -> Self {
        let clean = |v: Option<String>| v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
        self.node_path = clean(self.node_path);
        self.claude_path = clean(self.claude_path);
        self
    }
}

pub fn config_path(dir: &Path) -> PathBuf {
    dir.join("integration.json")
}

/// The app config directory as Tauri resolves it (`app_config_dir`), for code
/// that runs without an `AppHandle` — the hook forwarder.
pub fn default_dir() -> PathBuf {
    let home = crate::providers::home_dir();
    let base = if cfg!(target_os = "macos") {
        home.join("Library").join("Application Support")
    } else if cfg!(windows) {
        std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_else(|| home.join("AppData").join("Roaming"))
    } else {
        std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from).unwrap_or_else(|| home.join(".config"))
    };
    base.join(IDENTIFIER)
}

/// Must match `identifier` in tauri.conf.json.
pub const IDENTIFIER: &str = "com.agentville.desktop";

/// Reads the saved config without creating one (`None` when missing or invalid).
pub fn read(dir: &Path) -> Option<IntegrationConfig> {
    let raw = fs::read_to_string(config_path(dir)).ok()?;
    serde_json::from_str::<IntegrationConfig>(&raw).ok().map(IntegrationConfig::normalized).filter(|c| c.validate().is_ok())
}

pub fn load(dir: &Path) -> IntegrationConfig {
    match read(dir) {
        Some(c) => c,
        None => {
            let fresh = IntegrationConfig::with_defaults(random_token());
            let _ = save(dir, &fresh);
            fresh
        }
    }
}

pub fn save(dir: &Path, config: &IntegrationConfig) -> Result<(), String> {
    config.validate()?;
    fs::create_dir_all(dir).map_err(|e| format!("config_write_failed: {e}"))?;
    let path = config_path(dir);
    let tmp = path.with_extension("json.tmp");
    let raw = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(&tmp, raw).map_err(|e| format!("config_write_failed: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600));
    }
    fs::rename(&tmp, &path).map_err(|e| format!("config_write_failed: {e}"))
}

/// 32 random bytes as hex, from the OS CSPRNG (macOS and Windows).
pub fn random_token() -> String {
    let mut buf = [0u8; 32];
    getrandom::fill(&mut buf).expect("OS random source unavailable");
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir() -> PathBuf {
        let d = std::env::temp_dir().join(format!("av-cfg-{}", random_token()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn creates_defaults_and_round_trips() {
        let dir = tmpdir();
        let first = load(&dir);
        assert_eq!(first.hook_port, DEFAULT_HOOK_PORT);
        assert_eq!(first.hook_token.len(), 64);
        assert_eq!(load(&dir), first, "token must be stable across loads");
        let mut changed = first.clone();
        changed.hook_port = 50123;
        save(&dir, &changed).unwrap();
        assert_eq!(load(&dir).hook_port, 50123);
    }

    #[test]
    fn rejects_unsafe_values() {
        let base = IntegrationConfig::with_defaults(random_token());
        let mut c = base.clone();
        c.claude_path = Some("claude".into());
        assert_eq!(c.validate().unwrap_err(), "path_not_absolute");
        let mut c = base.clone();
        c.hook_port = 80;
        assert_eq!(c.validate().unwrap_err(), "invalid_port");
        let mut c = base;
        c.hook_token = "short".into();
        assert_eq!(c.validate().unwrap_err(), "invalid_hook_token");
    }

    #[test]
    fn normalizes_blank_fields_to_auto() {
        let mut c = IntegrationConfig::with_defaults(random_token());
        c.node_path = Some("  ".into());
        c.claude_path = Some("  ".into());
        let n = c.normalized();
        assert_eq!(n.node_path, None);
        assert_eq!(n.claude_path, None);
    }

    #[test]
    fn identifier_matches_tauri_conf() {
        let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(conf["identifier"], IDENTIFIER);
        assert!(default_dir().ends_with(IDENTIFIER));
    }

    #[test]
    fn read_never_creates_a_config() {
        let dir = tmpdir();
        assert_eq!(read(&dir), None);
        assert!(!config_path(&dir).exists());
        let saved = load(&dir);
        assert_eq!(read(&dir), Some(saved));
    }

    #[test]
    fn corrupt_file_is_replaced_with_defaults() {
        let dir = tmpdir();
        fs::write(config_path(&dir), "{ nope").unwrap();
        assert!(load(&dir).validate().is_ok());
    }
}
