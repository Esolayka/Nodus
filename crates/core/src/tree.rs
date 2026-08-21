use serde::Serialize;
use std::path::Path;

use crate::error::Result;
use crate::vault::Vault;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TreeNode {
    /// Vault-relative path (`/`-separated), also used as a stable id.
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    /// Always serialized, even when empty — the frontend relies on
    /// `children` always being an array, never `undefined`, for every node
    /// (files included).
    pub children: Vec<TreeNode>,
}

/// Entries starting with `.` (including `.nodus`) are never shown.
fn is_hidden(name: &str) -> bool {
    name.starts_with('.')
}

/// A single bad entry (broken symlink, permission-denied subfolder, a cloud
/// sync client's placeholder file, ...) must never take down the whole vault
/// — anything that fails to stat/read is just skipped rather than
/// propagated, both here and in [`list_markdown_files`].
pub fn build_tree(vault: &Vault) -> Result<TreeNode> {
    let children = read_dir_sorted(vault, vault.root());
    Ok(TreeNode {
        path: String::new(),
        name: String::new(),
        is_dir: true,
        children,
    })
}

fn read_dir_sorted(vault: &Vault, dir: &Path) -> Vec<TreeNode> {
    let mut entries = Vec::new();
    let Ok(read_dir) = std::fs::read_dir(dir) else {
        return entries;
    };

    for entry in read_dir {
        let Ok(entry) = entry else { continue };
        let name = entry.file_name().to_string_lossy().into_owned();
        if is_hidden(&name) {
            continue;
        }
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let absolute = entry.path();
        let Ok(relative) = vault.relativize(&absolute) else {
            continue;
        };

        if file_type.is_dir() {
            entries.push(TreeNode {
                path: relative,
                name,
                is_dir: true,
                children: read_dir_sorted(vault, &absolute),
            });
        } else if file_type.is_file() {
            entries.push(TreeNode {
                path: relative,
                name,
                is_dir: false,
                children: Vec::new(),
            });
        }
        // Symlinks and other special files are skipped for now.
    }

    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    entries
}

/// Flat list of vault-relative paths to every `.md` file, for the indexer.
pub fn list_markdown_files(vault: &Vault) -> Vec<String> {
    let mut paths = Vec::new();
    collect_markdown(vault, vault.root(), &mut paths);
    paths
}

fn collect_markdown(vault: &Vault, dir: &Path, out: &mut Vec<String>) {
    let Ok(read_dir) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in read_dir {
        let Ok(entry) = entry else { continue };
        let name = entry.file_name().to_string_lossy().into_owned();
        if is_hidden(&name) {
            continue;
        }
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let absolute = entry.path();
        if file_type.is_dir() {
            collect_markdown(vault, &absolute, out);
        } else if file_type.is_file() && name.to_lowercase().ends_with(".md") {
            if let Ok(relative) = vault.relativize(&absolute) {
                out.push(relative);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tree_hides_dotfiles_and_sorts_dirs_first() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("b.md"), "").unwrap();
        std::fs::create_dir(dir.path().join("a-folder")).unwrap();
        std::fs::write(dir.path().join("a-folder/nested.md"), "").unwrap();
        std::fs::create_dir(dir.path().join(".nodus")).unwrap();
        std::fs::write(dir.path().join(".nodus/index.sqlite"), "").unwrap();

        let vault = Vault::open(dir.path()).unwrap();
        let tree = build_tree(&vault).unwrap();

        assert_eq!(tree.children.len(), 2);
        assert_eq!(tree.children[0].name, "a-folder");
        assert!(tree.children[0].is_dir);
        assert_eq!(tree.children[0].children.len(), 1);
        assert_eq!(tree.children[1].name, "b.md");
    }

    /// The frontend indexes/renders every node assuming `children` is always
    /// an array, files included — never an absent field. `serde`'s default
    /// behavior for an empty `Vec` is to still emit `[]`, but it's easy to
    /// accidentally opt into `skip_serializing_if` (e.g. copy-pasting from
    /// another struct) and silently break every leaf node in the tree.
    #[test]
    fn file_nodes_serialize_children_as_empty_array_not_absent() {
        let file_node = TreeNode {
            path: "note.md".to_string(),
            name: "note.md".to_string(),
            is_dir: false,
            children: Vec::new(),
        };
        let json = serde_json::to_value(&file_node).unwrap();
        assert_eq!(json["children"], serde_json::json!([]));
    }

    #[test]
    #[cfg(unix)]
    fn broken_symlink_does_not_break_the_whole_tree() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("good.md"), "").unwrap();
        std::os::unix::fs::symlink(dir.path().join("does-not-exist"), dir.path().join("broken"))
            .unwrap();

        let vault = Vault::open(dir.path()).unwrap();
        let tree = build_tree(&vault).unwrap();

        assert_eq!(tree.children.len(), 1);
        assert_eq!(tree.children[0].name, "good.md");

        let markdown_files = list_markdown_files(&vault);
        assert_eq!(markdown_files, vec!["good.md".to_string()]);
    }

    #[test]
    #[cfg(unix)]
    fn unreadable_subfolder_does_not_break_the_whole_tree() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("good.md"), "").unwrap();
        let locked = dir.path().join("locked");
        std::fs::create_dir(&locked).unwrap();
        std::fs::write(locked.join("secret.md"), "").unwrap();
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o000)).unwrap();

        let vault = Vault::open(dir.path()).unwrap();
        let tree = build_tree(&vault).unwrap();

        // Restore permissions so the tempdir can be cleaned up.
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o755)).unwrap();

        let names: Vec<&str> = tree.children.iter().map(|n| n.name.as_str()).collect();
        assert!(names.contains(&"good.md"));
        assert!(names.contains(&"locked"));
    }
}
