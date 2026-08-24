//! The Telegram account-linking handshake — the one route on this server
//! that isn't gated behind an existing session, since its whole job is to
//! create one.

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::telegram_link;

use super::auth::{generate_session_token, ApiError};
use super::LocalServerState;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkRequest {
    token: String,
    init_data: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkResponse {
    telegram_user_id: i64,
    telegram_username: Option<String>,
    sync_identity_hex: String,
    session_token: String,
}

pub async fn link(
    State(state): State<LocalServerState>,
    Json(body): Json<LinkRequest>,
) -> Result<Json<LinkResponse>, ApiError> {
    let pending = state.pending_link.lock().expect("mutex poisoned").clone();
    let pending = pending.ok_or((
        StatusCode::BAD_REQUEST,
        "no linking code has been generated yet".to_string(),
    ))?;
    let bot_token = state.bot_token.lock().expect("mutex poisoned").clone();
    let bot_token = bot_token.ok_or((
        StatusCode::BAD_REQUEST,
        "no Telegram bot is configured".to_string(),
    ))?;
    let identity = state.identity.lock().expect("mutex poisoned").clone();
    let identity = identity.ok_or((
        StatusCode::BAD_REQUEST,
        "no vault is open to link".to_string(),
    ))?;

    let result = telegram_link::complete_link(
        &pending,
        &body.token,
        &body.init_data,
        &bot_token,
        &identity,
    )
    .map_err(|e| (StatusCode::UNAUTHORIZED, e.to_string()))?;

    let session_token = generate_session_token();
    state
        .session_tokens
        .lock()
        .expect("mutex poisoned")
        .insert(session_token.clone());
    // Single-use: once redeemed, the same code can't mint a second session.
    *state.pending_link.lock().expect("mutex poisoned") = None;

    Ok(Json(LinkResponse {
        telegram_user_id: result.telegram_user_id,
        telegram_username: result.telegram_username,
        sync_identity_hex: result.sync_identity_hex,
        session_token,
    }))
}
