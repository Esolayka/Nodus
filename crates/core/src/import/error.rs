#[derive(Debug, thiserror::Error)]
pub enum ImportError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("could not open the archive: {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("import was cancelled")]
    Cancelled,
    #[error("{0} is not a directory")]
    NotADirectory(std::path::PathBuf),
    #[error(transparent)]
    Core(#[from] crate::error::Error),
}

pub type Result<T> = std::result::Result<T, ImportError>;
