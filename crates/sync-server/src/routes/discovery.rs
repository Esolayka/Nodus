//! A minimal address book: "opaque id → encrypted address," nothing else.
//! Deliberately unauthenticated — the whole point of local mode is that a
//! device without any Nodus-server account at all can still be found by
//! its own Mini App session, and the id/ciphertext are already the only
//! protection this needs. What keeps it safe isn't a bearer token, it's
//! that the id is a one-way derivation of a secret this service never
//! sees, and the address is ciphertext under a key it never sees either.

use axum::extract::{Path, State};
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::db;
use crate::error::ApiError;
use crate::state::AppState;

/// Long enough to comfortably survive one missed heartbeat (the daemon
/// announces roughly every minute) without flapping to "unavailable."
const ANNOUNCEMENT_TTL_SECS: i64 = 150;

/// A generous cap on the encrypted address string — this endpoint has no
/// device-token gate, so it needs its own sanity limit against abuse.
const MAX_ADDRESS_LEN: usize = 4096;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnounceRequest {
    discovery_id: String,
    encrypted_address: String,
}

pub async fn announce(State(state): State<AppState>, Json(body): Json<AnnounceRequest>) -> Result<(), ApiError> {
    if body.discovery_id.is_empty() || body.discovery_id.len() > 128 {
        return Err(ApiError::BadRequest("invalid discovery id".into()));
    }
    if body.encrypted_address.is_empty() || body.encrypted_address.len() > MAX_ADDRESS_LEN {
        return Err(ApiError::BadRequest("invalid encrypted address".into()));
    }
    let conn = state.conn.lock().expect("db mutex poisoned");
    db::upsert_announcement(&conn, &body.discovery_id, &body.encrypted_address, db::now(), ANNOUNCEMENT_TTL_SECS)?;
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveResponse {
    encrypted_address: String,
    updated_at: i64,
    stale: bool,
}

pub async fn resolve(
    State(state): State<AppState>,
    Path(discovery_id): Path<String>,
) -> Result<Json<ResolveResponse>, ApiError> {
    let conn = state.conn.lock().expect("db mutex poisoned");
    let Some(announcement) = db::get_announcement(&conn, &discovery_id)? else {
        return Err(ApiError::NotFound);
    };
    let stale = db::now() > announcement.expires_at;
    Ok(Json(ResolveResponse { encrypted_address: announcement.encrypted_address, updated_at: announcement.updated_at, stale }))
}
