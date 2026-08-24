//! Local-mode Telegram support: an embedded HTTP server (from
//! `nodus_core::local_server`) for the account-linking handshake, and a
//! best-effort Cloudflare Quick Tunnel so a Mini App on a phone can reach
//! it. The tunnel is never load-bearing for correctness — if the tunnel
//! can't come up, `public_address` just stays whatever the user typed in
//! by hand, which the rest of local mode already has to tolerate (the
//! spec's own required degradation path).
//!
//! `cloudflared` itself no longer has to be pre-installed: a system copy
//! on PATH is used if present, otherwise one is downloaded from GitHub's
//! release assets and cached for next time (see `ensure_cloudflared_binary`).

use std::collections::HashSet;
use std::io::BufRead;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use nodus_core::local_server::{self, LocalServerState};
use nodus_core::VaultService;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

const CLOUDFLARED_VERSION: &str = "2026.7.3";

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

/// Resolves the Mini App bundle in both installed and development builds.
/// Tauri copies `dist/` into `$RESOURCES/miniapp` for installers, while a
/// development checkout can use Vite's output directly.
pub fn miniapp_dist_dir(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(resources) = app.path().resource_dir() {
        let bundled = resources.join("miniapp");
        if bundled.join("miniapp.html").is_file() {
            return Some(bundled);
        }
    }

    let development = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist");
    development
        .join("miniapp.html")
        .is_file()
        .then_some(development)
}

/// Binds the local-mode HTTP server to an OS-assigned loopback port and
/// runs it for the rest of the process's lifetime. Safe to leave running
/// even when Telegram linking isn't in use — every route refuses to do
/// anything without a vault open and a bot configured.
///
/// `miniapp_dist_dir` should point at the Mini App's built assets so the
/// same tunnel serves both the API and the page the phone loads; `None`
/// means the tunnel exposes the API alone, with no page for a phone to
/// actually load.
pub fn start_local_server(
    state: LocalServerState,
    miniapp_dist_dir: Option<std::path::PathBuf>,
) -> std::io::Result<u16> {
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

/// Spawns `cloudflared tunnel --url http://127.0.0.1:<port>` (downloading
/// the binary first if needed — see `ensure_cloudflared_binary`) and
/// watches its stderr for the assigned `https://*.trycloudflare.com`
/// address. Returns an error the caller can show the user instead of
/// silently leaving `public_address` unset — local mode still works with
/// a manually entered address either way, but a hidden failure just looks
/// like the button did nothing.
pub fn spawn_cloudflared_tunnel(
    app: &AppHandle,
    local_port: u16,
    public_address: Arc<Mutex<Option<String>>>,
) -> Result<(), String> {
    let binary = ensure_cloudflared_binary(app)?;

    let mut child = std::process::Command::new(&binary)
        .args(["tunnel", "--url", &format!("http://127.0.0.1:{local_port}")])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to start cloudflared: {e}"))?;

    let stderr = child.stderr.take().expect("stderr was piped above");
    // Plain std thread, not the async runtime — this is just a blocking
    // read loop over the child's pipe until it exits, nothing here needs
    // an executor. The child is moved in so `wait()` can reap it once the
    // pipe closes, instead of leaking a zombie process for the app's
    // remaining lifetime.
    std::thread::spawn(move || {
        let reader = std::io::BufReader::new(stderr);
        for line in reader.lines().map_while(Result::ok) {
            if let Some(url) = extract_trycloudflare_url(&line) {
                *public_address.lock().expect("mutex poisoned") = Some(url);
            }
        }
        let _ = child.wait();
    });

    Ok(())
}

/// True if a `cloudflared` on `PATH` actually runs — not just that some
/// file by that name exists, in case it's broken or belongs to something
/// else entirely.
fn cloudflared_on_path() -> bool {
    std::process::Command::new("cloudflared")
        .arg("--version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

/// Where a downloaded copy is cached between runs, independent of whatever
/// vault is open — this is app-level tooling, not vault data.
fn cloudflared_cache_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("could not resolve the app data directory: {e}"))?
        .join("bin");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let name = if cfg!(target_os = "windows") {
        "cloudflared.exe"
    } else {
        "cloudflared"
    };
    Ok(dir.join(name))
}

/// The GitHub release asset for this OS/arch, and whether it's a `.tgz`
/// archive (macOS) rather than a raw executable (Linux, Windows).
fn cloudflared_asset_for(
    os: &str,
    arch: &str,
) -> Result<(&'static str, bool, &'static str), String> {
    match (os, arch) {
        ("linux", "x86_64") => Ok((
            "cloudflared-linux-amd64",
            false,
            "9d71c677db00134c1bd4144b7783486b654ad281b1ea62b4972098d19f770f17",
        )),
        ("linux", "aarch64") => Ok((
            "cloudflared-linux-arm64",
            false,
            "65259e652a7bea08bf5df603233ab22b8bf3116af8df9f9206209af6a1b955c0",
        )),
        ("macos", "x86_64") => Ok((
            "cloudflared-darwin-amd64.tgz",
            true,
            "e88fe5874d42a94f49a7ea59cabc3722d2962d0449232b0f3b1a426a712e275c",
        )),
        ("macos", "aarch64") => Ok((
            "cloudflared-darwin-arm64.tgz",
            true,
            "f35c50089cd25f77a4cb5a2152036bc26db15aa31fbe11f7995d2e42a4ed6257",
        )),
        ("windows", "x86_64") => Ok((
            "cloudflared-windows-amd64.exe",
            false,
            "8635da433b6df8194746e88ed9d2589566c20e38bfc2a80e431a348b7c765841",
        )),
        (os, arch) => Err(format!(
            "cloudflared has no published build for {os}/{arch}"
        )),
    }
}

fn cloudflared_asset() -> Result<(&'static str, bool, &'static str), String> {
    cloudflared_asset_for(std::env::consts::OS, std::env::consts::ARCH)
}

fn verify_sha256(bytes: &[u8], expected: &str) -> Result<(), String> {
    let actual = format!("{:x}", Sha256::digest(bytes));
    if actual == expected {
        Ok(())
    } else {
        Err(format!(
            "cloudflared checksum mismatch: expected {expected}, got {actual}"
        ))
    }
}

/// Downloads the archive into `tmp_dir` and extracts the `cloudflared`
/// binary out of it into `dest`. Shells out to the system `tar` rather than
/// adding a tar/gzip crate dependency just for this one platform — macOS
/// always ships both as core utilities.
fn extract_cloudflared_archive(
    archive_bytes: &[u8],
    tmp_dir: &std::path::Path,
    dest: &std::path::Path,
) -> Result<(), String> {
    std::fs::create_dir_all(tmp_dir).map_err(|e| e.to_string())?;
    let archive_path = tmp_dir.join("cloudflared.tgz");
    std::fs::write(&archive_path, archive_bytes).map_err(|e| e.to_string())?;
    let status = std::process::Command::new("tar")
        .arg("-xzf")
        .arg(&archive_path)
        .arg("-C")
        .arg(tmp_dir)
        .status()
        .map_err(|e| format!("failed to run tar to extract cloudflared: {e}"))?;
    if !status.success() {
        return Err("tar exited with an error extracting cloudflared".to_string());
    }
    std::fs::rename(tmp_dir.join("cloudflared"), dest).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_dir_all(tmp_dir);
    Ok(())
}

#[cfg(unix)]
fn make_executable(path: &std::path::Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let mut perms = std::fs::metadata(path)
        .map_err(|e| e.to_string())?
        .permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(path, perms).map_err(|e| e.to_string())
}

#[cfg(not(unix))]
fn make_executable(_path: &std::path::Path) -> Result<(), String> {
    Ok(())
}

/// Resolves a `cloudflared` binary to spawn: a working system install on
/// `PATH` first, then a previously downloaded copy, then downloads one
/// fresh from GitHub's release assets and caches it for next time. Only
/// reachable machine state (network, disk) can make this fail — there's
/// no manual install step left for the user to get stuck on.
fn ensure_cloudflared_binary(app: &AppHandle) -> Result<PathBuf, String> {
    if cloudflared_on_path() {
        return Ok(PathBuf::from("cloudflared"));
    }

    let cached = cloudflared_cache_path(app)?;
    let version_marker = cached.with_extension("version");
    let cache_is_current = std::fs::read_to_string(&version_marker)
        .map(|version| version.trim() == CLOUDFLARED_VERSION)
        .unwrap_or(false);
    if cached.is_file() && cache_is_current {
        return Ok(cached);
    }

    let (asset, is_archive, expected_sha256) = cloudflared_asset()?;
    let url = format!(
        "https://github.com/cloudflare/cloudflared/releases/download/{CLOUDFLARED_VERSION}/{asset}"
    );
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| e.to_string())?;
    let bytes = client
        .get(&url)
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("failed to download cloudflared from {url}: {e}"))?
        .bytes()
        .map_err(|e| format!("failed to read the cloudflared download: {e}"))?;
    verify_sha256(&bytes, expected_sha256)?;

    if is_archive {
        let tmp_dir = cached.with_file_name("cloudflared-download");
        extract_cloudflared_archive(&bytes, &tmp_dir, &cached)?;
    } else {
        std::fs::write(&cached, &bytes).map_err(|e| e.to_string())?;
    }
    make_executable(&cached)?;
    std::fs::write(&version_marker, CLOUDFLARED_VERSION).map_err(|e| e.to_string())?;

    Ok(cached)
}

