//! The HTTP surface a desktop instance exposes for "local mode" — reached
//! only through a tunnel, never listening on anything but `127.0.0.1`
//! directly. A health check, the Telegram linking handshake, and (once
//! linked) the vault data routes the Mini App actually reads and writes
//! through — the same [`VaultService`] the desktop's own Tauri commands
//! use, shared rather than duplicated, so a note edited from the phone and
//! the desktop's own file watcher never disagree about what's current.

pub mod auth;
mod link;
#[cfg(test)]
mod tests;
mod vault_routes;

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use axum::routing::{get, post, put};
use axum::{Json, Router};
use serde::Serialize;
use tower_http::services::ServeDir;

use nodus_crypto::SyncIdentity;

use crate::telegram_link::PendingLink;
use crate::VaultService;

#[derive(Clone)]
pub struct LocalServerState {
    /// `None` until the user has configured a bot in settings — the
    /// linking endpoint refuses to do anything without it, since there's
    /// no key to check Telegram's signature against.
    pub bot_token: Arc<Mutex<Option<String>>>,
    /// The one linking code currently shown on screen, if any. A fresh
    /// code (from generating a new one) replaces it; there's never more
    /// than one outstanding at a time.
    pub pending_link: Arc<Mutex<Option<PendingLink>>>,
    /// This vault's sync identity — `None` until a vault is actually open,
    /// since the identity is loaded from *that* vault's `.nodus/` folder,
    /// not fixed for the app's whole lifetime. Linking simply isn't
    /// possible yet without a vault open to link.
    pub identity: Arc<Mutex<Option<SyncIdentity>>>,
    /// Bearer tokens minted by a completed linking handshake — required on
    /// every vault data route. Kept in memory only: losing them (an app
    /// restart) just means relinking, not a security hole.
    pub session_tokens: Arc<Mutex<HashSet<String>>>,
    /// The same [`VaultService`] instance the desktop's own Tauri commands
    /// use — shared, not a second independent open of the vault, so there
    /// is exactly one file watcher and one search index per vault no
    /// matter how many clients (desktop UI, Mini App) are reading from it.
    pub vault_service: Arc<Mutex<Option<VaultService>>>,
}

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok" })
}

/// `static_dir` is the built Mini App bundle (Vite's `dist/` output) when
/// one is available — served as a fallback under everything that isn't an
/// API route, so the same tunnel URL that exposes `/vault/*` also serves
/// the Mini App itself, same-origin, no separate hosting or CORS story
/// needed for local mode. `None` (e.g. in tests, or a build that hasn't
/// bundled the Mini App) just means that fallback isn't wired up.
pub fn build_router(state: LocalServerState, static_dir: Option<PathBuf>) -> Router {
    let router = Router::new()
        .route("/health", get(health))
        .route("/telegram/link", post(link::link))
        .route("/vault/tree", get(vault_routes::tree))
        .route(
            "/vault/note",
            get(vault_routes::read_note).put(vault_routes::write_note),
        )
        .route("/vault/attachment", get(vault_routes::read_attachment))
        .route("/vault/search", get(vault_routes::search))
        .route("/vault/tags", get(vault_routes::tags))
        .route("/vault/tasks", get(vault_routes::tasks))
        .route("/vault/tasks/toggle", put(vault_routes::toggle_task))
        .with_state(state);

    match static_dir {
        Some(dir) => router.fallback_service(ServeDir::new(dir)),
        None => router,
    }
}
