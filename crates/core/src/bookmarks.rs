//! Bookmarked notes, stored at `.nodus/bookmarks.json` inside the vault
//! itself rather than in the desktop app's own local storage — so they
//! travel through Git/server sync along with everything else, the same as
//! any other vault-scoped state (see `history.rs`, `index.rs`).

use std::path::{Path, PathBuf};

use crate::error::Result;

fn bookmarks_path(vault_root: &Path) -> PathBuf {
    vault_root.join(".nodus").join("bookmarks.json")
}

/// Vault-relative note paths, in the order they were bookmarked. Missing or
/// unreadable file just means "no bookmarks yet" — matching how every other
/// small JSON sidecar in this app (e.g. `HistoryStore`'s manifest) treats a
/// first read.
pub fn read(vault_root: &Path) -> Vec<String> {
    std::fs::read_to_string(bookmarks_path(vault_root))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn write(vault_root: &Path, paths: &[String]) -> Result<()> {
    let path = bookmarks_path(vault_root);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let json = serde_json::to_string_pretty(paths).unwrap_or_else(|_| "[]".to_string());
    std::fs::write(path, json)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_reads_as_empty() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(read(dir.path()), Vec::<String>::new());
    }

    #[test]
    fn round_trips_through_disk() {
        let dir = tempfile::tempdir().unwrap();
        let paths = vec!["Note.md".to_string(), "Folder/Other.md".to_string()];
        write(dir.path(), &paths).unwrap();
        assert_eq!(read(dir.path()), paths);
        assert!(dir.path().join(".nodus/bookmarks.json").exists());
    }
}
