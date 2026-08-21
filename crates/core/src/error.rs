use std::path::PathBuf;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("path escapes the vault root: {0}")]
    PathEscapesVault(String),

    #[error("entry not found: {0}")]
    NotFound(PathBuf),

    #[error("entry already exists: {0}")]
    AlreadyExists(PathBuf),

    #[error("not a valid vault directory: {0}")]
    InvalidVaultRoot(PathBuf),

    #[error("file is not valid UTF-8: {0}")]
    InvalidUtf8(PathBuf),

    #[error("invalid frontmatter YAML: {0}")]
    InvalidFrontmatter(#[from] serde_yaml::Error),

    #[error(transparent)]
    Io(#[from] std::io::Error),

    #[error("failed to move entry to trash: {0}")]
    Trash(String),

    #[error("failed to watch vault: {0}")]
    Watch(String),
}

pub type Result<T> = std::result::Result<T, Error>;
