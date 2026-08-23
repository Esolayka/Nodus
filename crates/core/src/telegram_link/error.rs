#[derive(Debug, thiserror::Error)]
pub enum TelegramLinkError {
    #[error("linking code has expired — generate a new one")]
    TokenExpired,
    #[error("linking code does not match")]
    TokenMismatch,
    #[error(transparent)]
    Verify(#[from] nodus_telegram::VerifyError),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, TelegramLinkError>;
