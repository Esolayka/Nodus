use std::sync::{Arc, Mutex};

use crate::error::Result;
use crate::fs_ops;
use crate::index::{Backlink, GraphData, HeadingEntry, Index, Mention, TagCount};
use crate::replace::{self, ReplaceFilePreview, ReplaceSelection};
use crate::search::SearchFileResult;
use crate::tree::{self, TreeNode};
use crate::vault::Vault;
use crate::watcher::{ChangeKind, FsChange, VaultWatcher};
use crate::wikilink::find_wikilinks;

/// The single entry point to a vault: every consumer (the desktop app today,
/// possibly other frontends later) goes through this instead of touching
/// `fs_ops`/`Vault`/`VaultWatcher`/`Index` directly, so the vault-relative-path
/// contract, self-write suppression, and index consistency all stay in one
/// place.
pub struct VaultService {
    vault: Vault,
    watcher: VaultWatcher,
    index: Arc<Index>,
    /// Snapshot of every file a vault-wide replace touched, so the single
    /// most dangerous operation in the app has a one-command undo. Only the
    /// most recent replace is kept — this isn't a general undo stack.
    last_replace_undo: Mutex<Option<Vec<(String, String)>>>,
}

impl VaultService {
    /// Opens `path` as a vault, reconciles the link index against what's on
    /// disk, and starts watching it. `on_change` is called (on the watcher's
    /// background thread) for every external filesystem change, already
    /// filtered for the app's own writes; the index is kept in sync with
    /// external changes automatically, before `on_change` runs.
    pub fn open<F>(path: impl AsRef<std::path::Path>, mut on_change: F) -> Result<Self>
    where
        F: FnMut(FsChange) + Send + 'static,
    {
        let vault = Vault::open(path)?;
        let index = Arc::new(Index::open(vault.root())?);
        index.reconcile(&vault)?;

        let index_for_watcher = index.clone();
        let vault_for_watcher = vault.clone();
        let watcher = VaultWatcher::watch(&vault, move |change: FsChange| {
            if change.path.ends_with(".md") {
                match change.kind {
                    ChangeKind::Removed => {
                        let _ = index_for_watcher.remove_prefix(&change.path);
                    }
                    ChangeKind::Created | ChangeKind::Modified => {
                        let _ = index_for_watcher.update_note(&vault_for_watcher, &change.path);
                    }
                }
            }
            on_change(change);
        })?;

        Ok(Self {
            vault,
            watcher,
            index,
            last_replace_undo: Mutex::new(None),
        })
    }

    pub fn root(&self) -> &std::path::Path {
        self.vault.root()
    }

    pub fn tree(&self) -> Result<TreeNode> {
        tree::build_tree(&self.vault)
    }

    pub fn read_note(&self, relative: &str) -> Result<String> {
        fs_ops::read_note(&self.vault, relative)
    }

    pub fn write_note(&self, relative: &str, content: &str) -> Result<()> {
        let absolute = self.vault.resolve(relative)?;
        self.watcher.mark_self_write(&absolute);
        fs_ops::write_note(&self.vault, relative, content)?;
        self.index.update_note(&self.vault, relative)
    }

    pub fn create_file(&self, relative: &str) -> Result<()> {
        let absolute = self.vault.resolve(relative)?;
        self.watcher.mark_self_write(&absolute);
        fs_ops::create_file(&self.vault, relative)?;
        self.index.update_note(&self.vault, relative)
    }

    pub fn create_folder(&self, relative: &str) -> Result<()> {
        let absolute = self.vault.resolve(relative)?;
        self.watcher.mark_self_write(&absolute);
        fs_ops::create_folder(&self.vault, relative)
    }

    /// The vault-relative paths of notes that reference `old_relative` and
    /// would have their links rewritten by a rename to some other path —
    /// for showing a confirmation dialog ("links will be updated in N
    /// notes") before actually committing to the rename.
    pub fn preview_rename(&self, old_relative: &str) -> Result<Vec<String>> {
        let mut referencing = self.index.referencing_notes(old_relative)?;
        referencing.retain(|path| path != old_relative);
        Ok(referencing)
    }

