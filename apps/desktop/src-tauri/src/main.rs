// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().collect();
    // Command hooks (Codex) run this executable to forward a payload; no window, no output.
    if let Some(provider) = agentville_lib::forwarder::requested(&args) {
        return agentville_lib::forwarder::run(provider);
    }
    agentville_lib::run()
}
