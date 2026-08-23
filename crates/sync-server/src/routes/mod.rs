pub mod chunks;
pub mod discovery;
pub mod pairing;
pub mod sync;

use axum::extract::State;
use axum::routing::{get, post, put};
use axum::{Json, Router};
use serde::Serialize;

use crate::auth::AuthedDevice;
use crate::db;
use crate::error::ApiError;
use crate::state::AppState;

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok" })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StorageUsageResponse {
    used_bytes: u64,
    max_bytes: Option<u64>,
    max_file_size_bytes: Option<u64>,
}

async fn storage_usage(
    State(state): State<AppState>,
    _device: AuthedDevice,
) -> Result<Json<StorageUsageResponse>, ApiError> {
    let conn = state.conn.lock().expect("db mutex poisoned");
    let used_bytes = db::used_bytes(&conn)?;
    Ok(Json(StorageUsageResponse {
        used_bytes,
        max_bytes: state.max_storage_bytes,
        max_file_size_bytes: state.max_file_size_bytes,
    }))
}

pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/v1/health", get(health))
        .route("/v1/devices/pair/start", post(pairing::pair_start))
        .route("/v1/devices/pair/complete", post(pairing::pair_complete))
        .route("/v1/devices/pair/telegram", post(pairing::pair_telegram))
        .route("/v1/sync/diff", post(sync::diff))
        .route("/v1/sync/blob/{id}", put(sync::put_blob).delete(sync::delete_blob))
        .route("/v1/chunks/missing", post(chunks::missing_chunks))
        .route("/v1/chunks/{id}", put(chunks::put_chunk).get(chunks::get_chunk))
        .route("/v1/storage/usage", get(storage_usage))
        .route("/v1/discovery/announce", post(discovery::announce))
        .route("/v1/discovery/resolve/{discovery_id}", get(discovery::resolve))
        .with_state(state)
}