    /// Renames/moves an entry and, if it's a note other notes link to,
    /// rewrites every `[[old name]]` reference across the vault to the new
    /// name. Returns the vault-relative paths of notes whose *content* was
    /// rewritten as a result (the renamed note itself isn't included — its
    /// content didn't change, only its path).
    pub fn rename_entry(&self, old_relative: &str, new_relative: &str) -> Result<Vec<String>> {
        let referencing = self.index.referencing_notes(old_relative)?;

        let old_absolute = self.vault.resolve(old_relative)?;
        let new_absolute = self.vault.resolve(new_relative)?;
        self.watcher.mark_self_write(&old_absolute);
        self.watcher.mark_self_write(&new_absolute);
        fs_ops::rename_entry(&self.vault, old_relative, new_relative)?;

        let mut relinked = Vec::new();
        for referencing_path in referencing {
            if referencing_path == old_relative {
                continue;
            }
            if self.rewrite_links_in_file(&referencing_path, old_relative, new_relative)? {
                relinked.push(referencing_path);
            }
        }

        self.index.rename_note(old_relative, new_relative)?;
        self.index.update_note(&self.vault, new_relative)?;

        Ok(relinked)
    }

    /// Rewrites every link in `relative` that resolves to `old_target` so it
    /// points at `new_target` instead, preserving heading/alias. Returns
    /// whether anything was changed.
    fn rewrite_links_in_file(
        &self,
        relative: &str,
        old_target: &str,
        new_target: &str,
    ) -> Result<bool> {
        let absolute = self.vault.resolve(relative)?;
        let content = std::fs::read_to_string(&absolute)?;
        let links = find_wikilinks(&content);

        let mut edits: Vec<((usize, usize), String)> = links
            .iter()
            .filter(|link| {
                self.index.resolve_target(&link.target, relative).as_deref() == Some(old_target)
            })
            .map(|link| {
                (
                    link.target_range,
                    rewritten_target_text(&link.target, new_target),
                )
            })
            .collect();
        if edits.is_empty() {
            return Ok(false);
        }

        edits.sort_by_key(|(range, _)| std::cmp::Reverse(range.0));
        let mut new_content = content;
        for ((start, end), replacement) in edits {
            new_content.replace_range(start..end, &replacement);
        }

        self.watcher.mark_self_write(&absolute);
        fs_ops::write_note(&self.vault, relative, &new_content)?;
        self.index.update_note(&self.vault, relative)?;
        Ok(true)
    }

    pub fn delete_entry(&self, relative: &str) -> Result<()> {
        let absolute = self.vault.resolve(relative)?;
        self.watcher.mark_self_write(&absolute);
        fs_ops::delete_entry(&self.vault, relative)?;
        self.index.remove_prefix(relative)
    }

    pub fn backlinks(&self, target_path: &str) -> Result<Vec<Backlink>> {
        self.index.backlinks(&self.vault, target_path)
    }

    pub fn graph(&self) -> Result<GraphData> {
        self.index.graph()
    }

    pub fn unlinked_mentions(&self, target_path: &str) -> Result<Vec<Mention>> {
        self.index.unlinked_mentions(target_path)
    }

    pub fn headings(&self, path: &str) -> Result<Vec<HeadingEntry>> {
        self.index.headings(path)
    }

    /// Resolves a raw `[[target]]` string (as typed, no `#heading`/`|alias`)
    /// to a vault-relative note path, if one is known — `from_path` breaks
    /// ties when several notes share a basename (closest by folder wins).
    pub fn resolve_link_target(&self, target: &str, from_path: &str) -> Option<String> {
        self.index.resolve_target(target, from_path)
    }

    /// Turns one specific unlinked-mention occurrence into a real
    /// `[[wikilink]]` by splicing `[[title]]` in at the given byte range.
    /// The expected text is checked first so a stale range (the file changed
    /// since the mention was found) is rejected instead of corrupting it.
    pub fn link_mention(
        &self,
        relative: &str,
        start: usize,
        end: usize,
        expected_text: &str,
    ) -> Result<()> {
        let absolute = self.vault.resolve(relative)?;
        let content = std::fs::read_to_string(&absolute)?;
        if content.get(start..end) != Some(expected_text) {
            return Err(crate::error::Error::NotFound(absolute));
        }
        let mut new_content = content;
        new_content.replace_range(start..end, &format!("[[{expected_text}]]"));
        self.watcher.mark_self_write(&absolute);
        fs_ops::write_note(&self.vault, relative, &new_content)?;
        self.index.update_note(&self.vault, relative)
    }

    pub fn search(&self, query: &str) -> Result<Vec<SearchFileResult>> {
        self.index.search(query)
    }

    pub fn tag_counts(&self) -> Result<Vec<TagCount>> {
        self.index.tag_counts()
    }

    /// Vault-relative paths of notes that carry `tag` — for a rename
    /// confirmation dialog, same idea as note rename's preview.
    pub fn preview_tag_rename(&self, tag: &str) -> Result<Vec<String>> {
        self.index.paths_with_tag(tag)
    }

