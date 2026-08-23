//! The vault data the Mini App (or anything else reaching this device
//! through the tunnel) actually reads and writes through, once linked.
//! Every handler here requires [`super::auth::AuthedSession`] — reaching
//! `/health` doesn't get you anywhere near a note.

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{SearchFileResult, TagCount, TaskRow, TreeNode, VaultService};

use super::auth::ApiError;
use super::LocalServerState;

fn with_service<T>(state: &LocalServerState, f: impl FnOnce(&VaultService) -> crate::Result<T>) -> Result<T, ApiError> {
    let guard = state.vault_service.lock().expect("mutex poisoned");
    let service = guard.as_ref().ok_or((StatusCode::SERVICE_UNAVAILABLE, "no vault is open".to_string()))?;
    f(service).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

fn content_hash(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    hex::encode(hasher.finalize())
}

pub async fn tree(
    State(state): State<LocalServerState>,
    _auth: super::auth::AuthedSession,
) -> Result<Json<TreeNode>, ApiError> {
    with_service(&state, |s| s.tree()).map(Json)
}

#[derive(Deserialize)]
pub struct PathQuery {
    path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteContent {
    content: String,
    hash: String,
}

pub async fn read_note(
    State(state): State<LocalServerState>,
    _auth: super::auth::AuthedSession,
    Query(q): Query<PathQuery>,
) -> Result<Json<NoteContent>, ApiError> {
    let content = with_service(&state, |s| s.read_note(&q.path))?;
    let hash = content_hash(&content);
    Ok(Json(NoteContent { content, hash }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteNoteRequest {
    path: String,
    content: String,
    /// The hash of the content this edit started from (from a previous
    /// read), or `None` if the client believes this is a brand new note.
    /// Either way, if it doesn't match what the server currently has, this
    /// write is based on stale information — rejected as a conflict
    /// instead of silently overwriting whatever changed in between. This
    /// is exactly what makes a queued offline edit safe to replay later.
    base_hash: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WriteOk {
    hash: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WriteConflict {
    current_content: String,
    current_hash: String,
}

pub async fn write_note(
    State(state): State<LocalServerState>,
    _auth: super::auth::AuthedSession,
    Json(body): Json<WriteNoteRequest>,
) -> Result<Response, ApiError> {
    let guard = state.vault_service.lock().expect("mutex poisoned");
    let service = guard.as_ref().ok_or((StatusCode::SERVICE_UNAVAILABLE, "no vault is open".to_string()))?;

    let current = service.read_note(&body.path).ok();
    let conflict = match (&body.base_hash, &current) {
        (Some(expected), Some(current_content)) => content_hash(current_content) != *expected,
        (Some(_), None) => true, // client expected an existing note; it's gone
        (None, Some(_)) => true, // client expected a new path; something's already there
        (None, None) => false,
    };
    if conflict {
        let current_content = current.unwrap_or_default();
        let current_hash = content_hash(&current_content);
        return Ok((StatusCode::CONFLICT, Json(WriteConflict { current_content, current_hash })).into_response());
    }

    service.write_note(&body.path, &body.content).map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok((StatusCode::OK, Json(WriteOk { hash: content_hash(&body.content) })).into_response())
}

pub async fn read_attachment(
    State(state): State<LocalServerState>,
    _auth: super::auth::AuthedSession,
    Query(q): Query<PathQuery>,
) -> Result<Response, ApiError> {
    let bytes = with_service(&state, |s| s.read_file_bytes(&q.path))?;
    let content_type = guess_content_type(&q.path);
    Ok(([(axum::http::header::CONTENT_TYPE, content_type)], bytes).into_response())
}

fn guess_content_type(path: &str) -> &'static str {
    let ext = path.rsplit('.').next().unwrap_or("").to_lowercase();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "m4a" => "audio/mp4",
        "ogg" => "audio/ogg",
        _ => "application/octet-stream",
    }
}

#[derive(Deserialize)]
pub struct SearchQuery {
    q: String,
    #[serde(default)]
    case_sensitive: bool,
}

pub async fn search(
    State(state): State<LocalServerState>,
    _auth: super::auth::AuthedSession,
    Query(q): Query<SearchQuery>,
) -> Result<Json<Vec<SearchFileResult>>, ApiError> {
    with_service(&state, |s| s.search(&q.q, q.case_sensitive)).map(Json)
}

pub async fn tags(
    State(state): State<LocalServerState>,
    _auth: super::auth::AuthedSession,
) -> Result<Json<Vec<TagCount>>, ApiError> {
    with_service(&state, |s| s.tag_counts()).map(Json)
}

pub async fn tasks(
    State(state): State<LocalServerState>,
    _auth: super::auth::AuthedSession,
) -> Result<Json<Vec<TaskRow>>, ApiError> {
    with_service(&state, |s| s.all_tasks()).map(Json)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToggleTaskRequest {
    path: String,
    marker_start: usize,
    marker_end: usize,
    expected_marker: String,
    add_completion_date: bool,
}

pub async fn toggle_task(
    State(state): State<LocalServerState>,
    _auth: super::auth::AuthedSession,
    Json(body): Json<ToggleTaskRequest>,
) -> Result<(), ApiError> {
    with_service(&state, |s| {
        s.toggle_task(&body.path, body.marker_start, body.marker_end, &body.expected_marker, body.add_completion_date)
    })
}
