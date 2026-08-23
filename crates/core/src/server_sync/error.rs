#[derive(Debug, thiserror::Error)]
pub enum ServerSyncError {
    #[error(transparent)]
    Client(#[from] super::client::ClientError),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Db(#[from] rusqlite::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Crypto(#[from] nodus_crypto::Error),
    #[error(transparent)]
    Vault(#[from] crate::error::Error),
    #[error("server sync is not configured for this vault")]
    NotConfigured,
}

pub type Result<T> = std::result::Result<T, ServerSyncError>;
