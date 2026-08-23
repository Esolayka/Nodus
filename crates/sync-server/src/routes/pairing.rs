//! Adding a device never means typing a password into a new machine: an
//! already-connected device asks the server for a short-lived code (shown
//! as text or a QR in the desktop app), and the new device redeems it for
//! its own token. The very first device has no already-connected device to
//! ask, so the server prints its own one-time bootstrap code instead.

use axum::extract::State;
use axum::Json;
use rand::{Rng, RngCore};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};

use crate::auth::AuthedDevice;
use crate::db;
use crate::error::ApiError;
use crate::state::AppState;

const CODE_ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const PAIRING_CODE_TTL_SECS: i64 = 600;

fn random_code(len: usize) -> String {
    let mut rng = rand::thread_rng();
    (0..len).map(|_| CODE_ALPHABET[rng.gen_range(0..CODE_ALPHABET.len())] as char).collect()
}

fn random_token() -> String {
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    hex::encode(bytes)
}

fn random_device_id() -> String {
    let mut bytes = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    hex::encode(bytes)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairStartResponse {
    code: String,
    expires_at: i64,
}

pub async fn pair_start(
    State(state): State<AppState>,
    _device: AuthedDevice,
) -> Result<Json<PairStartResponse>, ApiError> {
    let code = random_code(8);
    let now = db::now();
    let expires_at = now + PAIRING_CODE_TTL_SECS;
    let conn = state.conn.lock().expect("db mutex poisoned");
    conn.execute(
        "INSERT INTO pairing_codes (code, created_at, expires_at) VALUES (?1, ?2, ?3)",
        rusqlite::params![code, now, expires_at],
    )?;
    Ok(Json(PairStartResponse { code, expires_at }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairCompleteRequest {
    code: String,
    device_name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairCompleteResponse {
    token: String,
    device_id: String,
}

pub async fn pair_complete(
    State(state): State<AppState>,
    Json(body): Json<PairCompleteRequest>,
) -> Result<Json<PairCompleteResponse>, ApiError> {
    let device_name = body.device_name.trim();
    if device_name.is_empty() {
        return Err(ApiError::BadRequest("device_name must not be empty".into()));
    }
    let code = body.code.trim().to_uppercase();
    let conn = state.conn.lock().expect("db mutex poisoned");
    let now = db::now();

    if db::device_count(&conn)? == 0 {
        // Bootstrap path: no device is connected yet to have shown a normal
        // pairing code, so the only valid credential is the one the server
        // itself printed at startup.
        let bootstrap = db::bootstrap_code(&conn)?;
        if bootstrap.as_deref() != Some(code.as_str()) {
            return Err(ApiError::Unauthorized);
        }
        db::clear_bootstrap_code(&conn)?;
    } else {
        let expires_at: Option<i64> = conn
            .query_row("SELECT expires_at FROM pairing_codes WHERE code = ?1", [&code], |row| row.get(0))
            .optional()?;
        match expires_at {
            Some(expires_at) if expires_at >= now => {
                conn.execute("DELETE FROM pairing_codes WHERE code = ?1", [&code])?;
            }
            _ => return Err(ApiError::Unauthorized),
        }
    }

    let device_id = random_device_id();
    let token = random_token();
    db::insert_device(&conn, &device_id, &token, device_name, now, None)?;
    Ok(Json(PairCompleteResponse { token, device_id }))
}

/// The Telegram Mini App's own registration path, used only in "server
/// mode" where this instance also backs the Mini App directly (no
/// discovery/tunnel involved at all — the server already has a stable,
/// always-on address). Trust here comes entirely from Telegram's own
/// signature on `initData`, verified against the bot token this instance
/// was started with; there is no pairing code to steal or guess.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairTelegramRequest {
    init_data: String,
    device_name: String,
}

/// initData must have been produced by a launch within this window — a
/// Mini App calling this endpoint does so immediately on startup, so this
/// can be much tighter than a code a human has to read and type.
const TELEGRAM_INIT_DATA_MAX_AGE_SECS: i64 = 120;

pub async fn pair_telegram(
    State(state): State<AppState>,
    Json(body): Json<PairTelegramRequest>,
) -> Result<Json<PairCompleteResponse>, ApiError> {
    let device_name = body.device_name.trim();
    if device_name.is_empty() {
        return Err(ApiError::BadRequest("device_name must not be empty".into()));
    }
    let Some(bot_token) = &state.telegram_bot_token else {
        return Err(ApiError::BadRequest("this server is not configured as a Telegram Mini App backend".into()));
    };

    let now = db::now();
    let verified = nodus_telegram::init_data::verify(&body.init_data, bot_token, now, TELEGRAM_INIT_DATA_MAX_AGE_SECS)
        .map_err(|e| ApiError::BadRequest(e.to_string()))?;

    let conn = state.conn.lock().expect("db mutex poisoned");
    let device_id = random_device_id();
    let token = random_token();
    db::insert_device(&conn, &device_id, &token, device_name, now, Some(verified.user.id))?;
    Ok(Json(PairCompleteResponse { token, device_id }))
}
