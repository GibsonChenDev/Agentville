//! End-to-end checks for Codex's command hooks: the real `agentville` executable
//! as the forwarder (always), and the real Codex CLI firing hooks into the
//! receiver (`#[ignore]`d; needs a Codex binary, see `real_codex_fires_hooks`).

use agentville_lib::config::{self, IntegrationConfig};
use agentville_lib::receiver::{Receiver, ReceiverConfig};
use serde_json::Value;
use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const UI: &str = "ui-token-0123456789";
const EXE: &str = env!("CARGO_BIN_EXE_agentville");

fn tempdir(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("av-{tag}-{}", config::random_token()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

/// A fake home for child processes, with Agentville's config where the forwarder looks for it.
struct Home {
    root: PathBuf,
}

impl Home {
    fn new(port: u16, token: &str) -> Self {
        let root = tempdir("home");
        let home = Home { root };
        let mut cfg = IntegrationConfig::with_defaults(token.into());
        cfg.hook_port = port;
        config::save(&home.config_dir(), &cfg).unwrap();
        home
    }

    /// Mirrors `config::default_dir` for this fake home.
    fn config_dir(&self) -> PathBuf {
        let base = if cfg!(target_os = "macos") {
            self.root.join("Library").join("Application Support")
        } else if cfg!(windows) {
            self.root.join("AppData").join("Roaming")
        } else {
            self.root.join(".config")
        };
        base.join(config::IDENTIFIER)
    }

    fn apply(&self, cmd: &mut Command) {
        cmd.env("HOME", &self.root).env("USERPROFILE", &self.root).env("APPDATA", self.root.join("AppData").join("Roaming")).env("XDG_CONFIG_HOME", self.root.join(".config"));
    }
}

fn start(hook_token: &str, codex_hooks: PathBuf) -> Receiver {
    let cfg = ReceiverConfig {
        port: 0,
        ui_token: UI.into(),
        hook_token: hook_token.into(),
        hook_paths: BTreeMap::from([("codex".to_string(), codex_hooks)]),
        exe: EXE.into(),
        claude_path: None,
        allowed_origins: vec![],
    };
    Receiver::start(cfg, |_| {}).unwrap()
}

fn http(port: u16, method: &str, path: &str, body: &str) -> Value {
    let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
    write!(s, "{method} {path} HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer {UI}\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{body}", body.len()).unwrap();
    let mut out = String::new();
    s.read_to_string(&mut out).unwrap();
    serde_json::from_str(out.split_once("\r\n\r\n").unwrap().1).unwrap()
}

fn rpc(port: u16, body: &str) -> Value {
    http(port, "POST", "/rpc", body)["result"].clone()
}

/// The hooks the receiver kept (`hello.recent` on a fresh stream).
fn recent(port: u16) -> Vec<Value> {
    let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
    write!(s, "GET /stream HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer {UI}\r\n\r\n").unwrap();
    let mut reader = BufReader::new(s);
    let mut line = String::new();
    loop {
        line.clear();
        reader.read_line(&mut line).unwrap();
        if line.trim_start().starts_with('{') {
            let hello: Value = serde_json::from_str(line.trim()).unwrap();
            return hello["recent"].as_array().unwrap().clone();
        }
    }
}

/// Runs the forwarder like Codex does; returns (exit code, stdout, stderr).
fn forward(home: &Home, payload: &[u8]) -> (Option<i32>, String, String) {
    let mut cmd = Command::new(EXE);
    cmd.args(["--agentville-hook", "codex"]).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    home.apply(&mut cmd);
    let mut child = cmd.spawn().unwrap();
    child.stdin.take().unwrap().write_all(payload).unwrap();
    let out = child.wait_with_output().unwrap();
    (out.status.code(), String::from_utf8_lossy(&out.stdout).into(), String::from_utf8_lossy(&out.stderr).into())
}

#[test]
fn forwarder_delivers_codex_hooks_silently() {
    let token = config::random_token();
    let r = start(&token, tempdir("codex").join("hooks.json"));
    let home = Home::new(r.port(), &token);

    let payload = br#"{"hook_event_name":"PreToolUse","session_id":"019a5b2c-thread","turn_id":"t1","cwd":"/w","model":"gpt-5.5","tool_name":"apply_patch","tool_use_id":"call_1","tool_input":{"command":"*** Begin Patch\n*** Update File: a.ts\n*** End Patch"}}"#;
    // Observe-only: exit 0 and no output, since Codex treats both as instructions.
    assert_eq!(forward(&home, payload), (Some(0), String::new(), String::new()));
    assert_eq!(forward(&home, b"not json"), (Some(0), String::new(), String::new()));

    let hooks = recent(r.port());
    assert_eq!(hooks.len(), 1);
    assert_eq!(hooks[0]["provider"], "codex");
    assert_eq!(hooks[0]["body"]["tool_name"], "apply_patch");
    let st = rpc(r.port(), r#"{"method":"status"}"#);
    assert_eq!(st["hooks"]["providers"]["codex"]["received"], 1);
    assert_eq!(st["hooks"]["rejected"], 1);
}

#[test]
fn forwarder_is_harmless_when_agentville_is_not_running() {
    let token = config::random_token();
    let port = {
        let r = start(&token, tempdir("codex").join("hooks.json"));
        r.port()
    }; // receiver dropped: nothing listens on this port any more
    let home = Home::new(port, &token);
    let t0 = Instant::now();
    assert_eq!(forward(&home, br#"{"hook_event_name":"Stop","session_id":"s"}"#), (Some(0), String::new(), String::new()));
    assert!(t0.elapsed() < Duration::from_secs(3), "{:?}", t0.elapsed());
    // No config at all (Agentville never ran): still silent.
    let empty = Home { root: tempdir("empty") };
    assert_eq!(forward(&empty, b"{}"), (Some(0), String::new(), String::new()));
}

/// Runs the hook the way Codex does on Windows (codex-rs hooks/src/engine/command_runner.rs):
/// `cmd.exe /C "<command>"` as a raw argument, a cleared environment with only the
/// session's core variables, no window, the payload on stdin.
#[cfg(windows)]
fn run_like_codex(home: &Home, command: &str, payload: &[u8]) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let comspec = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into());
    let mut cmd = Command::new(&comspec);
    cmd.arg("/C").raw_arg(format!("\"{command}\"")).env_clear();
    for key in ["SystemRoot", "windir", "COMSPEC", "PATH", "PATHEXT", "TEMP", "TMP", "SystemDrive", "ProgramData", "ProgramFiles"] {
        if let Some(v) = std::env::var_os(key) {
            cmd.env(key, v);
        }
    }
    home.apply(&mut cmd);
    cmd.env("LOCALAPPDATA", home.root.join("AppData").join("Local"))
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd.spawn().unwrap();
    child.stdin.take().unwrap().write_all(payload).unwrap();
    let out = child.wait_with_output().unwrap();
    assert_eq!((out.status.code(), out.stdout.len(), out.stderr.len()), (Some(0), 0, 0), "{}", String::from_utf8_lossy(&out.stderr));
}

/// Waits (cmd.exe doesn't wait for a GUI-subsystem program) until the receiver has `n` hooks.
#[cfg(windows)]
fn recent_eventually(port: u16, n: usize) -> Vec<Value> {
    let deadline = Instant::now() + Duration::from_secs(8);
    loop {
        let hooks = recent(port);
        if hooks.len() >= n || Instant::now() > deadline {
            return hooks;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

/// The PE subsystem of an executable: 2 = GUI (no console, like the installed app), 3 = console.
#[cfg(windows)]
fn pe_subsystem(path: &str) -> u16 {
    let b = std::fs::read(path).unwrap();
    let pe = u32::from_le_bytes(b[0x3c..0x40].try_into().unwrap()) as usize;
    // PE signature (4) + file header (20), then the optional header's Subsystem at offset 68.
    u16::from_le_bytes(b[pe + 24 + 68..pe + 24 + 70].try_into().unwrap())
}

#[cfg(windows)]
#[test]
fn forwarder_delivers_when_codex_runs_it_through_cmd() {
    use agentville_lib::{hooks, providers};
    // CI builds this without debug assertions so the executable is GUI-subsystem, as installed.
    if std::env::var_os("AGENTVILLE_EXPECT_GUI_EXE").is_some() {
        assert_eq!(pe_subsystem(EXE), 2, "the test should run the GUI-subsystem build");
    }
    let token = config::random_token();
    let r = start(&token, tempdir("codex").join("hooks.json"));
    let home = Home::new(r.port(), &token);
    // The installed path, and one with a space (quoted by hook_command).
    let spaced = tempdir("exe").join("Agent ville");
    std::fs::create_dir_all(&spaced).unwrap();
    let copy = spaced.join("agentville.exe");
    std::fs::copy(EXE, &copy).unwrap();
    for (i, exe) in [EXE.to_string(), copy.to_string_lossy().into_owned()].iter().enumerate() {
        let command = hooks::hook_command(&providers::CODEX, exe);
        let payload = format!(r#"{{"hook_event_name":"UserPromptSubmit","session_id":"win-{i}","turn_id":"t","cwd":"C:\\w","model":"gpt-5.5","permission_mode":"default","transcript_path":"C:\\t.jsonl","prompt":"hi"}}"#);
        run_like_codex(&home, &command, payload.as_bytes());
        let got = recent_eventually(r.port(), i + 1);
        assert_eq!(got.len(), i + 1, "nothing arrived for `{command}`");
        assert_eq!(got[i]["body"]["session_id"], format!("win-{i}"));
    }
}

fn codex_bin() -> Option<String> {
    std::env::var("AGENTVILLE_CODEX_BIN").ok().or_else(|| agentville_lib::detect::detect_codex().path)
}

/// Real Codex CLI → hooks.json written by Agentville → forwarder → receiver.
/// Uses an empty CODEX_HOME (no account, nothing sent to a model: the run fails
/// at the model request, after the session hooks fired). Run with
/// `cargo test --test codex_forwarding -- --ignored --nocapture`.
#[test]
#[ignore = "needs a Codex CLI (AGENTVILLE_CODEX_BIN or auto-detected)"]
fn real_codex_fires_hooks() {
    let bin = codex_bin().expect("no Codex CLI found");
    let token = config::random_token();
    let codex_home = tempdir("codex-home");
    let r = start(&token, codex_home.join("hooks.json"));
    let installed = rpc(r.port(), r#"{"method":"hooks.install","params":{"provider":"codex"}}"#);
    assert_eq!((installed["installed"].as_bool(), installed["stale"].as_bool()), (Some(true), Some(false)), "{installed}");
    let home = Home::new(r.port(), &token);
    let work = tempdir("work");

    let mut cmd = Command::new(&bin);
    cmd.args(["exec", "--skip-git-repo-check", "--ephemeral", "--dangerously-bypass-hook-trust", "-C"])
        .arg(&work)
        .arg("Reply with the single word: hi")
        .env("CODEX_HOME", &codex_home)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    home.apply(&mut cmd);
    let mut child = cmd.spawn().unwrap();
    let deadline = Instant::now() + Duration::from_secs(90);
    while child.try_wait().unwrap().is_none() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(200));
    }
    let _ = child.kill();
    let out = child.wait_with_output().unwrap();
    eprintln!("codex exit: {:?}\n--- stderr (tail) ---\n{}", out.status.code(), tail(&String::from_utf8_lossy(&out.stderr), 25));

    let hooks = recent(r.port());
    let events: Vec<String> = hooks.iter().map(|h| format!("{}:{}", h["provider"].as_str().unwrap_or("?"), h["body"]["hook_event_name"].as_str().unwrap_or("?"))).collect();
    eprintln!("received: {events:?}");
    if let Some(first) = hooks.first() {
        eprintln!("first payload keys: {:?}", first["body"].as_object().map(|o| o.keys().cloned().collect::<Vec<_>>()));
    }
    assert!(!hooks.is_empty(), "Codex fired no hooks into Agentville");
    assert!(hooks.iter().all(|h| h["provider"] == "codex"));
    assert!(events.iter().any(|e| e == "codex:SessionStart" || e == "codex:UserPromptSubmit"), "{events:?}");
    let _ = std::fs::remove_dir_all(&codex_home);
    let _ = std::fs::remove_dir_all(&work);
}

fn tail(s: &str, n: usize) -> String {
    let lines: Vec<&str> = s.lines().collect();
    lines[lines.len().saturating_sub(n)..].join("\n")
}