    /// Renames a tag (inline `#tag` and frontmatter `tags:` entries alike)
    /// across every note that carries it. Returns the paths actually
    /// rewritten.
    pub fn rename_tag(&self, old_tag: &str, new_tag: &str) -> Result<Vec<String>> {
        let paths = self.index.paths_with_tag(old_tag)?;
        let mut renamed = Vec::new();
        for path in paths {
            if self.rewrite_tag_in_file(&path, old_tag, new_tag)? {
                renamed.push(path);
            }
        }
        Ok(renamed)
    }

    fn rewrite_tag_in_file(&self, relative: &str, old_tag: &str, new_tag: &str) -> Result<bool> {
        let absolute = self.vault.resolve(relative)?;
        let content = std::fs::read_to_string(&absolute)?;
        let old_lower = old_tag.to_lowercase();
        let mut edits: Vec<(usize, usize)> = crate::tags::find_tags(&content)
            .into_iter()
            .filter(|occ| occ.tag.to_lowercase() == old_lower)
            .map(|occ| (occ.start, occ.end))
            .collect();
        if edits.is_empty() {
            return Ok(false);
        }
        edits.sort_by_key(|(start, _)| std::cmp::Reverse(*start));

        let mut new_content = content;
        for (start, end) in edits {
            new_content.replace_range(start..end, new_tag);
        }

        self.watcher.mark_self_write(&absolute);
        fs_ops::write_note(&self.vault, relative, &new_content)?;
        self.index.update_note(&self.vault, relative)?;
        Ok(true)
    }

    /// Per-line preview of a vault-wide literal find/replace, across every
    /// note — nothing is written yet.
    pub fn preview_replace(
        &self,
        find: &str,
        replace_with: &str,
        skip_code_blocks: bool,
    ) -> Result<Vec<ReplaceFilePreview>> {
        let mut previews = Vec::new();
        for path in self.index.all_paths()? {
            let absolute = self.vault.resolve(&path)?;
            let Ok(content) = std::fs::read_to_string(&absolute) else {
                continue;
            };
            let matches = replace::preview_replace(&content, find, replace_with, skip_code_blocks);
            if !matches.is_empty() {
                previews.push(ReplaceFilePreview { path, matches });
            }
        }
        Ok(previews)
    }

    /// Applies a replace to exactly the selected (path, line) pairs from a
    /// prior preview, keeping a snapshot of every touched file's prior
    /// content so [`VaultService::undo_last_replace`] can restore it in one
    /// call — this is the most dangerous operation in the app, so it always
    /// gets a way back.
    pub fn apply_replace(
        &self,
        find: &str,
        replace_with: &str,
        selected: &[ReplaceSelection],
    ) -> Result<Vec<String>> {
        let mut by_path: std::collections::HashMap<String, std::collections::HashSet<usize>> =
            std::collections::HashMap::new();
        for sel in selected {
            by_path.entry(sel.path.clone()).or_default().insert(sel.line);
        }

        let mut undo_bundle = Vec::new();
        let mut changed_paths = Vec::new();
        for (path, lines) in by_path {
            let absolute = self.vault.resolve(&path)?;
            let Ok(content) = std::fs::read_to_string(&absolute) else {
                continue;
            };
            let new_content = replace::apply_selected_lines(&content, find, replace_with, &lines);
            if new_content == content {
                continue;
            }
            undo_bundle.push((path.clone(), content));
            self.watcher.mark_self_write(&absolute);
            fs_ops::write_note(&self.vault, &path, &new_content)?;
            self.index.update_note(&self.vault, &path)?;
            changed_paths.push(path);
        }

        *self.last_replace_undo.lock().expect("undo mutex poisoned") = Some(undo_bundle);
        changed_paths.sort();
        Ok(changed_paths)
    }

    /// Restores every file touched by the most recent [`VaultService::apply_replace`]
    /// to its prior content. Returns the restored paths (empty if there's
    /// nothing to undo, e.g. it was already undone once) — callers use this
    /// to notify any open editors the same way a rename's relinked files do.
    pub fn undo_last_replace(&self) -> Result<Vec<String>> {
        let bundle = self
            .last_replace_undo
            .lock()
            .expect("undo mutex poisoned")
            .take();
        let Some(bundle) = bundle else {
            return Ok(Vec::new());
        };
        let mut restored = Vec::new();
        for (path, original_content) in bundle {
            let absolute = self.vault.resolve(&path)?;
            self.watcher.mark_self_write(&absolute);
            fs_ops::write_note(&self.vault, &path, &original_content)?;
            self.index.update_note(&self.vault, &path)?;
            restored.push(path);
        }
        Ok(restored)
    }
}

