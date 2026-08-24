use std::path::Path;

use crate::error::{Error, Result};
use crate::vault::Vault;

/// Reads a note's raw text content (frontmatter included, verbatim).
pub fn read_note(vault: &Vault, relative: &str) -> Result<String> {
    let path = vault.resolve(relative)?;
    std::fs::read_to_string(&path).map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => Error::NotFound(path.clone()),
        std::io::ErrorKind::InvalidData => Error::InvalidUtf8(path.clone()),
        _ => Error::Io(e),
    })
}

/// Overwrites a note's content, creating the file (and any missing parent
/// folders — e.g. a daily-notes folder that doesn't exist yet) if it
/// doesn't exist yet.
///
/// Writes atomically: the new content lands in a temp file next to `path`
/// first, then an atomic rename swaps it into place. A crash or power loss
/// mid-write leaves either the old content or the new content, never a
/// truncated file.
pub fn write_note(vault: &Vault, relative: &str, content: &str) -> Result<()> {
    let path = vault.resolve(relative)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    write_atomic(&path, content)
}

fn write_atomic(path: &Path, content: &str) -> Result<()> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let tmp_path = parent.join(format!(".{file_name}.nodus-tmp-{}", std::process::id()));

    std::fs::write(&tmp_path, content)?;
    std::fs::rename(&tmp_path, path).inspect_err(|_| {
        let _ = std::fs::remove_file(&tmp_path);
    })?;
    Ok(())
}

/// Writes binary content (an imported attachment) to `relative`, creating
/// missing parent folders. Fails if the path is already taken — callers are
/// expected to have already picked a free name via
/// [`crate::attachments::unique_attachment_path`].
pub fn write_attachment_bytes(vault: &Vault, relative: &str, bytes: &[u8]) -> Result<()> {
    let path = vault.resolve(relative)?;
    if path.exists() {
        return Err(Error::AlreadyExists(path));
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&path, bytes)?;
    Ok(())
}

