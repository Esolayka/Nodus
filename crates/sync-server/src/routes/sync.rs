//! The versioned-blob protocol: a client reports what version of each file
//! it last saw, the server says what changed, and every write is
//! optimistic-concurrency-checked against the version the client thought
//! it was updating — never a silent overwrite of someone else's edit.

use std::collections::HashMap;

use axum::extract::{Path, State};
use axum::Json;
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};

use crate::auth::AuthedDevice;
use crate::db;
use crate::error::ApiError;
use crate::state::AppState;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffRequest {
    versions: HashMap<String, u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    id: String,
    version: u64,
    deleted: bool,
    chunk_ids: Vec<String>,
    encrypted_path: Option<String>,
}

#[derive(Serialize)]
pub struct DiffResponse {
    changed: Vec<ChangedFile>,
}

pub async fn diff(
    State(state): State<AppState>,
    _device: AuthedDevice,
    Json(body): Json<DiffRequest>,
) -> Result<Json<DiffResponse>, ApiError> {
    let conn = state.conn.lock().expect("db mutex poisoned");
    let mut stmt =
        conn.prepare("SELECT id, version, deleted, chunk_ids, encrypted_path FROM files")?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, i64>(1)? as u64,
            row.get::<_, i64>(2)? != 0,
            row.get::<_, String>(3)?,
            row.get::<_, Option<String>>(4)?,
        ))
    })?;

    let mut changed = Vec::new();
    for row in rows {
        let (id, version, deleted, chunk_ids_json, encrypted_path) = row?;
        let known = body.versions.get(&id).copied().unwrap_or(0);
        if known != version {
            let chunk_ids: Vec<String> = serde_json::from_str(&chunk_ids_json).unwrap_or_default();
            changed.push(ChangedFile {
                id,
                version,
                deleted,
                chunk_ids,
                encrypted_path,
            });
        }
    }
    Ok(Json(DiffResponse { changed }))
}

struct CurrentFile {
    version: u64,
    deleted: bool,
    chunk_ids: Vec<String>,
    encrypted_path: Option<String>,
}

fn load_current(conn: &rusqlite::Connection, id: &str) -> rusqlite::Result<Option<CurrentFile>> {
    conn.query_row(
        "SELECT version, deleted, chunk_ids, encrypted_path FROM files WHERE id = ?1",
        [id],
        |row| {
            let version: i64 = row.get(0)?;
            let deleted: i64 = row.get(1)?;
            let chunk_ids_json: String = row.get(2)?;
            let encrypted_path: Option<String> = row.get(3)?;
            Ok((version as u64, deleted != 0, chunk_ids_json, encrypted_path))
        },
    )
    .optional()
    .map(|opt| {
        opt.map(
            |(version, deleted, chunk_ids_json, encrypted_path)| CurrentFile {
                version,
                deleted,
                chunk_ids: serde_json::from_str(&chunk_ids_json).unwrap_or_default(),
                encrypted_path,
            },
        )
    })
}

fn conflict_from(current_version: u64, current: &Option<CurrentFile>) -> ApiError {
    match current {
        Some(c) => ApiError::Conflict {
            current_version,
            chunk_ids: c.chunk_ids.clone(),
            deleted: c.deleted,
            encrypted_path: c.encrypted_path.clone(),
        },
        None => ApiError::Conflict {
            current_version,
            chunk_ids: Vec::new(),
            deleted: false,
            encrypted_path: None,
        },
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PutBlobRequest {
    base_version: u64,
    chunk_ids: Vec<String>,
    encrypted_path: Option<String>,
}

#[derive(Serialize)]
pub struct VersionResponse {
    version: u64,
}

pub async fn put_blob(
    State(state): State<AppState>,
    _device: AuthedDevice,
    Path(id): Path<String>,
    Json(body): Json<PutBlobRequest>,
) -> Result<Json<VersionResponse>, ApiError> {
    let conn = state.conn.lock().expect("db mutex poisoned");
    let current = load_current(&conn, &id)?;
    let current_version = current.as_ref().map(|c| c.version).unwrap_or(0);

    if body.base_version != current_version {
        return Err(conflict_from(current_version, &current));
    }

    // Every chunk the new manifest points at must already be uploaded —
    // committing a manifest that references content the server doesn't
    // have would silently corrupt the next download.
    for chunk_id in &body.chunk_ids {
        let exists: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM chunks WHERE id = ?1)",
            [chunk_id],
            |row| row.get(0),
        )?;
        if !exists {
            return Err(ApiError::BadRequest(format!(
                "chunk {chunk_id} was not uploaded"
            )));
        }
    }

    let new_version = current_version + 1;
    let now = db::now();
    let chunk_ids_json =
        serde_json::to_string(&body.chunk_ids).expect("Vec<String> always serializes");
    conn.execute(
        "INSERT INTO files (id, version, deleted, chunk_ids, encrypted_path, updated_at)
         VALUES (?1, ?2, 0, ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET version = excluded.version, deleted = 0,
             chunk_ids = excluded.chunk_ids, encrypted_path = excluded.encrypted_path,
             updated_at = excluded.updated_at",
        rusqlite::params![id, new_version, chunk_ids_json, body.encrypted_path, now],
    )?;

    conn.execute("DELETE FROM chunk_refs WHERE file_id = ?1", [&id])?;
    for chunk_id in &body.chunk_ids {
        conn.execute(
            "INSERT OR IGNORE INTO chunk_refs (chunk_id, file_id) VALUES (?1, ?2)",
            rusqlite::params![chunk_id, id],
        )?;
    }

    Ok(Json(VersionResponse {
        version: new_version,
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteBlobRequest {
    base_version: u64,
}

pub async fn delete_blob(
    State(state): State<AppState>,
    _device: AuthedDevice,
    Path(id): Path<String>,
    Json(body): Json<DeleteBlobRequest>,
) -> Result<Json<VersionResponse>, ApiError> {
    let conn = state.conn.lock().expect("db mutex poisoned");
    let current = load_current(&conn, &id)?;
    let current_version = current.as_ref().map(|c| c.version).unwrap_or(0);

    if current.is_none() {
        return Err(ApiError::NotFound);
    }
    if body.base_version != current_version {
        return Err(conflict_from(current_version, &current));
    }

    let new_version = current_version + 1;
    let now = db::now();
    // A tombstone, not a row deletion — `files` must keep remembering "this
    // id used to exist and is now gone" so a device syncing later sees
    // `deleted: true` instead of "never heard of it," which is exactly how
    // a deleted file would resurrect via a device with an old copy.
    conn.execute(
        "UPDATE files SET version = ?2, deleted = 1, chunk_ids = '[]', updated_at = ?3 WHERE id = ?1",
        rusqlite::params![id, new_version, now],
    )?;
    conn.execute("DELETE FROM chunk_refs WHERE file_id = ?1", [&id])?;

    Ok(Json(VersionResponse {
        version: new_version,
    }))
}