fn rewritten_target_text(old_target: &str, new_relative: &str) -> String {
    let new_stem = new_relative.strip_suffix(".md").unwrap_or(new_relative);
    if old_target.contains('/') {
        new_stem.to_string()
    } else {
        new_stem.rsplit('/').next().unwrap_or(new_stem).to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open(dir: &std::path::Path) -> VaultService {
        VaultService::open(dir, |_| {}).unwrap()
    }

    #[test]
    fn rename_rewrites_referencing_links_and_index() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("A.md"), "See [[B]] for details.").unwrap();
        std::fs::write(dir.path().join("B.md"), "content").unwrap();
        let service = open(dir.path());

        let relinked = service.rename_entry("B.md", "C.md").unwrap();

        assert_eq!(relinked, vec!["A.md".to_string()]);
        assert!(!dir.path().join("B.md").exists());
        assert!(dir.path().join("C.md").exists());
        let a_content = std::fs::read_to_string(dir.path().join("A.md")).unwrap();
        assert_eq!(a_content, "See [[C]] for details.");

        let backlinks = service.backlinks("C.md").unwrap();
        assert_eq!(backlinks.len(), 1);
        assert_eq!(backlinks[0].from_path, "A.md");
    }

    #[test]
    fn rename_preserves_heading_and_alias() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("A.md"), "[[B#Section|shown text]]").unwrap();
        std::fs::write(dir.path().join("B.md"), "# Section\ncontent").unwrap();
        let service = open(dir.path());

        service.rename_entry("B.md", "C.md").unwrap();

        let a_content = std::fs::read_to_string(dir.path().join("A.md")).unwrap();
        assert_eq!(a_content, "[[C#Section|shown text]]");
    }

    #[test]
    fn rename_rewrites_embed() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("A.md"), "Intro\n\n![[B]]\n\nMore text.").unwrap();
        std::fs::write(dir.path().join("B.md"), "embedded content").unwrap();
        let service = open(dir.path());

        service.rename_entry("B.md", "C.md").unwrap();

        let a_content = std::fs::read_to_string(dir.path().join("A.md")).unwrap();
        assert_eq!(a_content, "Intro\n\n![[C]]\n\nMore text.");
    }

    #[test]
    fn rename_does_not_touch_link_in_code_block() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("A.md"),
            "Real link: [[B]].\n\n```\nExample syntax: [[B]]\n```\n",
        )
        .unwrap();
        std::fs::write(dir.path().join("B.md"), "content").unwrap();
        let service = open(dir.path());

        service.rename_entry("B.md", "C.md").unwrap();

        let a_content = std::fs::read_to_string(dir.path().join("A.md")).unwrap();
        assert_eq!(
            a_content,
            "Real link: [[C]].\n\n```\nExample syntax: [[B]]\n```\n"
        );
    }

    #[test]
    fn rename_rewrites_link_in_frontmatter() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("A.md"),
            "---\nrelated: \"[[B]]\"\n---\n\nBody.",
        )
        .unwrap();
        std::fs::write(dir.path().join("B.md"), "content").unwrap();
        let service = open(dir.path());

        service.rename_entry("B.md", "C.md").unwrap();

        let a_content = std::fs::read_to_string(dir.path().join("A.md")).unwrap();
        assert_eq!(a_content, "---\nrelated: \"[[C]]\"\n---\n\nBody.");
    }

    #[test]
    fn preview_rename_lists_referencing_notes_without_renaming() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("A.md"), "[[B]]").unwrap();
        std::fs::write(dir.path().join("B.md"), "content").unwrap();
        let service = open(dir.path());

        let affected = service.preview_rename("B.md").unwrap();

        assert_eq!(affected, vec!["A.md".to_string()]);
        // Nothing was actually renamed or rewritten.
        assert!(dir.path().join("B.md").exists());
        let a_content = std::fs::read_to_string(dir.path().join("A.md")).unwrap();
        assert_eq!(a_content, "[[B]]");
    }

    #[test]
    fn rename_does_not_touch_unrelated_same_name_text() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("A.md"),
            "Just the word B in prose, and [[B]].",
        )
        .unwrap();
        std::fs::write(dir.path().join("B.md"), "content").unwrap();
        let service = open(dir.path());

        service.rename_entry("B.md", "C.md").unwrap();

        let a_content = std::fs::read_to_string(dir.path().join("A.md")).unwrap();
        assert_eq!(a_content, "Just the word B in prose, and [[C]].");
    }

    #[test]
    fn write_and_create_keep_index_current() {
        let dir = tempfile::tempdir().unwrap();
        let service = open(dir.path());

        service.create_file("A.md").unwrap();
        service.write_note("A.md", "[[B]]").unwrap();
        service.create_file("B.md").unwrap();

        let backlinks = service.backlinks("B.md").unwrap();
        assert_eq!(backlinks.len(), 1);
        assert_eq!(backlinks[0].from_path, "A.md");
    }

    #[test]
    fn delete_removes_note_from_index() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("A.md"), "[[B]]").unwrap();
        std::fs::write(dir.path().join("B.md"), "").unwrap();
        let service = open(dir.path());

        service.delete_entry("B.md").unwrap();

        assert!(service.backlinks("B.md").unwrap().is_empty());
    }

    #[test]
    fn link_mention_inserts_wikilink_at_expected_range() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("A.md"), "Talks about Target here.").unwrap();
        std::fs::write(dir.path().join("Target.md"), "content").unwrap();
        let service = open(dir.path());

        let mentions = service.unlinked_mentions("Target.md").unwrap();
        assert_eq!(mentions.len(), 1);
        let m = &mentions[0];

        service
            .link_mention(&m.from_path, m.start, m.end, "Target")
            .unwrap();

        let content = std::fs::read_to_string(dir.path().join("A.md")).unwrap();
        assert_eq!(content, "Talks about [[Target]] here.");
    }

    #[test]
    fn link_mention_rejects_stale_range() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("A.md"), "Talks about Target here.").unwrap();
        std::fs::write(dir.path().join("Target.md"), "content").unwrap();
        let service = open(dir.path());

        // The file changed since the range was computed (e.g. by a concurrent edit).
        std::fs::write(dir.path().join("A.md"), "Completely different text now.").unwrap();

        let result = service.link_mention("A.md", 12, 18, "Target");
        assert!(result.is_err());
        let content = std::fs::read_to_string(dir.path().join("A.md")).unwrap();
        assert_eq!(content, "Completely different text now.");
    }

    #[test]
    fn rename_tag_rewrites_inline_and_frontmatter_occurrences() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("A.md"), "Body with #project tag.\n").unwrap();
        std::fs::write(
            dir.path().join("B.md"),
            "---\ntags:\n  - project\n---\nBody.\n",
        )
        .unwrap();
        std::fs::write(dir.path().join("C.md"), "Unrelated note.\n").unwrap();
        let service = open(dir.path());

        let affected = service.preview_tag_rename("project").unwrap();
        assert_eq!(affected.len(), 2);

        let renamed = service.rename_tag("project", "work").unwrap();
        assert_eq!(renamed.len(), 2);

        let a = std::fs::read_to_string(dir.path().join("A.md")).unwrap();
        assert_eq!(a, "Body with #work tag.\n");
        let b = std::fs::read_to_string(dir.path().join("B.md")).unwrap();
        assert_eq!(b, "---\ntags:\n  - work\n---\nBody.\n");
    }

    #[test]
    fn replace_preview_apply_and_undo_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("A.md"), "foo one\nfoo two\n").unwrap();
        std::fs::write(dir.path().join("B.md"), "no match here\n").unwrap();
        let service = open(dir.path());

        let preview = service.preview_replace("foo", "bar", false).unwrap();
        assert_eq!(preview.len(), 1);
        assert_eq!(preview[0].path, "A.md");
        assert_eq!(preview[0].matches.len(), 2);

        // Only select the first match, leaving the second untouched.
        let changed = service
            .apply_replace(
                "foo",
                "bar",
                &[crate::replace::ReplaceSelection {
                    path: "A.md".to_string(),
                    line: 1,
                }],
            )
            .unwrap();
        assert_eq!(changed, vec!["A.md".to_string()]);
        let content = std::fs::read_to_string(dir.path().join("A.md")).unwrap();
        assert_eq!(content, "bar one\nfoo two\n");

        let undone = service.undo_last_replace().unwrap();
        assert_eq!(undone, vec!["A.md".to_string()]);
        let restored = std::fs::read_to_string(dir.path().join("A.md")).unwrap();
        assert_eq!(restored, "foo one\nfoo two\n");

        // A second undo has nothing left to do.
        assert!(service.undo_last_replace().unwrap().is_empty());
    }
}
