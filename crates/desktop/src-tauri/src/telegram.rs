//! Local-mode Telegram support: an embedded HTTP server (from
//! `nodus_core::local_server`) for the account-linking handshake, and a
//! best-effort Cloudflare Quick Tunnel so a Mini App on a phone can reach
//! it. The tunnel is never load-bearing for correctness — if `cloudflared`
//! isn't installed or the tunnel can't come up, `public_address` just
//! stays whatever the user typed in by hand, which the rest of local mode
//! already has to tolerate (the spec's own required degradation path).

use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use nodus_core::local_server::{self, LocalServerState};
use nodus_core::VaultService;
use tauri::AppHandle;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

pub struct TelegramState {
    pub server: LocalServerState,
    pub local_port: Mutex<Option<u16>>,
    /// The address the Mini App should be told to reach this device at —
    /// the Cloudflare tunnel's assigned URL when that comes up, or one the
    /// user entered by hand otherwise.
    pub public_address: Arc<Mutex<Option<String>>>,
}

impl TelegramState {
    /// `vault_service` must be the *same* `Arc` as `AppState.service` — the
    /// local HTTP server and the desktop's own Tauri commands need to
    /// share one `VaultService` instance, not each open the vault
    /// independently.
    pub fn new(vault_service: Arc<Mutex<Option<VaultService>>>) -> Self {
        Self {
            server: LocalServerState {
                bot_token: Arc::new(Mutex::new(None)),
                pending_link: Arc::new(Mutex::new(None)),
                identity: Arc::new(Mutex::new(None)),
                session_tokens: Arc::new(Mutex::new(HashSet::new())),
                vault_service,
            },
            local_port: Mutex::new(None),
            public_address: Arc::new(Mutex::new(None)),
        }
    }
}

/// Binds the local-mode HTTP server to an OS-assigned loopback port and
/// runs it for the rest of the process's lifetime. Safe to leave running
/// even when Telegram linking isn't in use — every route refuses to do
/// anything without a vault open and a bot configured.
///
/// `miniapp_dist_dir` should point at the Mini App's built assets so the
/// same tunnel serves both the API and the page the phone loads; `None`
/// until that's wired into the app's bundled resources (still pending —
/// see the Mini App stage notes), which just means the tunnel exposes the
/// API alone for now.
pub fn start_local_server(state: LocalServerState, miniapp_dist_dir: Option<std::path::PathBuf>) -> std::io::Result<u16> {
    let std_listener = std::net::TcpListener::bind("127.0.0.1:0")?;
    std_listener.set_nonblocking(true)?;
    let port = std_listener.local_addr()?.port();
    // `TcpListener::from_std` needs an active Tokio reactor to register the
    // socket with — Tauri's `.setup()` hook (where this is called from)
    // runs outside of one, so the conversion has to happen inside the
    // spawned future itself, not before it's handed to the runtime.
    tauri::async_runtime::spawn(async move {
        let listener = match tokio::net::TcpListener::from_std(std_listener) {
            Ok(listener) => listener,
            Err(e) => {
                eprintln!("[telegram] failed to bind the local-mode HTTP server: {e}");
                return;
            }
        };
        let router = local_server::build_router(state, miniapp_dist_dir);
        let _ = axum::serve(listener, router).await;
    });
    Ok(port)
}

/// Best-effort only: spawns `cloudflared tunnel --url http://127.0.0.1:<port>`
/// and watches its stderr for the assigned `https://*.trycloudflare.com`
/// address. A missing binary or a spawn failure is logged and otherwise
/// ignored — local mode still works with a manually entered address.
///
/// Not exercised against a real `cloudflared` process in this build
/// environment; the API calls here match `tauri-plugin-shell` 2.3.5's
/// documented `Command`/`CommandEvent` shape, but this path specifically
/// still needs a real run on a machine with `cloudflared` installed.
pub fn spawn_cloudflared_tunnel(app: &AppHandle, local_port: u16, public_address: Arc<Mutex<Option<String>>>) {
    let spawned = app
        .shell()
        .command("cloudflared")
        .args(["tunnel", "--url", &format!("http://127.0.0.1:{local_port}")])
        .spawn();

    let mut rx = match spawned {
        Ok((rx, _child)) => rx,
        Err(e) => {
            eprintln!("[telegram] could not start cloudflared (local mode will need a manual address): {e}");
            return;
        }
    };

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            if let CommandEvent::Stderr(bytes) = event {
                let line = String::from_utf8_lossy(&bytes);
                if let Some(url) = extract_trycloudflare_url(&line) {
                    *public_address.lock().expect("mutex poisoned") = Some(url);
                }
            }
        }
    });
}

fn extract_trycloudflare_url(line: &str) -> Option<String> {
    line.split_whitespace()
        .find(|word| word.contains("trycloudflare.com"))
        .map(|s| s.trim_matches(|c: char| !(c.is_ascii_alphanumeric() || matches!(c, '.' | ':' | '/' | '-'))).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_the_url_from_a_realistic_cloudflared_log_line() {
        let line = "2026-08-22T10:00:00Z INF |  https://random-words-here.trycloudflare.com                                     |";
        assert_eq!(extract_trycloudflare_url(line), Some("https://random-words-here.trycloudflare.com".to_string()));
    }

    #[test]
    fn returns_none_for_unrelated_log_lines() {
        let line = "2026-08-22T10:00:00Z INF Starting tunnel";
        assert_eq!(extract_trycloudflare_url(line), None);
    }
}
