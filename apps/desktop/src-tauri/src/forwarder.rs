//! `agentville --agentville-hook <provider>`: run by command hooks (Codex),
//! forwards the hook payload on stdin to the running receiver.
//!
//! Observe-only by construction: it never writes to stdout or stderr and always
//! exits 0, because agents treat hook output and exit codes as instructions
//! (Codex adds SessionStart stdout to the model's context, and exit 2 blocks a
//! tool). When Agentville isn't running the payload is dropped.

use crate::config::{self, IntegrationConfig};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

const BODY_LIMIT: usize = 64 * 1024;

/// Returns the provider id when the process was started as a hook forwarder.
pub fn requested(args: &[String]) -> Option<&str> {
    match args {
        [_, flag, provider, ..] if flag == crate::hooks::FORWARD_ARG => Some(provider.as_str()),
        _ => None,
    }
}

pub fn run(provider: &str) {
    let mut body = Vec::new();
    let read = std::io::stdin().take(BODY_LIMIT as u64 + 1).read_to_end(&mut body);
    if read.is_err() || body.len() > BODY_LIMIT || crate::providers::get(provider).is_none() {
        return;
    }
    if let Some(cfg) = config::read(&config::default_dir()) {
        let _ = post(&cfg, provider, &body);
    }
}

fn post(cfg: &IntegrationConfig, provider: &str, body: &[u8]) -> std::io::Result<()> {
    let addr = SocketAddr::from(([127, 0, 0, 1], cfg.hook_port));
    let mut s = TcpStream::connect_timeout(&addr, Duration::from_millis(500))?;
    s.set_write_timeout(Some(Duration::from_millis(1500)))?;
    s.set_read_timeout(Some(Duration::from_millis(1500)))?;
    let head = format!(
        "POST /hooks/{provider}?{} HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        crate::hooks::MARKER,
        cfg.hook_token,
        body.len()
    );
    s.write_all(head.as_bytes())?;
    s.write_all(body)?;
    s.flush()?;
    // Wait for the (immediate) answer so the receiver has the whole request before we exit.
    let mut sink = [0u8; 256];
    let _ = s.read(&mut sink);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_only_the_forwarder_flag() {
        let args = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(requested(&args(&["agentville", "--agentville-hook", "codex"])), Some("codex"));
        assert_eq!(requested(&args(&["agentville"])), None);
        assert_eq!(requested(&args(&["agentville", "--agentville-hook"])), None);
        assert_eq!(requested(&args(&["agentville", "--other", "codex"])), None);
    }
}