/// Copies an external file (e.g. a drag-and-dropped path) into the vault at
/// `relative`. Same "must not already exist" contract as
/// [`write_attachment_bytes`].
pub fn copy_attachment_from_path(
    vault: &Vault,
    relative: &str,
    source_absolute: &Path,
) -> Result<()> {
    let path = vault.resolve(relative)?;
    if path.exists() {
        return Err(Error::AlreadyExists(path));
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::copy(source_absolute, &path)?;
    Ok(())
}

/// Creates a new empty file at `relative`. Fails if it already exists.
pub fn create_file(vault: &Vault, relative: &str) -> Result<()> {
    let path = vault.resolve(relative)?;
    if path.exists() {
        return Err(Error::AlreadyExists(path));
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&path, "")?;
    Ok(())
}

/// Creates a new folder at `relative`, including any missing parents.
pub fn create_folder(vault: &Vault, relative: &str) -> Result<()> {
    let path = vault.resolve(relative)?;
    if path.exists() {
        return Err(Error::AlreadyExists(path));
    }
    std::fs::create_dir_all(&path)?;
    Ok(())
}

/// Renames or moves a file/folder from `old_relative` to `new_relative`.
pub fn rename_entry(vault: &Vault, old_relative: &str, new_relative: &str) -> Result<()> {
    let old_path = vault.resolve(old_relative)?;
    let new_path = vault.resolve(new_relative)?;
    if !old_path.exists() {
        return Err(Error::NotFound(old_path));
    }
    if new_path.exists() {
        return Err(Error::AlreadyExists(new_path));
    }
    if let Some(parent) = new_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::rename(&old_path, &new_path)?;
    Ok(())
}

/// Moves an entry to the OS trash rather than deleting it permanently.
pub fn delete_entry(vault: &Vault, relative: &str) -> Result<()> {
    let path = vault.resolve(relative)?;
    if !path.exists() {
        return Err(Error::NotFound(path));
    }
    trash_path(&path)
}

#[cfg(not(test))]
fn trash_path(path: &Path) -> Result<()> {
    trash::delete(path).map_err(|e| Error::Trash(e.to_string()))
}

/// The system trash isn't reliably available in CI/sandboxed test runners,
/// so tests delete for real instead of exercising the OS trash API.
#[cfg(test)]
fn trash_path(path: &Path) -> Result<()> {
    if path.is_dir() {
        std::fs::remove_dir_all(path)?;
    } else {
        std::fs::remove_file(path)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_read_write_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let vault = Vault::open(dir.path()).unwrap();

        create_file(&vault, "note.md").unwrap();
        assert_eq!(read_note(&vault, "note.md").unwrap(), "");

        write_note(&vault, "note.md", "# Hello").unwrap();
        assert_eq!(read_note(&vault, "note.md").unwrap(), "# Hello");
    }

    #[test]
    fn create_file_rejects_existing_path() {
        let dir = tempfile::tempdir().unwrap();
        let vault = Vault::open(dir.path()).unwrap();
        create_file(&vault, "note.md").unwrap();
        assert!(create_file(&vault, "note.md").is_err());
    }

    #[test]
    fn create_file_makes_missing_parent_folders() {
        let dir = tempfile::tempdir().unwrap();
        let vault = Vault::open(dir.path()).unwrap();
        create_file(&vault, "a/b/c.md").unwrap();
        assert!(dir.path().join("a/b/c.md").is_file());
    }

    #[test]
    fn rename_moves_between_folders() {
        let dir = tempfile::tempdir().unwrap();
        let vault = Vault::open(dir.path()).unwrap();
        create_file(&vault, "note.md").unwrap();
        rename_entry(&vault, "note.md", "folder/note.md").unwrap();
        assert!(!dir.path().join("note.md").exists());
        assert!(dir.path().join("folder/note.md").is_file());
    }

    #[test]
    fn delete_removes_entry() {
        let dir = tempfile::tempdir().unwrap();
        let vault = Vault::open(dir.path()).unwrap();
        create_file(&vault, "note.md").unwrap();
        delete_entry(&vault, "note.md").unwrap();
        assert!(!dir.path().join("note.md").exists());
    }

    #[test]
    fn write_note_leaves_no_temp_file_behind() {
        let dir = tempfile::tempdir().unwrap();
        let vault = Vault::open(dir.path()).unwrap();
        create_file(&vault, "note.md").unwrap();

        write_note(&vault, "note.md", "first").unwrap();
        write_note(&vault, "note.md", "second").unwrap();

        assert_eq!(read_note(&vault, "note.md").unwrap(), "second");
        let leftovers: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|name| name.contains("nodus-tmp"))
            .collect();
        assert!(leftovers.is_empty(), "leftover temp files: {leftovers:?}");
    }

    #[test]
    fn write_note_creates_missing_parent_folders() {
        // A daily note (or anything else) written for the first time into a
        // folder that hasn't been created yet — e.g. the Mini App appending
        // to today's note before that folder exists — used to fail with
        // "No such file or directory" instead of creating it, unlike every
        // sibling write function in this file.
        let dir = tempfile::tempdir().unwrap();
        let vault = Vault::open(dir.path()).unwrap();

        write_note(&vault, "Daily Notes/2026-08-23.md", "hello").unwrap();

        assert_eq!(
            read_note(&vault, "Daily Notes/2026-08-23.md").unwrap(),
            "hello"
        );
    }

    #[test]
    fn operations_reject_escaping_paths() {
        let dir = tempfile::tempdir().unwrap();
        let vault = Vault::open(dir.path()).unwrap();
        assert!(create_file(&vault, "../escape.md").is_err());
        assert!(read_note(&vault, "../../etc/passwd").is_err());
    }

    #[test]
    fn write_attachment_bytes_creates_missing_folders() {
        let dir = tempfile::tempdir().unwrap();
        let vault = Vault::open(dir.path()).unwrap();
        write_attachment_bytes(&vault, "assets/photo.png", b"\x89PNG").unwrap();
        assert_eq!(
            std::fs::read(dir.path().join("assets/photo.png")).unwrap(),
            b"\x89PNG"
        );
    }

    #[test]
    fn write_attachment_bytes_rejects_existing_path() {
        let dir = tempfile::tempdir().unwrap();
        let vault = Vault::open(dir.path()).unwrap();
        write_attachment_bytes(&vault, "photo.png", b"a").unwrap();
        assert!(write_attachment_bytes(&vault, "photo.png", b"b").is_err());
    }

    #[test]
    fn copy_attachment_from_path_copies_bytes_in() {
        let dir = tempfile::tempdir().unwrap();
        let vault = Vault::open(dir.path()).unwrap();
        let source_dir = tempfile::tempdir().unwrap();
        let source = source_dir.path().join("original.png");
        std::fs::write(&source, b"binary data").unwrap();

        copy_attachment_from_path(&vault, "assets/original.png", &source).unwrap();
        assert_eq!(
            std::fs::read(dir.path().join("assets/original.png")).unwrap(),
            b"binary data"
        );
        // The source file is untouched — this is a copy, not a move.
        assert!(source.exists());
    }
}
