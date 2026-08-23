//! Attachment file helpers: collision-safe naming for newly imported files,
//! and finding attachments nothing embeds anymore.
//!
//! Attachments are just ordinary files in the vault — unlike notes, they
//! aren't tracked in the SQLite index (there's nothing to parse out of a
//! PNG), so "what's unused" is computed on demand by walking the vault and
//! every note's embeds, rather than maintained incrementally.

use std::collections::HashSet;

use crate::error::Result;
use crate::tree;
use crate::vault::Vault;
use crate::wikilink::{find_wikilinks, LinkKind};

/// Extensions never worth listing as "attachments" — notes themselves and
/// nothing else the vault manages specially. Deliberately broad (every
/// non-`.md` file counts as an attachment candidate) rather than an
/// allowlist of known media types, since users attach all sorts of files.
fn is_note(name: &str) -> bool {
    name.to_lowercase().ends_with(".md")
}

/// Finds the next available filename in `folder` for `desired_name`,
/// checking real disk state (not a cache) so concurrent imports can't
/// collide: `photo.png`, then `photo 1.png`, `photo 2.png`, ...
pub fn unique_attachment_path(vault: &Vault, folder: &str, desired_name: &str) -> Result<String> {
    let (stem, ext) = split_stem_ext(desired_name);
    let candidate = |suffix: Option<u32>| -> String {
        let name = match (suffix, ext) {
            (None, Some(ext)) => format!("{stem}.{ext}"),
            (None, None) => stem.to_string(),
            (Some(n), Some(ext)) => format!("{stem} {n}.{ext}"),
            (Some(n), None) => format!("{stem} {n}"),
        };
        if folder.is_empty() {
            name
        } else {
            format!("{folder}/{name}")
        }
    };

    let mut relative = candidate(None);
    let mut n = 1;
    while vault.resolve(&relative)?.exists() {
        relative = candidate(Some(n));
        n += 1;
    }
    Ok(relative)
}

fn split_stem_ext(name: &str) -> (&str, Option<&str>) {
    match name.rfind('.') {
        Some(idx) if idx > 0 => (&name[..idx], Some(&name[idx + 1..])),
        _ => (name, None),
    }
}

/// Every non-note file in the vault that no note's `![[...]]` embed
/// references — matched by basename only (case-insensitive), so a file is
/// only ever flagged unused if *no* file sharing its name anywhere in the
/// vault is referenced either. That's a deliberately conservative rule:
/// erring toward "might still be in use" rather than risking a false
/// "unused" on something a link actually depends on.
pub fn find_unused_attachments(vault: &Vault) -> Result<Vec<String>> {
    let all_files = list_all_files(vault);
    let notes: Vec<&String> = all_files.iter().filter(|p| is_note(p)).collect();
    let attachments: Vec<&String> = all_files.iter().filter(|p| !is_note(p)).collect();

    let mut referenced: HashSet<String> = HashSet::new();
    for note in &notes {
        let Ok(absolute) = vault.resolve(note) else { continue };
        let Ok(content) = std::fs::read_to_string(&absolute) else { continue };
        for link in find_wikilinks(&content) {
            if link.kind != LinkKind::Embed {
                continue;
            }
            let basename = link
                .target
                .rsplit('/')
                .next()
                .unwrap_or(&link.target)
                .to_lowercase();
            referenced.insert(basename);
        }
    }

    let mut unused: Vec<String> = attachments
        .into_iter()
        .filter(|path| {
            let basename = path.rsplit('/').next().unwrap_or(path).to_lowercase();
            !referenced.contains(&basename)
        })
        .cloned()
        .collect();
    unused.sort();
    Ok(unused)
}

pub(crate) fn list_all_files(vault: &Vault) -> Vec<String> {
    let mut out = Vec::new();
    if let Ok(root) = tree::build_tree(vault) {
        collect_files(&root, &mut out);
    }
    out
}

