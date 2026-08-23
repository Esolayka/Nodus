//! Importing notes from another program. Two very different jobs share
//! this module's vocabulary: Obsidian barely needs "importing" at all
//! (the files are already valid Markdown — this is mostly a compatibility
//! report over a vault opened as-is), while Notion needs a real
//! conversion pipeline, since nobody would want to browse its zip export
//! directly.
//!
//! Every importer that actually writes files follows the same contract:
//! a cheap [`preview`] pass that touches nothing, and a [`run`] pass that
//! reports progress as it goes and can be cancelled between files —
//! never mid-file, so a cancelled import never leaves a half-written note
//! behind.

pub mod encoding;
pub mod error;
pub mod notion;
pub mod obsidian;

use std::path::Path;

use serde::Serialize;

pub use error::{ImportError, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PlannedFileKind {
    Note,
    Attachment,
    DatabaseNote,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedFile {
    pub relative_path: String,
    pub kind: PlannedFileKind,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub planned_files: Vec<PlannedFile>,
    pub folder_count: usize,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportProgress {
    pub processed: usize,
    pub total: usize,
    pub current_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimplifiedBlock {
    pub path: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportIssue {
    pub path: String,
    pub message: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub pages_imported: usize,
    pub attachments_imported: usize,
    pub links_resolved: usize,
    pub links_unresolved: usize,
    pub simplified_blocks: Vec<SimplifiedBlock>,
    pub issues: Vec<ImportIssue>,
}

/// A destination must be empty (or not exist yet, and get created) —
/// imports never write into a folder that already has content, so an
/// import can never overwrite something the user already has.
pub fn ensure_empty_destination(dest_root: &Path) -> Result<()> {
    if dest_root.exists() {
        let has_entries = std::fs::read_dir(dest_root)?.next().is_some();
        if has_entries {
            return Err(ImportError::NotADirectory(dest_root.to_path_buf()));
        }
    } else {
        std::fs::create_dir_all(dest_root)?;
    }
    Ok(())
}

/// Never overwrite on a name collision — append " 1", " 2", ... until the
/// path is free. Mirrors `attachments::unique_attachment_path`'s approach
/// but works from an absolute destination root rather than a `Vault`,
/// since an import target doesn't have to be an already-open vault.
pub fn unique_path(dest_root: &Path, relative: &str) -> String {
    let (dir, filename) = match relative.rfind('/') {
        Some(idx) => (&relative[..idx], &relative[idx + 1..]),
        None => ("", relative),
    };
    let (stem, ext) = match filename.rfind('.') {
        Some(idx) if idx > 0 => (&filename[..idx], Some(&filename[idx + 1..])),
        _ => (filename, None),
    };

    let candidate = |n: Option<u32>| -> String {
        let name = match (ext, n) {
            (Some(ext), None) => format!("{stem}.{ext}"),
            (Some(ext), Some(n)) => format!("{stem} {n}.{ext}"),
            (None, None) => stem.to_string(),
            (None, Some(n)) => format!("{stem} {n}"),
        };
        if dir.is_empty() {
            name
        } else {
            format!("{dir}/{name}")
        }
    };

    let mut result = candidate(None);
    let mut n = 1;
    while dest_root.join(&result).exists() {
        result = candidate(Some(n));
        n += 1;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unique_path_has_no_suffix_when_free() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(unique_path(dir.path(), "Notes/Idea.md"), "Notes/Idea.md");
    }

    #[test]
    fn unique_path_suffixes_on_collision_instead_of_overwriting() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("Notes")).unwrap();
        std::fs::write(dir.path().join("Notes/Idea.md"), "existing").unwrap();
        assert_eq!(unique_path(dir.path(), "Notes/Idea.md"), "Notes/Idea 1.md");
    }

    #[test]
    fn ensure_empty_destination_rejects_a_nonempty_folder() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("existing.md"), "already here").unwrap();
        assert!(ensure_empty_destination(dir.path()).is_err());
    }

    #[test]
    fn ensure_empty_destination_creates_a_missing_folder() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("new-vault");
        ensure_empty_destination(&target).unwrap();
        assert!(target.is_dir());
    }
}
