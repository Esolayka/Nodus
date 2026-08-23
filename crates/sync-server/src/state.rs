use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use rusqlite::Connection;

#[derive(Clone)]
pub struct AppState {
    pub conn: Arc<Mutex<Connection>>,
    pub data_dir: PathBuf,
    /// Total encrypted bytes this server will store across all chunks.
    /// `None` means unlimited.
    pub max_storage_bytes: Option<u64>,
    /// Largest single chunk this server will accept. `None` means
    /// unlimited (still bounded in practice by the client's own chunk
    /// size, but an operator may want a hard server-side cap too).
    pub max_file_size_bytes: Option<u64>,
    /// Set only when this instance also serves as the backend for a
    /// Telegram Mini App in "server mode" — required to verify that a
    /// `initData` payload really came from Telegram signed with this bot.
    pub telegram_bot_token: Option<String>,
}