fn collect_files(node: &tree::TreeNode, out: &mut Vec<String>) {
    if !node.is_dir && !node.path.is_empty() {
        out.push(node.path.clone());
    }
    for child in &node.children {
        collect_files(child, out);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (tempfile::TempDir, Vault) {
        let dir = tempfile::tempdir().unwrap();
        let vault = Vault::open(dir.path()).unwrap();
        (dir, vault)
    }

    #[test]
    fn unique_path_has_no_suffix_when_name_is_free() {
        let (_dir, vault) = setup();
        let path = unique_attachment_path(&vault, "assets", "photo.png").unwrap();
        assert_eq!(path, "assets/photo.png");
    }

    #[test]
    fn unique_path_adds_numeric_suffix_on_collision() {
        let (dir, vault) = setup();
        std::fs::create_dir_all(dir.path().join("assets")).unwrap();
        std::fs::write(dir.path().join("assets/photo.png"), b"existing").unwrap();

        let path = unique_attachment_path(&vault, "assets", "photo.png").unwrap();
        assert_eq!(path, "assets/photo 1.png");
    }

    #[test]
    fn unique_path_skips_multiple_existing_suffixes() {
        let (dir, vault) = setup();
        std::fs::create_dir_all(dir.path().join("assets")).unwrap();
        std::fs::write(dir.path().join("assets/photo.png"), b"a").unwrap();
        std::fs::write(dir.path().join("assets/photo 1.png"), b"b").unwrap();

        let path = unique_attachment_path(&vault, "assets", "photo.png").unwrap();
        assert_eq!(path, "assets/photo 2.png");
    }

    #[test]
    fn unique_path_preserves_spaces_and_special_characters() {
        let (_dir, vault) = setup();
        let path = unique_attachment_path(&vault, "assets", "my photo (final)!.png").unwrap();
        assert_eq!(path, "assets/my photo (final)!.png");
    }

    #[test]
    fn unique_path_works_at_vault_root() {
        let (_dir, vault) = setup();
        let path = unique_attachment_path(&vault, "", "photo.png").unwrap();
        assert_eq!(path, "photo.png");
    }

    #[test]
    fn finds_unreferenced_attachment() {
        let (dir, vault) = setup();
        std::fs::create_dir_all(dir.path().join("assets")).unwrap();
        std::fs::write(dir.path().join("assets/used.png"), b"a").unwrap();
        std::fs::write(dir.path().join("assets/unused.png"), b"b").unwrap();
        std::fs::write(dir.path().join("A.md"), "![[used.png]]").unwrap();

        let unused = find_unused_attachments(&vault).unwrap();
        assert_eq!(unused, vec!["assets/unused.png".to_string()]);
    }

    #[test]
    fn ordinary_wikilinks_do_not_count_as_referencing_an_attachment() {
        let (dir, vault) = setup();
        std::fs::create_dir_all(dir.path().join("assets")).unwrap();
        std::fs::write(dir.path().join("assets/photo.png"), b"a").unwrap();
        // A plain link (not an embed) to something named the same shouldn't count.
        std::fs::write(dir.path().join("A.md"), "[[photo.png]]").unwrap();

        let unused = find_unused_attachments(&vault).unwrap();
        assert_eq!(unused, vec!["assets/photo.png".to_string()]);
    }

    #[test]
    fn embed_with_size_and_alias_still_resolves_the_plain_basename() {
        let (dir, vault) = setup();
        std::fs::create_dir_all(dir.path().join("assets")).unwrap();
        std::fs::write(dir.path().join("assets/photo.png"), b"a").unwrap();
        std::fs::write(dir.path().join("A.md"), "![[photo.png|400]]").unwrap();

        let unused = find_unused_attachments(&vault).unwrap();
        assert!(unused.is_empty());
    }

    #[test]
    fn no_attachments_means_nothing_unused() {
        let (dir, vault) = setup();
        std::fs::write(dir.path().join("A.md"), "no attachments here").unwrap();
        assert!(find_unused_attachments(&vault).unwrap().is_empty());
    }
}
