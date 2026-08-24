use std::path::Path;

use nodus_core::server_sync::client::{
    PairCompleteResponse, PairStartResponse, ServerSyncClient, StorageUsage,
};
use nodus_core::{ServerSync, SyncReport};
use tauri::State;

use crate::state::AppState;

fn with_server_sync<T>(
    state: &State<AppState>,
    f: impl FnOnce(&mut ServerSync) -> nodus_core::server_sync::error::Result<T>,
) -> Result<T, String> {
    let mut guard = state.server_sync.lock().expect("app state mutex poisoned");
    let sync = guard
        .as_mut()
        .ok_or_else(|| "Server sync is not enabled for this vault".to_string())?;
    f(sync).map_err(|e| e.to_string())
}

/// Enables the "Nodus server" sync mechanism for the currently open vault.
/// Encryption isn't wired in yet, so this always syncs plaintext content —
/// still content-addressed and chunked, just without a DEK to encrypt or
/// hide filenames with.
#[tauri::command]
pub fn server_sync_enable(
    state: State<AppState>,
    vault_path: String,
    base_url: String,
    token: String,
    device_name: String,
) -> Result<(), String> {
    let vault = nodus_core::Vault::open(Path::new(&vault_path)).map_err(|e| e.to_string())?;
    let sync =
        ServerSync::open(vault, base_url, token, None, device_name).map_err(|e| e.to_string())?;
    *state.server_sync.lock().expect("app state mutex poisoned") = Some(sync);
    Ok(())
}

#[tauri::command]
pub fn server_sync_once(state: State<AppState>) -> Result<SyncReport, String> {
    with_server_sync(&state, |s| s.sync_once())
}

/// Requests a short-lived pairing code from an already-connected device's
/// server session — shown to the user (as text or a QR) to enter on the
/// new device.
#[tauri::command]
pub fn server_sync_pair_start(state: State<AppState>) -> Result<PairStartResponse, String> {
    let guard = state.server_sync.lock().expect("app state mutex poisoned");
    let sync = guard
        .as_ref()
        .ok_or_else(|| "Server sync is not enabled for this vault".to_string())?;
    sync.client().pair_start().map_err(|e| e.to_string())
}

/// Redeems a pairing code (or the server's own bootstrap code, for the
/// first device) for a device token. Doesn't need an existing session —
/// this is how a brand new device gets one.
#[tauri::command]
pub fn server_sync_pair_complete(
    base_url: String,
    code: String,
    device_name: String,
) -> Result<PairCompleteResponse, String> {
    ServerSyncClient::pair_complete(&base_url, &code, &device_name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn server_sync_storage_usage(state: State<AppState>) -> Result<StorageUsage, String> {
    let guard = state.server_sync.lock().expect("app state mutex poisoned");
    let sync = guard
        .as_ref()
        .ok_or_else(|| "Server sync is not enabled for this vault".to_string())?;
    sync.client().storage_usage().map_err(|e| e.to_string())
}
