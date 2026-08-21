use std::path::{Path, PathBuf};

use crate::error::{Error, Result};

/// An open vault: a directory on disk holding `.md` notes and attachments.
///
/// All paths that cross the core API boundary are *vault-relative* strings
/// using `/` as the separator, regardless of host OS. [`Vault::resolve`] is
/// the only place a relative path is turned into a real filesystem path, and
/// it guarantees the result stays inside the vault root.
#[derive(Clone)]
pub struct Vault {
    root: PathBuf,
}

/// A single path segment must be a plain filename: no separators, no `.`/`..`.
fn validate_component(component: &str) -> Result<()> {
    if component.is_empty() || component == "." || component == ".." {
        return Err(Error::PathEscapesVault(component.to_string()));
    }
    if component.contains('/') || component.contains('\\') || component.contains('\0') {
        return Err(Error::PathEscapesVault(component.to_string()));
    }
    Ok(())
}

impl Vault {
    /// Opens `path` as a vault root. The directory must already exist.
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        let metadata =
            std::fs::metadata(path).map_err(|_| Error::InvalidVaultRoot(path.to_path_buf()))?;
        if !metadata.is_dir() {
            return Err(Error::InvalidVaultRoot(path.to_path_buf()));
        }
        let root = path
            .canonicalize()
            .map_err(|_| Error::InvalidVaultRoot(path.to_path_buf()))?;
        Ok(Self { root })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Resolves a vault-relative path (e.g. `"folder/note.md"`) into an
    /// absolute filesystem path, rejecting anything that would escape the
    /// vault root. The target does not need to exist yet.
    pub fn resolve(&self, relative: &str) -> Result<PathBuf> {
        let mut resolved = self.root.clone();
        if relative.is_empty() {
            return Ok(resolved);
        }
        for component in relative.split('/') {
            validate_component(component)?;
            resolved.push(component);
        }
        Ok(resolved)
    }

    /// Turns an absolute path known to be inside the vault back into the
    /// vault-relative `/`-separated form used at the API boundary.
    pub fn relativize(&self, absolute: &Path) -> Result<String> {
        let rel = absolute
            .strip_prefix(&self.root)
            .map_err(|_| Error::PathEscapesVault(absolute.display().to_string()))?;
        let parts: Vec<&str> = rel
            .components()
            .map(|c| c.as_os_str().to_str().unwrap_or_default())
            .collect();
        Ok(parts.join("/"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_rejects_parent_traversal() {
        let dir = tempfile::tempdir().unwrap();
        let vault = Vault::open(dir.path()).unwrap();
        assert!(vault.resolve("../escape.md").is_err());
        assert!(vault.resolve("folder/../../escape.md").is_err());
        assert!(vault.resolve("..").is_err());
    }

    #[test]
    fn resolve_rejects_absolute_looking_components() {
        let dir = tempfile::tempdir().unwrap();
        let vault = Vault::open(dir.path()).unwrap();
        assert!(vault.resolve("folder//note.md").is_err());
    }

    #[test]
    fn resolve_accepts_nested_relative_path() {
        let dir = tempfile::tempdir().unwrap();
        let vault = Vault::open(dir.path()).unwrap();
        let resolved = vault.resolve("folder/note.md").unwrap();
        assert_eq!(
            resolved,
            dir.path().canonicalize().unwrap().join("folder/note.md")
        );
    }

    #[test]
    fn relativize_roundtrips_resolve() {
        let dir = tempfile::tempdir().unwrap();
        let vault = Vault::open(dir.path()).unwrap();
        let absolute = vault.resolve("folder/note.md").unwrap();
        assert_eq!(vault.relativize(&absolute).unwrap(), "folder/note.md");
    }
}
