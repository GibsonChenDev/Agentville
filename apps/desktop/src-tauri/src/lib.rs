//! Agentville desktop shell.
//!
//! Monitor Mode on macOS and Windows: Rust owns everything that touches the
//! operating system — settings, Claude Code detection and installation, the
//! built-in hook receiver and local storage. The webview never spawns
//! processes; it talks to the receiver over loopback with a per-launch token.
//! No API keys and no runtime dependencies besides Claude Code itself.

mod bridge;
pub mod config;
mod db;
pub mod detect;
pub mod gitinfo;
pub mod hooks;
mod installer;
pub mod receiver;

use bridge::{BridgeState, Connection, Supervisor};
use config::IntegrationConfig;
use installer::{InstallPlan, Installer};
use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, RunEvent, State};

#[derive(Serialize)]
struct AppInfo {
    version: &'static str,
    phase: u8,
}

#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo { version: env!("CARGO_PKG_VERSION"), phase: 6 }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct IntegrationView {
    config: IntegrationConfig,
    claude: detect::ToolInfo,
    git: bool,
    platform: &'static str,
    bridge: BridgeState,
}

fn platform() -> &'static str {
    if cfg!(windows) {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_config_dir().map_err(|e| e.to_string())
}

#[tauri::command]
async fn integration_get(app: AppHandle, sup: State<'_, Supervisor>) -> Result<IntegrationView, String> {
    let config = config::load(&config_dir(&app)?);
    let (claude, git) = {
        let c = config.clone();
        tauri::async_runtime::spawn_blocking(move || (detect::detect_claude(c.claude_path.as_deref()), detect::git_available()))
            .await
            .map_err(|e| e.to_string())?
    };
    Ok(IntegrationView { config, claude, git, platform: platform(), bridge: sup.state() })
}

/// Saves settings and restarts the bridge so they take effect.
#[tauri::command]
async fn integration_save(app: AppHandle, sup: State<'_, Supervisor>, config: IntegrationConfig) -> Result<(), String> {
    let dir = config_dir(&app)?;
    let current = config::load(&dir);
    // The hook token is never edited from the UI.
    let next = IntegrationConfig { hook_token: current.hook_token, ..config }.normalized();
    config::save(&dir, &next)?;
    restart(&app, &sup, &next)
}

#[tauri::command]
async fn detect_claude(claude_path: Option<String>) -> Result<detect::ToolInfo, String> {
    let clean = claude_path.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    tauri::async_runtime::spawn_blocking(move || detect::detect_claude(clean.as_deref())).await.map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallPlans {
    claude: InstallPlan,
    running: Option<String>,
}

#[tauri::command]
fn install_plans(inst: State<'_, Installer>) -> Result<InstallPlans, String> {
    Ok(InstallPlans { claude: installer::plan_for("claude")?, running: inst.running_tool() })
}

/// Runs the fixed install command for `tool` ("claude"). Progress arrives
/// as `installer://log` events and completion as `installer://done`.
#[tauri::command]
fn install_tool(app: AppHandle, inst: State<'_, Installer>, tool: String) -> Result<(), String> {
    inst.install(&app, &tool)
}

#[tauri::command]
fn install_cancel(inst: State<'_, Installer>) {
    inst.cancel();
}

#[tauri::command]
fn open_link(which: String) -> Result<(), String> {
    installer::open_link(&which)
}

#[tauri::command]
fn open_terminal_claude(app: AppHandle) -> Result<(), String> {
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    installer::open_terminal_with_claude(&dir)
}

fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    profiles: Vec<db::Row>,
    layouts: Vec<db::Row>,
}

/// Everything the UI needs at startup in one round trip.
#[tauri::command]
fn store_snapshot(db: State<'_, db::Db>) -> Result<Snapshot, String> {
    Ok(Snapshot { profiles: db.profiles()?, layouts: db.layouts()? })
}

#[tauri::command]
fn profile_put(db: State<'_, db::Db>, key: String, doc: String) -> Result<(), String> {
    db.put_profile(&key, &doc, now_ms())
}

#[tauri::command]
fn profile_delete(db: State<'_, db::Db>, key: String) -> Result<(), String> {
    db.delete_profile(&key)
}

#[tauri::command]
fn layout_put(db: State<'_, db::Db>, theme: String, doc: String) -> Result<(), String> {
    db.put_layout(&theme, &doc, now_ms())
}

#[tauri::command]
fn layout_delete(db: State<'_, db::Db>, theme: String) -> Result<(), String> {
    db.delete_layout(&theme)
}

#[tauri::command]
fn history_append(db: State<'_, db::Db>, sessions: Vec<db::SessionIn>, events: Vec<db::EventIn>) -> Result<(), String> {
    db.append_history(&sessions, &events, now_ms())
}

#[tauri::command]
fn history_load(db: State<'_, db::Db>, since: i64, limit: i64) -> Result<db::History, String> {
    db.history(since, limit.clamp(1, 10_000))
}

#[tauri::command]
fn history_clear(db: State<'_, db::Db>) -> Result<(), String> {
    db.clear_history()
}

#[tauri::command]
fn bridge_state(sup: State<'_, Supervisor>) -> BridgeState {
    sup.state()
}

#[tauri::command]
fn bridge_connection(sup: State<'_, Supervisor>) -> Option<Connection> {
    sup.connection()
}

#[tauri::command]
fn bridge_restart(app: AppHandle, sup: State<'_, Supervisor>) -> Result<(), String> {
    let cfg = config::load(&config_dir(&app)?);
    restart(&app, &sup, &cfg)
}

#[tauri::command]
fn bridge_stop(app: AppHandle, sup: State<'_, Supervisor>) {
    sup.stop(&app);
}

#[tauri::command]
fn bridge_logs(sup: State<'_, Supervisor>) -> Vec<String> {
    sup.logs()
}

fn restart(app: &AppHandle, sup: &Supervisor, cfg: &IntegrationConfig) -> Result<(), String> {
    sup.start(app, cfg)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(Supervisor::default())
        .manage(Installer::default())
        .setup(|app| {
            let handle = app.handle().clone();
            let data_dir = handle.path().app_data_dir().map_err(|e| e.to_string())?;
            app.manage(db::Db::open(&data_dir.join("agentville.sqlite"))?);
            if let Ok(dir) = config_dir(&handle) {
                let cfg = config::load(&dir);
                if cfg.auto_start {
                    // Detection shells out; keep it off the main thread.
                    std::thread::spawn(move || {
                        let sup = handle.state::<Supervisor>();
                        let _ = sup.start(&handle, &cfg);
                    });
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            integration_get,
            integration_save,
            detect_claude,
            bridge_state,
            bridge_connection,
            bridge_restart,
            bridge_stop,
            bridge_logs,
            install_plans,
            install_tool,
            install_cancel,
            open_link,
            open_terminal_claude,
            store_snapshot,
            profile_put,
            profile_delete,
            layout_put,
            layout_delete,
            history_append,
            history_load,
            history_clear
        ])
        .build(tauri::generate_context!())
        .expect("error while building Agentville")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                app.state::<Supervisor>().stop(app);
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_info_reports_package_version() {
        let info = app_info();
        assert_eq!(info.version, env!("CARGO_PKG_VERSION"));
        assert_eq!(info.phase, 6);
    }
}