fn extract_trycloudflare_url(line: &str) -> Option<String> {
    line.split_whitespace()
        .find(|word| word.contains("trycloudflare.com"))
        .map(|s| {
            s.trim_matches(|c: char| {
                !(c.is_ascii_alphanumeric() || matches!(c, '.' | ':' | '/' | '-'))
            })
            .to_string()
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_the_url_from_a_realistic_cloudflared_log_line() {
        let line = "2026-08-22T10:00:00Z INF |  https://random-words-here.trycloudflare.com                                     |";
        assert_eq!(
            extract_trycloudflare_url(line),
            Some("https://random-words-here.trycloudflare.com".to_string())
        );
    }

    #[test]
    fn returns_none_for_unrelated_log_lines() {
        let line = "2026-08-22T10:00:00Z INF Starting tunnel";
        assert_eq!(extract_trycloudflare_url(line), None);
    }

    #[test]
    fn resolves_every_supported_platform() {
        for (os, arch) in [
            ("linux", "x86_64"),
            ("linux", "aarch64"),
            ("macos", "x86_64"),
            ("macos", "aarch64"),
            ("windows", "x86_64"),
        ] {
            let (name, _, checksum) = cloudflared_asset_for(os, arch).expect("supported platform");
            assert!(!name.is_empty());
            assert_eq!(checksum.len(), 64);
        }
    }

    #[test]
    fn rejects_a_wrong_cloudflared_checksum() {
        assert!(verify_sha256(b"not cloudflared", &"0".repeat(64)).is_err());
    }

    #[test]
    fn rejects_a_platform_with_no_published_build() {
        assert!(cloudflared_asset_for("plan9", "sparc").is_err());
    }
}
