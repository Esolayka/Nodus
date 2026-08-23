//! Chunk bytes on disk, content-addressed by the id the client already
//! computed (a keyed HMAC on their side — this service never sees, and
//! never needs, the key that produced it).

use std::path::{Path, PathBuf};

/// Two-level fan-out (`ab/abcd...`) so a vault with tens of thousands of
/// chunks doesn't put them all in one directory.
pub fn chunk_path(data_dir: &Path, id: &str) -> PathBuf {
    let prefix = &id[..id.len().min(2)];
    data_dir.join("chunks").join(prefix).join(id)
}

pub fn write_chunk(data_dir: &Path, id: &str, bytes: &[u8]) -> std::io::Result<()> {
    let path = chunk_path(data_dir, id);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, bytes)
}

pub fn read_chunk(data_dir: &Path, id: &str) -> std::io::Result<Vec<u8>> {
    std::fs::read(chunk_path(data_dir, id))
}

pub fn delete_chunk(data_dir: &Path, id: &str) -> std::io::Result<()> {
    let path = chunk_path(data_dir, id);
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}
