//! Session tokens for the local-mode HTTP API: minted once a device
//! completes the Telegram linking handshake, required as a bearer token on
//! every vault data route after that. Deliberately separate from the
//! linking token itself (which only proves "you read the code off this
//! screen," is single-use, and expires in minutes) — a session token is
//! what the Mini App actually holds onto and uses for as long as it stays
//! linked.

use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use axum::http::StatusCode;
use rand::RngCore;

use super::LocalServerState;

pub type ApiError = (StatusCode, String);

pub fn generate_session_token() -> String {
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    hex::encode(bytes)
}

/// An axum extractor proving the request carries a currently-valid session
/// token — put it as a handler argument to gate any route behind linking
/// having already happened.
pub struct AuthedSession;

impl FromRequestParts<LocalServerState> for AuthedSession {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &LocalServerState) -> Result<Self, Self::Rejection> {
        let header = parts
            .headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .ok_or((StatusCode::UNAUTHORIZED, "missing authorization header".to_string()))?;
        let token = header
            .strip_prefix("Bearer ")
            .ok_or((StatusCode::UNAUTHORIZED, "malformed authorization header".to_string()))?;
        if state.session_tokens.lock().expect("mutex poisoned").contains(token) {
            Ok(AuthedSession)
        } else {
            Err((StatusCode::UNAUTHORIZED, "invalid or expired session".to_string()))
        }
    }
}
