use serde::Serialize;
use tauri::{AppHandle, State};

use crate::telegram::TelegramState;

#[tauri::command]
pub fn telegram_set_bot_token(state: State<TelegramState>, token: String) {
    let trimmed = token.trim();
    let value = if trimmed.is_empty() { None } else { Some(trimmed.to_string()) };
    *state.server.bot_token.lock().expect("mutex poisoned") = value;
}

#[tauri::command]
pub fn telegram_bot_configured(state: State<TelegramState>) -> bool {
    state.server.bot_token.lock().expect("mutex poisoned").is_some()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkCode {
    pub token: String,
    pub expires_at: i64,
}

/// Generates a fresh single-use linking code, replacing any previous one —
/// there's only ever one outstanding at a time, matching the linking
/// screen only ever showing one code.
#[tauri::command]
pub fn telegram_generate_link_code(state: State<TelegramState>) -> LinkCode {
    let pending = nodus_core::telegram_link::generate_linking_token();
    let code = LinkCode { token: pending.token.clone(), expires_at: pending.expires_at };
    *state.server.pending_link.lock().expect("mutex poisoned") = Some(pending);
    code
}

/// The manual fallback the spec requires: if the tunnel or discovery
/// service isn't available, the user can type in whatever address the
/// Mini App should use instead (their own reverse proxy, an advanced
/// named Cloudflare Tunnel, etc.).
#[tauri::command]
pub fn telegram_set_manual_address(state: State<TelegramState>, address: String) {
    let trimmed = address.trim();
    let value = if trimmed.is_empty() { None } else { Some(trimmed.to_string()) };
    *state.public_address.lock().expect("mutex poisoned") = value;
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramStatus {
    pub local_port: Option<u16>,
    pub public_address: Option<String>,
    pub bot_configured: bool,
}

/// Explicit opt-in only — never started just because a vault is open.
/// Downloads `cloudflared` first if it isn't already installed or cached
/// (see `ensure_cloudflared_binary`); if that download or the tunnel spawn
/// itself fails, the error comes back here for the UI to show, and the
/// user can still fall back to `telegram_set_manual_address`.
#[tauri::command]
pub fn telegram_start_tunnel(app: AppHandle, state: State<TelegramState>) -> Result<(), String> {
    let port = state.local_port.lock().expect("mutex poisoned").ok_or_else(|| "local server is not running".to_string())?;
    crate::telegram::spawn_cloudflared_tunnel(&app, port, state.public_address.clone())
}

#[tauri::command]
pub fn telegram_status(state: State<TelegramState>) -> TelegramStatus {
    TelegramStatus {
        local_port: *state.local_port.lock().expect("mutex poisoned"),
        public_address: state.public_address.lock().expect("mutex poisoned").clone(),
        bot_configured: state.server.bot_token.lock().expect("mutex poisoned").is_some(),
    }
}
