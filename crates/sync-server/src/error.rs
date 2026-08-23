//! Every error this service can hand back to a client, mapped to a status
//! code and a small JSON body — never a bare 500 with no explanation, since
//! "why did my sync fail" needs an answer a UI can show.

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Serialize;

pub enum ApiError {
    Unauthorized,
    NotFound,
    /// The blob's version on the server has moved since the client last
    /// saw it — an optimistic-concurrency conflict, not a server error.
    /// The current state is included so the client can fetch it and
    /// attempt a merge instead of just retrying blindly.
    Conflict { current_version: u64, chunk_ids: Vec<String>, deleted: bool, encrypted_path: Option<String> },
    PayloadTooLarge { max_file_size_bytes: u64 },
    StorageQuotaExceeded { used_bytes: u64, max_bytes: u64 },
    BadRequest(String),
    Internal(String),
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorBody {
    error: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    current_version: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    chunk_ids: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    deleted: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    encrypted_path: Option<Option<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_file_size_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    used_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_bytes: Option<u64>,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, body) = match self {
            ApiError::Unauthorized => (
                StatusCode::UNAUTHORIZED,
                ErrorBody {
                    error: "unauthorized".into(),
                    current_version: None,
                    chunk_ids: None,
                    deleted: None,
                    encrypted_path: None,
                    max_file_size_bytes: None,
                    used_bytes: None,
                    max_bytes: None,
                },
            ),
            ApiError::NotFound => (
                StatusCode::NOT_FOUND,
                ErrorBody {
                    error: "not_found".into(),
                    current_version: None,
                    chunk_ids: None,
                    deleted: None,
                    encrypted_path: None,
                    max_file_size_bytes: None,
                    used_bytes: None,
                    max_bytes: None,
                },
            ),
            ApiError::Conflict { current_version, chunk_ids, deleted, encrypted_path } => (
                StatusCode::CONFLICT,
                ErrorBody {
                    error: "conflict".into(),
                    current_version: Some(current_version),
                    chunk_ids: Some(chunk_ids),
                    deleted: Some(deleted),
                    encrypted_path: Some(encrypted_path),
                    max_file_size_bytes: None,
                    used_bytes: None,
                    max_bytes: None,
                },
            ),
            ApiError::PayloadTooLarge { max_file_size_bytes } => (
                StatusCode::PAYLOAD_TOO_LARGE,
                ErrorBody {
                    error: "payload_too_large".into(),
                    current_version: None,
                    chunk_ids: None,
                    deleted: None,
                    encrypted_path: None,
                    max_file_size_bytes: Some(max_file_size_bytes),
                    used_bytes: None,
                    max_bytes: None,
                },
            ),
            ApiError::StorageQuotaExceeded { used_bytes, max_bytes } => (
                StatusCode::INSUFFICIENT_STORAGE,
                ErrorBody {
                    error: "storage_quota_exceeded".into(),
                    current_version: None,
                    chunk_ids: None,
                    deleted: None,
                    encrypted_path: None,
                    max_file_size_bytes: None,
                    used_bytes: Some(used_bytes),
                    max_bytes: Some(max_bytes),
                },
            ),
            ApiError::BadRequest(msg) => (
                StatusCode::BAD_REQUEST,
                ErrorBody {
                    error: msg,
                    current_version: None,
                    chunk_ids: None,
                    deleted: None,
                    encrypted_path: None,
                    max_file_size_bytes: None,
                    used_bytes: None,
                    max_bytes: None,
                },
            ),
            ApiError::Internal(msg) => {
                tracing::error!("internal error: {msg}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    ErrorBody {
                        error: "internal_error".into(),
                        current_version: None,
                        chunk_ids: None,
                        deleted: None,
                        encrypted_path: None,
                        max_file_size_bytes: None,
                        used_bytes: None,
                        max_bytes: None,
                    },
                )
            }
        };
        (status, Json(body)).into_response()
    }
}

impl From<rusqlite::Error> for ApiError {
    fn from(err: rusqlite::Error) -> Self {
        ApiError::Internal(err.to_string())
    }
}

impl From<std::io::Error> for ApiError {
    fn from(err: std::io::Error) -> Self {
        ApiError::Internal(err.to_string())
    }
}
