//! The local hook receiver (Monitor Mode), built into the app.
//!
//! * `POST /hooks/<provider>` — hooks from each observed agent (see
//!   `providers`): Claude Code's http hooks, or Codex's command hooks via the
//!   forwarder. Authenticated with the per-install hook token and always
//!   answered `{}` immediately: observe-only.
//! * `GET /stream` — NDJSON stream of raw hooks for the UI (per-launch UI token),
//!   each tagged with its provider.
//! * `POST /rpc` — hook installation per provider, git location, agent status.
//!
//! Loopback only. The receiver validates the envelope (JSON object, event name,
//! session id) and stamps id/sequence/time; the UI's tested TypeScript
//! normalizer turns raw hooks into domain events.

use crate::{detect, gitinfo, hooks, providers};
use serde_json::{json, Value};
use std::collections::{BTreeMap, VecDeque};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, Receiver as Rx, SyncSender, TrySendError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};

const HOOK_BODY_LIMIT: usize = 64 * 1024;
const RPC_BODY_LIMIT: usize = 256 * 1024;
const RECENT: usize = 500;
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Clone)]
pub struct ReceiverConfig {
    pub port: u16,
    pub ui_token: String,
    pub hook_token: String,
    /// Hooks file per provider id; providers missing here can't be installed.
    pub hook_paths: BTreeMap<String, PathBuf>,
    /// Agentville's executable, which command hooks run as the forwarder.
    pub exe: String,
    pub claude_path: Option<String>,
    pub allowed_origins: Vec<String>,
}

/// Every provider's real hooks file.
pub fn default_hook_paths() -> BTreeMap<String, PathBuf> {
    providers::ALL.iter().map(|p| (p.id.to_string(), p.hooks_path())).collect()
}

pub fn default_origins() -> Vec<String> {
    ["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost", "http://localhost:1420", "http://localhost:1421", "http://127.0.0.1:1420"]
        .iter()
        .map(|s| s.to_string())
        .collect()
}

#[derive(Default, Clone)]
struct Stats {
    received: u64,
    rejected: u64,
    last_at: Option<i64>,
    /// Accepted hooks per provider id: (count, last time).
    by_provider: BTreeMap<&'static str, (u64, i64)>,
}

struct Shared {
    cfg: ReceiverConfig,
    port: u16,
    boot: String,
    seq: AtomicU64,
    stats: Mutex<Stats>,
    recent: Mutex<VecDeque<Value>>,
    clients: Mutex<Vec<SyncSender<String>>>,
    status_dirty: AtomicBool,
    stopped: AtomicBool,
    log: Box<dyn Fn(String) + Send + Sync>,
}

pub struct Receiver {
    server: Arc<Server>,
    shared: Arc<Shared>,
}

pub fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

impl Receiver {
    pub fn start(cfg: ReceiverConfig, log: impl Fn(String) + Send + Sync + 'static) -> Result<Self, String> {
        let server = Server::http(("127.0.0.1", cfg.port)).map_err(|e| {
            let text = e.to_string();
            if text.contains("in use") || text.contains("AddrInUse") || text.contains("os error 48") || text.contains("os error 10048") {
                format!("port_in_use: {text}")
            } else {
                format!("listen_failed: {text}")
            }
        })?;
        let port = server.server_addr().to_ip().map(|a| a.port()).unwrap_or(cfg.port);
        let server = Arc::new(server);
        let shared = Arc::new(Shared {
            cfg,
            port,
            boot: crate::config::random_token()[..8].to_string(),
            seq: AtomicU64::new(0),
            stats: Mutex::default(),
            recent: Mutex::default(),
            clients: Mutex::default(),
            status_dirty: AtomicBool::new(false),
            stopped: AtomicBool::new(false),
            log: Box::new(log),
        });
        {
            let server = server.clone();
            let shared = shared.clone();
            std::thread::spawn(move || {
                for req in server.incoming_requests() {
                    let shared = shared.clone();
                    std::thread::spawn(move || handle(&shared, req));
                }
            });
        }
        {
            // Heartbeat: throttled status pushes (≤ 1/s) and a ping every 15 s.
            let shared = shared.clone();
            std::thread::spawn(move || {
                let mut ticks = 0u32;
                while !shared.stopped.load(Ordering::Relaxed) {
                    std::thread::sleep(Duration::from_secs(1));
                    ticks += 1;
                    if shared.status_dirty.swap(false, Ordering::Relaxed) {
                        broadcast(&shared, &json!({ "type": "status", "status": status(&shared) }));
                    }
                    if ticks % 15 == 0 {
                        broadcast(&shared, &json!({ "type": "ping", "at": now_ms() }));
                    }
                }
            });
        }
        (shared.log)(format!("receiver listening on 127.0.0.1:{port}"));
        Ok(Self { server, shared })
    }

