//! Raw chunk bytes: which ones the server is missing, uploading them, and
//! fetching them back. Never anything about which *file* a chunk belongs to
//! — that link lives only in a file's manifest (`sync::put_blob`).

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::auth::AuthedDevice;
use crate::db;
use crate::error::ApiError;
use crate::state::AppState;
use crate::storage;

#[derive(Deserialize)]
pub struct MissingRequest {
    ids: Vec<String>,
}

#[derive(Serialize)]
pub struct MissingResponse {
    missing: Vec<String>,
}

pub async fn missing_chunks(
    State(state): State<AppState>,
    _device: AuthedDevice,
    Json(body): Json<MissingRequest>,
) -> Result<Json<MissingResponse>, ApiError> {
    let conn = state.conn.lock().expect("db mutex poisoned");
    let mut missing = Vec::new();
    for id in body.ids {
        let exists: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM chunks WHERE id = ?1)", [&id], |row| row.get(0))?;
        if !exists {
            missing.push(id);
        }
    }
    Ok(Json(MissingResponse { missing }))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PutChunkResponse {
    id: String,
    size: u64,
}

pub async fn put_chunk(
    State(state): State<AppState>,
    _device: AuthedDevice,
    Path(id): Path<String>,
    body: Bytes,
) -> Result<Json<PutChunkResponse>, ApiError> {
    let size = body.len() as u64;
    if let Some(max) = state.max_file_size_bytes {
        if size > max {
            return Err(ApiError::PayloadTooLarge { max_file_size_bytes: max });
        }
    }

    let conn = state.conn.lock().expect("db mutex poisoned");
    let already_exists: bool =
        conn.query_row("SELECT EXISTS(SELECT 1 FROM chunks WHERE id = ?1)", [&id], |row| row.get(0))?;
    if already_exists {
        // Identical content already stored — by this file's own history, or
        // by dedup against a completely different file — so there's
        // nothing new to write and no quota to re-check, since no new
        // space is being used.
        return Ok(Json(PutChunkResponse { id, size }));
    }

    if let Some(max) = state.max_storage_bytes {
        let used = db::used_bytes(&conn)?;
        if used + size > max {
            return Err(ApiError::StorageQuotaExceeded { used_bytes: used, max_bytes: max });
        }
    }

    storage::write_chunk(&state.data_dir, &id, &body)?;
    conn.execute(
        "INSERT INTO chunks (id, size, created_at) VALUES (?1, ?2, ?3)",
        rusqlite::params![id, size as i64, db::now()],
    )?;

    Ok(Json(PutChunkResponse { id, size }))
}

pub async fn get_chunk(
    State(state): State<AppState>,
    _device: AuthedDevice,
    Path(id): Path<String>,
) -> Result<Vec<u8>, ApiError> {
    storage::read_chunk(&state.data_dir, &id).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            ApiError::NotFound
        } else {
            ApiError::Internal(e.to_string())
        }
    })
}
