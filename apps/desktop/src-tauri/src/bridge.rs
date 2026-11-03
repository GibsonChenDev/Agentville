//! Owns the built-in hook receiver's lifecycle and reports its state to the UI.

use crate::config::IntegrationConfig;
use crate::receiver::{default_origins, Receiver, ReceiverConfig};
use serde::Serialize;
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

const MAX_LOG_LINES: usize = 400;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", tag = "state")]
pub enum BridgeState {
    Stopped,
    Starting,
    Running { port: u16 },
    /// `code` is a stable, localizable error code.
    Failed { code: String, detail: Option<String> },
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub url: String,
    pub token: String,
}

#[derive(Default)]
struct Inner {
    receiver: Option<Receiver>,
    ui_token: Option<String>,
}

#[derive(Default)]
pub struct Supervisor {
    inner: Mutex<Inner>,
    state: Mutex<Option<BridgeState>>,
    logs: Arc<Mutex<VecDeque<String>>>,
}

impl Supervisor {
    pub fn state(&self) -> BridgeState {
        self.state.lock().unwrap().clone().unwrap_or(BridgeState::Stopped)
    }

    pub fn logs(&self) -> Vec<String> {
        self.logs.lock().unwrap().iter().cloned().collect()
    }

    pub fn connection(&self) -> Option<Connection> {
        let inner = self.inner.lock().unwrap();
        let port = inner.receiver.as_ref()?.port();
        Some(Connection { url: format!("http://127.0.0.1:{port}"), token: inner.ui_token.clone()? })
    }

    fn set_state(&self, app: &AppHandle, next: BridgeState) {
        *self.state.lock().unwrap() = Some(next.clone());
        let _ = app.emit("bridge://state", next);
    }

    pub fn stop(&self, app: &AppHandle) {
        let mut inner = self.inner.lock().unwrap();
        if let Some(r) = inner.receiver.take() {
            r.stop();
        }
        inner.ui_token = None;
        drop(inner);
        self.set_state(app, BridgeState::Stopped);
    }

    pub fn start(&self, app: &AppHandle, cfg: &IntegrationConfig) -> Result<(), String> {
        self.stop(app);
        self.set_state(app, BridgeState::Starting);
        let ui_token = crate::config::random_token();
        let logs = self.logs.clone();
        let log_app = app.clone();
        let log = move |line: String| {
            let mut l = logs.lock().unwrap();
            if l.len() >= MAX_LOG_LINES {
                l.pop_front();
            }
            l.push_back(line.clone());
            let _ = log_app.emit("bridge://log", line);
        };
        let rc = ReceiverConfig {
            port: cfg.hook_port,
            ui_token: ui_token.clone(),
            hook_token: cfg.hook_token.clone(),
            settings_path: crate::hooks::settings_path(),
            claude_path: cfg.claude_path.clone(),
            allowed_origins: default_origins(),
        };
        match Receiver::start(rc, log) {
            Ok(receiver) => {
                let port = receiver.port();
                let mut inner = self.inner.lock().unwrap();
                inner.receiver = Some(receiver);
                inner.ui_token = Some(ui_token);
                drop(inner);
                self.set_state(app, BridgeState::Running { port });
                Ok(())
            }
            Err(e) => {
                let (code, detail) = e.split_once(": ").map(|(c, d)| (c.to_string(), Some(d.to_string()))).unwrap_or((e.clone(), None));
                self.set_state(app, BridgeState::Failed { code: code.clone(), detail });
                Err(code)
            }
        }
    }
}
