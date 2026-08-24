//! Device-token authentication. Every request except health, and the two
//! pairing endpoints that hand out or consume a token, requires
//! `Authorization: Bearer <token>` for a token this server itself issued
//! during pairing.

use axum::extract::FromRequestParts;
use axum::http::request::Parts;

use crate::db;
use crate::error::ApiError;
use crate::state::AppState;

pub struct AuthedDevice {
    #[allow(dead_code)]
    pub id: String,
}

impl FromRequestParts<AppState> for AuthedDevice {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let header = parts
            .headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .ok_or(ApiError::Unauthorized)?;
        let token = header
            .strip_prefix("Bearer ")
            .ok_or(ApiError::Unauthorized)?;
        let conn = state.conn.lock().expect("db mutex poisoned");
        let id = db::device_id_for_token(&conn, token)?.ok_or(ApiError::Unauthorized)?;
        Ok(AuthedDevice { id })
    }
}