    pub fn port(&self) -> u16 {
        self.shared.port
    }

    pub fn stop(&self) {
        self.shared.stopped.store(true, Ordering::Relaxed);
        self.shared.clients.lock().unwrap().clear(); // ends every stream
        self.server.unblock();
    }
}

impl Drop for Receiver {
    fn drop(&mut self) {
        self.stop();
    }
}

fn status(s: &Shared) -> Value {
    let st = s.stats.lock().unwrap().clone();
    let by: serde_json::Map<String, Value> = st.by_provider.iter().map(|(id, (n, at))| (id.to_string(), json!({ "received": n, "lastAt": at }))).collect();
    json!({ "version": VERSION, "port": s.port, "hooks": { "received": st.received, "rejected": st.rejected, "lastAt": st.last_at, "providers": by } })
}

fn broadcast(s: &Shared, msg: &Value) {
    let line = msg.to_string();
    s.clients.lock().unwrap().retain(|tx| !matches!(tx.try_send(line.clone()), Err(TrySendError::Disconnected(_))));
}

fn header(req: &Request, name: &'static str) -> Option<String> {
    req.headers().iter().find(|h| h.field.equiv(name)).map(|h| h.value.as_str().to_string())
}

fn constant_eq(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn bearer(req: &Request, token: &str) -> bool {
    header(req, "Authorization").and_then(|v| v.strip_prefix("Bearer ").map(str::to_string)).is_some_and(|v| constant_eq(&v, token))
}

fn cors(s: &Shared, req: &Request) -> Vec<Header> {
    match header(req, "Origin") {
        Some(o) if s.cfg.allowed_origins.contains(&o) => vec![
            Header::from_bytes("Access-Control-Allow-Origin", o.as_bytes()).unwrap(),
            Header::from_bytes("Vary", "Origin").unwrap(),
        ],
        _ => vec![],
    }
}

fn respond_json(req: Request, code: u16, body: &Value, extra: Vec<Header>) {
    let mut res = Response::from_string(body.to_string()).with_status_code(StatusCode(code));
    res.add_header(Header::from_bytes("Content-Type", "application/json").unwrap());
    for h in extra {
        res.add_header(h);
    }
    let _ = req.respond(res);
}

fn read_body(req: &mut Request, limit: usize) -> Option<String> {
    let mut buf = Vec::new();
    req.as_reader().take(limit as u64 + 1).read_to_end(&mut buf).ok()?;
    if buf.len() > limit {
        return None;
    }
    String::from_utf8(buf).ok()
}

fn valid_session(v: &Value) -> bool {
    v.get("session_id")
        .and_then(Value::as_str)
        .is_some_and(|s| !s.is_empty() && s.len() <= 128 && s.chars().all(|c| c.is_ascii_alphanumeric() || "._:-".contains(c)))
}

fn handle(s: &Arc<Shared>, mut req: Request) {
    let path = req.url().split('?').next().unwrap_or("").to_string();
    let method = req.method().clone();

    if let Some(provider) = path.strip_prefix("/hooks/").filter(|_| method == Method::Post).and_then(providers::get) {
        let mark_rejected = |s: &Shared| {
            s.stats.lock().unwrap().rejected += 1;
            s.status_dirty.store(true, Ordering::Relaxed);
        };
        if !bearer(&req, &s.cfg.hook_token) {
            mark_rejected(s);
            return respond_json(req, 401, &json!({ "error": "unauthorized" }), vec![]);
        }
        let Some(body) = read_body(&mut req, HOOK_BODY_LIMIT) else {
            mark_rejected(s);
            return respond_json(req, 413, &json!({ "error": "too_large" }), vec![]);
        };
        // Answer first: observe-only, never influence or delay Claude's decisions.
        respond_json(req, 200, &json!({}), vec![]);
        let parsed: Option<Value> = serde_json::from_str(&body).ok();
        let Some(raw) = parsed.filter(|v| v.is_object() && v.get("hook_event_name").and_then(Value::as_str).is_some() && valid_session(v)) else {
            mark_rejected(s);
            return;
        };
        let seq = s.seq.fetch_add(1, Ordering::Relaxed) + 1;
        let at = now_ms();
        let hook = json!({ "id": format!("{}-{}", s.boot, seq), "seq": seq, "receivedAt": at, "provider": provider.id, "body": raw });
        {
            let mut recent = s.recent.lock().unwrap();
            recent.push_back(hook.clone());
            while recent.len() > RECENT {
                recent.pop_front();
            }
        }
        {
            let mut st = s.stats.lock().unwrap();
            st.received += 1;
            st.last_at = Some(at);
            let p = st.by_provider.entry(provider.id).or_default();
            *p = (p.0 + 1, at);
        }
        s.status_dirty.store(true, Ordering::Relaxed);
        broadcast(s, &json!({ "type": "hook", "hook": hook }));
        return;
    }

    if method == Method::Options {
        let mut headers = cors(s, &req);
        headers.push(Header::from_bytes("Access-Control-Allow-Methods", "GET, POST").unwrap());
        headers.push(Header::from_bytes("Access-Control-Allow-Headers", "Authorization, Content-Type").unwrap());
        headers.push(Header::from_bytes("Access-Control-Max-Age", "600").unwrap());
        let mut res = Response::empty(204);
        for h in headers {
            res.add_header(h);
        }
        let _ = req.respond(res);
        return;
    }
    let cors_headers = cors(s, &req);
    if method == Method::Get && path == "/health" {
        return respond_json(req, 200, &json!({ "ok": true, "version": VERSION }), cors_headers);
    }
    if !bearer(&req, &s.cfg.ui_token) {
        return respond_json(req, 401, &json!({ "error": "unauthorized" }), cors_headers);
    }
    if method == Method::Get && path == "/stream" {
        return stream(s, req, cors_headers);
    }
    if method == Method::Post && path == "/rpc" {
        let result = read_body(&mut req, RPC_BODY_LIMIT)
            .ok_or_else(|| "too_large".to_string())
            .and_then(|b| serde_json::from_str::<Value>(&b).map_err(|_| "invalid_json".to_string()))
            .and_then(|r| rpc(s, &r));
        let body = match result {
            Ok(v) => json!({ "ok": true, "result": v }),
            Err(e) => {
                let (code, detail) = e.split_once(": ").map(|(c, d)| (c.to_string(), Some(d.to_string()))).unwrap_or((e, None));
                if code == "internal" {
                    (s.log)(format!("rpc error: {detail:?}"));
                }
                json!({ "ok": false, "error": { "code": code, "detail": detail } })
            }
        };
        return respond_json(req, 200, &body, cors_headers);
    }
    respond_json(req, 404, &json!({ "error": "not_found" }), cors_headers);
}

/// Long-lived chunked NDJSON response, flushed line by line.
fn stream(s: &Arc<Shared>, req: Request, cors_headers: Vec<Header>) {
    let (tx, rx): (SyncSender<String>, Rx<String>) = sync_channel(2048);
    let hello = json!({ "type": "hello", "status": status(s), "recent": s.recent.lock().unwrap().iter().cloned().collect::<Vec<_>>() });
    let _ = tx.try_send(hello.to_string());
    s.clients.lock().unwrap().push(tx);
    let mut head = String::from("HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson\r\nCache-Control: no-store\r\nTransfer-Encoding: chunked\r\n");
    for h in &cors_headers {
        head.push_str(&format!("{}: {}\r\n", h.field.as_str(), h.value.as_str()));
    }
    head.push_str("\r\n");
    let mut w = req.into_writer();
    if w.write_all(head.as_bytes()).and_then(|_| w.flush()).is_err() {
        return;
    }
    while let Ok(line) = rx.recv() {
        let chunk = format!("{}\n", line);
        if write!(w, "{:x}\r\n{}\r\n", chunk.len(), chunk).and_then(|_| w.flush()).is_err() {
            break;
        }
    }
    let _ = w.write_all(b"0\r\n\r\n");
}

fn rpc(s: &Shared, req: &Value) -> Result<Value, String> {
    let method = req.get("method").and_then(Value::as_str).unwrap_or("");
    // Hook methods name their provider; older UIs that don't mean Claude Code.
    let provider_id = req.pointer("/params/provider").and_then(Value::as_str).unwrap_or(providers::CLAUDE.id);
    let hook_file = || -> Result<(&'static providers::Provider, &PathBuf), String> {
        let p = providers::get(provider_id).ok_or("unknown_provider")?;
        Ok((p, s.cfg.hook_paths.get(p.id).ok_or("unknown_provider")?))
    };
    let target = hooks::Target { port: s.port, token: s.cfg.hook_token.clone(), exe: s.cfg.exe.clone() };
    let inspect = || -> Result<Value, String> {
        let (p, path) = hook_file()?;
        let (v, _) = hooks::read_settings(path)?;
        let i = hooks::inspect(p, &v, &target);
        Ok(json!({ "provider": p.id, "settingsPath": path.to_string_lossy(), "installed": i.installed, "stale": i.stale, "events": i.events }))
    };
    match method {
        "status" => Ok(status(s)),
        "hooks.status" => inspect(),
        "hooks.preview" => {
            let (p, path) = hook_file()?;
            let install = req.pointer("/params/action").and_then(Value::as_str) != Some("uninstall");
            let (v, raw) = hooks::read_settings(path)?;
            let next = if install { hooks::with_agentville(p, &v, &target) } else { hooks::without_agentville(&v) };
            let before = if raw.is_empty() { String::new() } else { hooks::serialize(&v) };
            let after = hooks::serialize(&next);
            let changed = before != after && !(before.is_empty() && after == "{}\n");
            Ok(json!({ "provider": p.id, "settingsPath": path.to_string_lossy(), "before": before, "after": after, "changed": changed }))
        }
        "hooks.install" | "hooks.uninstall" => {
            let (p, path) = hook_file()?;
            let (v, _) = hooks::read_settings(path)?;
            let next = if method == "hooks.install" { hooks::with_agentville(p, &v, &target) } else { hooks::without_agentville(&v) };
            let mut backup = None;
            if next != v || !path.exists() && method == "hooks.install" {
                backup = hooks::write_settings(path, &next, now_ms())?;
                (s.log)(format!("{method} ({}) → {} (backup: {:?})", p.id, path.display(), backup));
            }
            let mut out = inspect()?;
            out["backup"] = backup.map(|b| Value::String(b.to_string_lossy().into())).unwrap_or(Value::Null);
            Ok(out)
        }
        "git.info" => {
            let cwd = req.pointer("/params/cwd").and_then(Value::as_str).unwrap_or("");
            Ok(gitinfo::git_info(cwd).map(|g| serde_json::to_value(g).unwrap()).unwrap_or(Value::Null))
        }
        "claude.status" => {
            let info = detect::detect_claude(s.cfg.claude_path.as_deref());
            let logged_in = info.path.as_deref().filter(|_| info.ok).and_then(detect::claude_logged_in);
            Ok(json!({ "path": info.path, "version": info.version, "installed": info.ok, "loggedIn": logged_in }))
        }
        // Whether an agent is installed, for providers without a full setup checklist.
        "agent.detect" => match providers::get(provider_id).map(|p| p.id) {
            Some("claude") => {
                let info = detect::detect_claude(s.cfg.claude_path.as_deref());
                Ok(json!({ "provider": "claude", "installed": info.ok, "path": info.path, "version": info.version }))
            }
            Some("codex") => {
                let info = detect::detect_codex();
                Ok(json!({ "provider": "codex", "installed": info.installed, "path": info.path, "version": info.version, "home": info.home }))
            }
            _ => Err("unknown_provider".into()),
        },
        _ => Err("unknown_method".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader};
    use std::net::TcpStream;

    const UI: &str = "ui-token-0123456789";
    const HOOK: &str = "hook-token-0123456789";

    fn start() -> (Receiver, PathBuf) {
        let dir = std::env::temp_dir().join(format!("av-recv-{}", crate::config::random_token()));
        std::fs::create_dir_all(&dir).unwrap();
        let settings = dir.join("settings.json");
        std::fs::write(&settings, r#"{"model":"opus"}"#).unwrap();
        let codex = dir.join("codex-hooks.json");
        let hook_paths = BTreeMap::from([("claude".to_string(), settings.clone()), ("codex".to_string(), codex)]);
        let cfg = ReceiverConfig { port: 0, ui_token: UI.into(), hook_token: HOOK.into(), hook_paths, exe: "/opt/av/agentville".into(), claude_path: None, allowed_origins: vec!["http://localhost:1420".into()] };
        (Receiver::start(cfg, |_| {}).unwrap(), settings)
    }

    /// Minimal HTTP/1.1 client: returns (status, headers, body).
    fn http(port: u16, method: &str, path: &str, headers: &[(&str, &str)], body: &str) -> (u16, String, String) {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        let mut req = format!("{method} {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\nContent-Length: {}\r\n", body.len());
        for (k, v) in headers {
            req.push_str(&format!("{k}: {v}\r\n"));
        }
        req.push_str("\r\n");
        req.push_str(body);
        s.write_all(req.as_bytes()).unwrap();
        let mut out = String::new();
        s.read_to_string(&mut out).unwrap();
        let (head, body) = out.split_once("\r\n\r\n").unwrap();
        (head[9..12].parse().unwrap(), head.to_string(), body.to_string())
    }

    fn rpc_call(port: u16, body: &str) -> Value {
        let (_, _, b) = http(port, "POST", "/rpc", &[("Authorization", &format!("Bearer {UI}"))], body);
        serde_json::from_str(&b).unwrap()
    }

    #[test]
    fn requires_tokens() {
        let (r, _) = start();
        assert_eq!(http(r.port(), "POST", "/hooks/claude", &[("Authorization", "Bearer wrong-token-00000000")], "{}").0, 401);
        assert_eq!(http(r.port(), "GET", "/stream", &[], "").0, 401);
        assert_eq!(http(r.port(), "POST", "/rpc", &[("Authorization", "Bearer nope")], "{}").0, 401);
        assert_eq!(http(r.port(), "GET", "/health", &[], "").0, 200);
    }

    #[test]
    fn streams_hooks_with_ids_and_replays_recent() {
        let (r, _) = start();
        let port = r.port();
        let hook_body = r#"{"hook_event_name":"PreToolUse","session_id":"abc","cwd":"/w","tool_name":"Read"}"#;
        let (code, _, b) = http(port, "POST", "/hooks/claude?src=agentville", &[("Authorization", &format!("Bearer {HOOK}"))], hook_body);
        assert_eq!((code, b.as_str()), (200, "{}"));
        // A new stream client gets the hook in `hello.recent`, then live hooks.
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        write!(s, "GET /stream HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer {UI}\r\n\r\n").unwrap();
        let mut reader = BufReader::new(s.try_clone().unwrap());
        let mut lines = Vec::new();
        let mut line = String::new();
        while lines.len() < 2 {
            line.clear();
            reader.read_line(&mut line).unwrap();
            if line.trim_start().starts_with('{') {
                lines.push(serde_json::from_str::<Value>(line.trim()).unwrap());
                if lines.len() == 1 {
                    http(port, "POST", "/hooks/claude", &[("Authorization", &format!("Bearer {HOOK}"))], r#"{"hook_event_name":"Stop","session_id":"abc"}"#);
                }
            }
        }
        assert_eq!(lines[0]["type"], "hello");
        assert_eq!(lines[0]["recent"][0]["body"]["tool_name"], "Read");
        assert_eq!(lines[0]["recent"][0]["seq"], 1);
        assert_eq!(lines[1]["type"], "hook");
        assert_eq!(lines[1]["hook"]["body"]["hook_event_name"], "Stop");
        assert_eq!(lines[1]["hook"]["seq"], 2);
        assert_ne!(lines[0]["recent"][0]["id"], lines[1]["hook"]["id"]);
    }

    #[test]
    fn counts_malformed_and_oversized_hooks() {
        let (r, _) = start();
        let auth = format!("Bearer {HOOK}");
        for body in ["not json", "[1]", r#"{"session_id":"s"}"#, r#"{"hook_event_name":"Stop","session_id":"../../etc"}"#] {
            assert_eq!(http(r.port(), "POST", "/hooks/claude", &[("Authorization", &auth)], body).0, 200);
        }
        let big = format!(r#"{{"x":"{}"}}"#, "a".repeat(HOOK_BODY_LIMIT));
        assert_eq!(http(r.port(), "POST", "/hooks/claude", &[("Authorization", &auth)], &big).0, 413);
        let st = rpc_call(r.port(), r#"{"method":"status"}"#);
        assert_eq!(st["result"]["hooks"]["rejected"], 5);
        assert_eq!(st["result"]["hooks"]["received"], 0);
    }

    #[test]
    fn installs_and_uninstalls_hooks_with_backup() {
        let (r, settings) = start();
        assert_eq!(rpc_call(r.port(), r#"{"method":"hooks.status"}"#)["result"]["installed"], false);
        let preview = rpc_call(r.port(), r#"{"method":"hooks.preview","params":{"action":"install"}}"#);
        assert_eq!(preview["result"]["changed"], true);
        assert!(preview["result"]["after"].as_str().unwrap().contains(&format!("127.0.0.1:{}", r.port())));
        let installed = rpc_call(r.port(), r#"{"method":"hooks.install"}"#)["result"].clone();
        assert_eq!((installed["installed"].as_bool(), installed["stale"].as_bool()), (Some(true), Some(false)));
        assert!(installed["backup"].as_str().unwrap().contains("agentville-backup"));
        rpc_call(r.port(), r#"{"method":"hooks.uninstall"}"#);
        assert_eq!(serde_json::from_str::<Value>(&std::fs::read_to_string(&settings).unwrap()).unwrap(), json!({ "model": "opus" }));
        std::fs::write(&settings, "{ broken").unwrap();
        assert_eq!(rpc_call(r.port(), r#"{"method":"hooks.install"}"#)["error"]["code"], "settings_invalid_json");
        assert_eq!(std::fs::read_to_string(&settings).unwrap(), "{ broken");
        assert_eq!(rpc_call(r.port(), r#"{"method":"nope"}"#)["error"]["code"], "unknown_method");
    }

    #[test]
    fn tags_hooks_with_their_provider_and_counts_each() {
        let (r, _) = start();
        let auth = format!("Bearer {HOOK}");
        let body = r#"{"hook_event_name":"Stop","session_id":"019a-thread"}"#;
        assert_eq!(http(r.port(), "POST", "/hooks/codex?src=agentville", &[("Authorization", &auth)], body).0, 200);
        assert_eq!(http(r.port(), "POST", "/hooks/claude", &[("Authorization", &auth)], body).0, 200);
        // Unknown providers aren't hook endpoints (they fall through to the UI-token check).
        assert_eq!(http(r.port(), "POST", "/hooks/other", &[("Authorization", &auth)], body).0, 401);
        assert_eq!(http(r.port(), "POST", "/hooks/codex", &[("Authorization", "Bearer wrong-token-00000000")], body).0, 401);
        let recent = r.shared.recent.lock().unwrap().clone();
        assert_eq!(recent.iter().map(|h| h["provider"].as_str().unwrap()).collect::<Vec<_>>(), ["codex", "claude"]);
        let st = rpc_call(r.port(), r#"{"method":"status"}"#)["result"].clone();
        assert_eq!(st["hooks"]["received"], 2);
        assert_eq!(st["hooks"]["providers"]["codex"]["received"], 1);
        assert_eq!(st["hooks"]["providers"]["claude"]["received"], 1);
    }

    #[test]
    fn installs_codex_hooks_in_their_own_file() {
        let (r, settings) = start();
        let codex = settings.with_file_name("codex-hooks.json");
        let status = rpc_call(r.port(), r#"{"method":"hooks.status","params":{"provider":"codex"}}"#)["result"].clone();
        assert_eq!((status["provider"].as_str(), status["installed"].as_bool()), (Some("codex"), Some(false)));
        let installed = rpc_call(r.port(), r#"{"method":"hooks.install","params":{"provider":"codex"}}"#)["result"].clone();
        assert_eq!((installed["installed"].as_bool(), installed["stale"].as_bool()), (Some(true), Some(false)));
        let file: Value = serde_json::from_str(&std::fs::read_to_string(&codex).unwrap()).unwrap();
        assert_eq!(file["hooks"]["Stop"][0]["hooks"][0]["command"], "/opt/av/agentville --agentville-hook codex");
        assert!(!std::fs::read_to_string(&codex).unwrap().contains(HOOK));
        // Claude's settings are untouched, and its status is independent.
        assert_eq!(std::fs::read_to_string(&settings).unwrap(), r#"{"model":"opus"}"#);
        assert_eq!(rpc_call(r.port(), r#"{"method":"hooks.status"}"#)["result"]["installed"], false);
        rpc_call(r.port(), r#"{"method":"hooks.uninstall","params":{"provider":"codex"}}"#);
        assert_eq!(serde_json::from_str::<Value>(&std::fs::read_to_string(&codex).unwrap()).unwrap(), json!({}));
        assert_eq!(rpc_call(r.port(), r#"{"method":"hooks.status","params":{"provider":"nope"}}"#)["error"]["code"], "unknown_provider");
    }

    #[test]
    fn only_grants_cors_to_allowed_origins() {
        let (r, _) = start();
        let (_, head, _) = http(r.port(), "GET", "/health", &[("Origin", "http://localhost:1420")], "");
        assert!(head.contains("Access-Control-Allow-Origin: http://localhost:1420"));
        let (_, head, _) = http(r.port(), "GET", "/health", &[("Origin", "https://evil.example")], "");
        assert!(!head.contains("Access-Control-Allow-Origin"));
    }

    #[test]
    fn reports_port_in_use() {
        let (r, _) = start();
        let cfg = ReceiverConfig { port: r.port(), ui_token: UI.into(), hook_token: HOOK.into(), hook_paths: BTreeMap::new(), exe: String::new(), claude_path: None, allowed_origins: vec![] };
        let err = Receiver::start(cfg, |_| {}).err().unwrap();
        assert!(err.starts_with("port_in_use") || err.starts_with("listen_failed"), "{err}");
    }
}
