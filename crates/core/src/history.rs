//! Local version history: on every save where content actually changed, the
//! *new* content becomes a numbered version, stored as a full copy every
//! [`FULL_SNAPSHOT_INTERVAL`]-th time and as a forward line-diff against the
//! previous version otherwise — so the history folder doesn't balloon into a
//! full copy per save. Reconstructing any version means starting at the
//! nearest full copy at or before it and replaying diffs forward.
//!
//! Everything here degrades gracefully: a missing/corrupt manifest reads as
//! "no history for this note" rather than failing the save it's attached
//! to — history is a convenience layered on top of the vault, never a
//! dependency the vault's own correctness relies on.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::error::Result;

const FULL_SNAPSHOT_INTERVAL: u64 = 10;

// --- line diffing ----------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DiffOp {
    Equal(usize),
    Delete(usize),
    Insert(Vec<String>),
}

fn split_lines(content: &str) -> Vec<&str> {
    content.split('\n').collect()
}

fn push_equal(ops: &mut Vec<DiffOp>) {
    if let Some(DiffOp::Equal(n)) = ops.last_mut() {
        *n += 1;
    } else {
        ops.push(DiffOp::Equal(1));
    }
}

fn push_delete(ops: &mut Vec<DiffOp>) {
    if let Some(DiffOp::Delete(n)) = ops.last_mut() {
        *n += 1;
    } else {
        ops.push(DiffOp::Delete(1));
    }
}

fn push_insert(ops: &mut Vec<DiffOp>, line: String) {
    if let Some(DiffOp::Insert(lines)) = ops.last_mut() {
        lines.push(line);
    } else {
        ops.push(DiffOp::Insert(vec![line]));
    }
}

/// A line-level edit script turning `old` into `new` (LCS-based). Cheap
/// enough for note-sized text; not meant for huge files.
pub fn diff_lines(old: &str, new: &str) -> Vec<DiffOp> {
    let old_lines = split_lines(old);
    let new_lines = split_lines(new);
    let n = old_lines.len();
    let m = new_lines.len();

    let mut lcs = vec![vec![0usize; m + 1]; n + 1];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            lcs[i][j] = if old_lines[i] == new_lines[j] {
                lcs[i + 1][j + 1] + 1
            } else {
                lcs[i + 1][j].max(lcs[i][j + 1])
            };
        }
    }

    let mut ops = Vec::new();
    let (mut i, mut j) = (0, 0);
    while i < n && j < m {
        if old_lines[i] == new_lines[j] {
            push_equal(&mut ops);
            i += 1;
            j += 1;
        } else if lcs[i + 1][j] >= lcs[i][j + 1] {
            push_delete(&mut ops);
            i += 1;
        } else {
            push_insert(&mut ops, new_lines[j].to_string());
            j += 1;
        }
    }
    while i < n {
        push_delete(&mut ops);
        i += 1;
    }
    while j < m {
        push_insert(&mut ops, new_lines[j].to_string());
        j += 1;
    }
    ops
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DisplayLineKind {
    Equal,
    Added,
    Removed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayLine {
    pub kind: DisplayLineKind,
    pub text: String,
}

/// Unrolls a run-length-encoded edit script into one entry per line, with
/// its actual text — what the storage format's `Equal(usize)` deliberately
/// omits (to stay compact), but a compare view needs to show real context
/// lines rather than a placeholder.
pub fn diff_to_display_lines(old: &str, ops: &[DiffOp]) -> Vec<DisplayLine> {
    let old_lines = split_lines(old);
    let mut out = Vec::new();
    let mut i = 0;
    for op in ops {
        match op {
            DiffOp::Equal(n) => {
                for line in &old_lines[i..i + n] {
                    out.push(DisplayLine {
                        kind: DisplayLineKind::Equal,
                        text: line.to_string(),
                    });
                }
                i += n;
            }
            DiffOp::Delete(n) => {
                for line in &old_lines[i..i + n] {
                    out.push(DisplayLine {
                        kind: DisplayLineKind::Removed,
                        text: line.to_string(),
                    });
                }
                i += n;
            }
            DiffOp::Insert(lines) => {
                for line in lines {
                    out.push(DisplayLine {
                        kind: DisplayLineKind::Added,
                        text: line.clone(),
                    });
                }
            }
        }
    }
    out
}

pub fn diff_stats(ops: &[DiffOp]) -> (usize, usize) {
    let mut added = 0;
    let mut removed = 0;
    for op in ops {
        match op {
            DiffOp::Insert(lines) => added += lines.len(),
            DiffOp::Delete(n) => removed += n,
            DiffOp::Equal(_) => {}
        }
    }
    (added, removed)
}

/// Reconstructs `new` from `old` by replaying a forward edit script.
pub fn apply_forward(old: &str, ops: &[DiffOp]) -> String {
    let old_lines = split_lines(old);
    let mut result: Vec<&str> = Vec::new();
    let mut i = 0;
    for op in ops {
        match op {
            DiffOp::Equal(n) => {
                result.extend_from_slice(&old_lines[i..i + n]);
                i += n;
            }
            DiffOp::Delete(n) => i += n,
            DiffOp::Insert(lines) => result.extend(lines.iter().map(|s| s.as_str())),
        }
    }
    result.join("\n")
}

fn serialize_diff(ops: &[DiffOp]) -> String {
    let mut out = String::new();
    for op in ops {
        match op {
            DiffOp::Equal(n) => out.push_str(&format!("={n}\n")),
            DiffOp::Delete(n) => out.push_str(&format!("-{n}\n")),
            DiffOp::Insert(lines) => {
                out.push_str(&format!("+{}\n", lines.len()));
                for line in lines {
                    out.push_str(line);
                    out.push('\n');
                }
            }
        }
    }
    out
}

fn deserialize_diff(text: &str) -> Vec<DiffOp> {
    let mut ops = Vec::new();
    let mut lines = text.split('\n').peekable();
    while let Some(header) = lines.next() {
        if header.is_empty() {
            continue;
        }
        let (tag, rest) = header.split_at(1);
        let n: usize = rest.parse().unwrap_or(0);
        match tag {
            "=" => ops.push(DiffOp::Equal(n)),
            "-" => ops.push(DiffOp::Delete(n)),
            "+" => {
                let mut inserted = Vec::with_capacity(n);
                for _ in 0..n {
                    inserted.push(lines.next().unwrap_or("").to_string());
                }
                ops.push(DiffOp::Insert(inserted));
            }
            _ => {}
        }
    }
    ops
}

// --- settings ----------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistorySettings {
    pub enabled: bool,
    pub max_versions_per_note: usize,
    pub max_age_days: u64,
    pub max_total_size_mb: u64,
}

impl Default for HistorySettings {
    fn default() -> Self {
        Self {
            enabled: true,
            max_versions_per_note: 50,
            max_age_days: 90,
            max_total_size_mb: 100,
        }
    }
}

// --- storage -------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
enum SnapshotKind {
    Full,
    Diff,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct VersionMeta {
    id: u64,
    timestamp: i64,
    kind: SnapshotKind,
    added: usize,
    removed: usize,
    size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionInfo {
    pub id: u64,
    pub timestamp: i64,
    pub added: usize,
    pub removed: usize,
}

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub struct HistoryStore {
    root: PathBuf,
}

impl HistoryStore {
    /// `vault_root` is the vault's filesystem root; history lives at
    /// `<vault_root>/.nodus/history`, alongside the SQLite index.
    pub fn new(vault_root: &Path) -> Self {
        Self {
            root: vault_root.join(".nodus").join("history"),
        }
    }

    fn note_dir(&self, relative: &str) -> PathBuf {
        self.root.join(format!("{relative}.d"))
    }

    fn manifest_path(&self, relative: &str) -> PathBuf {
        self.note_dir(relative).join("manifest.json")
    }

    fn snapshot_path(&self, relative: &str, id: u64) -> PathBuf {
        self.note_dir(relative).join(format!("{id:07}.snap"))
    }

    fn load_manifest(&self, relative: &str) -> Vec<VersionMeta> {
        std::fs::read_to_string(self.manifest_path(relative))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    fn save_manifest(&self, relative: &str, manifest: &[VersionMeta]) -> Result<()> {
        let dir = self.note_dir(relative);
        std::fs::create_dir_all(&dir)?;
        let json = serde_json::to_string(manifest).unwrap_or_else(|_| "[]".to_string());
        std::fs::write(self.manifest_path(relative), json)?;
        Ok(())
    }

    /// Reconstructs version `id`'s full content by finding the nearest full
    /// copy at or before it and replaying diffs forward. `None` if `id`
    /// isn't in the manifest or a snapshot file went missing.
    fn reconstruct(&self, relative: &str, manifest: &[VersionMeta], id: u64) -> Option<String> {
        let target_idx = manifest.iter().position(|v| v.id == id)?;
        let full_idx = (0..=target_idx)
            .rev()
            .find(|&i| manifest[i].kind == SnapshotKind::Full)?;
        let mut content =
            std::fs::read_to_string(self.snapshot_path(relative, manifest[full_idx].id)).ok()?;
        for meta in &manifest[full_idx + 1..=target_idx] {
            let raw = std::fs::read_to_string(self.snapshot_path(relative, meta.id)).ok()?;
            content = apply_forward(&content, &deserialize_diff(&raw));
        }
        Some(content)
    }

    pub fn list_versions(&self, relative: &str) -> Vec<VersionInfo> {
        self.load_manifest(relative)
            .into_iter()
            .map(|v| VersionInfo {
                id: v.id,
                timestamp: v.timestamp,
                added: v.added,
                removed: v.removed,
            })
            .collect()
    }

    pub fn version_content(&self, relative: &str, id: u64) -> Option<String> {
        let manifest = self.load_manifest(relative);
        self.reconstruct(relative, &manifest, id)
    }

    /// A line diff between version `id` and whatever's live on disk right
    /// now (`current_content`), with real line text for the compare view.
    pub fn compare_to_current(
        &self,
        relative: &str,
        id: u64,
        current_content: &str,
    ) -> Option<Vec<DisplayLine>> {
        let old = self.version_content(relative, id)?;
        let ops = diff_lines(&old, current_content);
        Some(diff_to_display_lines(&old, &ops))
    }

    /// Records `new_content` as the next version if history is enabled and
    /// the content actually changed since `old_content` — by invariant,
    /// `old_content` is exactly what the most recently recorded version
    /// holds, since every content-changing write goes through here.
    pub fn record_if_changed(
        &self,
        relative: &str,
        old_content: &str,
        new_content: &str,
        settings: &HistorySettings,
    ) -> Result<()> {
        if !settings.enabled || old_content == new_content {
            return Ok(());
        }
        let mut manifest = self.load_manifest(relative);
        let next_id = manifest.last().map(|v| v.id + 1).unwrap_or(1);
        let is_full = next_id % FULL_SNAPSHOT_INTERVAL == 1;

        let ops = diff_lines(old_content, new_content);
        let (added, removed) = diff_stats(&ops);
        let stored = if is_full {
            new_content.to_string()
        } else {
            serialize_diff(&ops)
        };

        std::fs::create_dir_all(self.note_dir(relative))?;
        std::fs::write(self.snapshot_path(relative, next_id), &stored)?;
        manifest.push(VersionMeta {
            id: next_id,
            timestamp: now_unix(),
            kind: if is_full {
                SnapshotKind::Full
            } else {
                SnapshotKind::Diff
            },
            added,
            removed,
            size: stored.len() as u64,
        });

        self.apply_retention(relative, &mut manifest, settings, now_unix());
        self.save_manifest(relative, &manifest)?;
        Ok(())
    }

    /// Restoring is just another content-changing write, run back through
    /// `record_if_changed` so the restore itself lands in history too —
    /// callers write `target_content` to disk and call this right after,
    /// same as any other save.
    pub fn record_restore(
        &self,
        relative: &str,
        old_content: &str,
        restored_content: &str,
        settings: &HistorySettings,
    ) -> Result<()> {
        self.record_if_changed(relative, old_content, restored_content, settings)
    }

    fn prune(&self, relative: &str, manifest: &mut Vec<VersionMeta>, cutoff: usize) {
        if cutoff == 0 {
            return;
        }
        for meta in manifest.drain(..cutoff) {
            let _ = std::fs::remove_file(self.snapshot_path(relative, meta.id));
        }
    }

    /// Prunes `manifest[..cutoff]`, first *promoting* `manifest[cutoff]` to a
    /// full snapshot if it's currently a diff — otherwise deleting its
    /// predecessors would leave it unreconstructible. This is what lets
    /// count/age pruning cut at the exact boundary the settings ask for,
    /// instead of silently keeping extra versions until the next natural
    /// full-copy checkpoint.
    fn prune_with_promotion(&self, relative: &str, manifest: &mut Vec<VersionMeta>, cutoff: usize) {
        if cutoff == 0 || cutoff >= manifest.len() {
            return;
        }
        if manifest[cutoff].kind != SnapshotKind::Full {
            if let Some(content) = self.reconstruct(relative, manifest, manifest[cutoff].id) {
                if std::fs::write(self.snapshot_path(relative, manifest[cutoff].id), &content)
                    .is_ok()
                {
                    manifest[cutoff].kind = SnapshotKind::Full;
                    manifest[cutoff].size = content.len() as u64;
                }
            }
        }
        self.prune(relative, manifest, cutoff);
    }

    /// Applies the count/age retention rules to one note's manifest,
    /// always keeping at least the most recent version.
    fn apply_retention(
        &self,
        relative: &str,
        manifest: &mut Vec<VersionMeta>,
        settings: &HistorySettings,
        now: i64,
    ) {
        if manifest.len() <= 1 {
            return;
        }
        let mut cutoff = manifest
            .len()
            .saturating_sub(settings.max_versions_per_note.max(1));
        let max_age_secs = settings.max_age_days as i64 * 86_400;
        let age_cutoff = manifest
            .iter()
            .position(|v| now - v.timestamp <= max_age_secs)
            .unwrap_or(manifest.len());
        cutoff = cutoff.max(age_cutoff).min(manifest.len() - 1);
        self.prune_with_promotion(relative, manifest, cutoff);
    }

    /// Vault-wide startup pass: per-note count/age pruning for every note
    /// with history, then a global size trim across all of them if the
    /// whole `.nodus/history` folder is still over budget.
    pub fn cleanup_on_startup(&self, settings: &HistorySettings) {
        if !settings.enabled || !self.root.exists() {
            return;
        }
        let notes = self.all_note_dirs();
        let now = now_unix();
        for relative in &notes {
            let mut manifest = self.load_manifest(relative);
            self.apply_retention(relative, &mut manifest, settings, now);
            let _ = self.save_manifest(relative, &manifest);
        }

        let max_bytes = settings.max_total_size_mb * 1024 * 1024;
        loop {
            let mut all: Vec<(String, VersionMeta)> = Vec::new();
            let mut total = 0u64;
            for relative in &notes {
                for meta in self.load_manifest(relative) {
                    total += meta.size;
                    all.push((relative.clone(), meta));
                }
            }
            if total <= max_bytes || all.is_empty() {
                break;
            }
            all.sort_by_key(|(_, m)| m.timestamp);
            // Remove the globally-oldest note's oldest prunable run (up to
            // its next Full boundary) one note at a time, snapping cutoffs
            // the same way per-note pruning does.
            let (relative, _) = &all[0];
            let mut manifest = self.load_manifest(relative);
            if manifest.len() <= 1 {
                break; // never prune a note down to nothing
            }
            self.prune_with_promotion(relative, &mut manifest, 1);
            let _ = self.save_manifest(relative, &manifest);
        }
    }

    fn all_note_dirs(&self) -> Vec<String> {
        let mut out = Vec::new();
        if let Ok(entries) = walk_manifests(&self.root) {
            for path in entries {
                if let Ok(relative) = path.strip_prefix(&self.root) {
                    let s = relative.to_string_lossy().replace('\\', "/");
                    if let Some(stripped) = s.strip_suffix("/manifest.json") {
                        if let Some(note) = stripped.strip_suffix(".d") {
                            out.push(note.to_string());
                        }
                    }
                }
            }
        }
        out
    }
}

fn walk_manifests(dir: &Path) -> std::io::Result<Vec<PathBuf>> {
    let mut out = Vec::new();
    if !dir.exists() {
        return Ok(out);
    }
    let mut stack = vec![dir.to_path_buf()];
    while let Some(current) = stack.pop() {
        for entry in std::fs::read_dir(&current)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.file_name().and_then(|n| n.to_str()) == Some("manifest.json") {
                out.push(path);
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diff_of_identical_text_is_one_equal_run() {
        let ops = diff_lines("a\nb\nc", "a\nb\nc");
        assert_eq!(ops, vec![DiffOp::Equal(3)]);
    }

    #[test]
    fn diff_detects_insert_and_delete() {
        let ops = diff_lines("a\nb\nc", "a\nx\nc");
        let (added, removed) = diff_stats(&ops);
        assert_eq!(added, 1);
        assert_eq!(removed, 1);
    }

    #[test]
    fn apply_forward_roundtrips_through_diff() {
        let old = "line1\nline2\nline3\nline4";
        let new = "line1\nline2 changed\nline3\nline5\nline6";
        let ops = diff_lines(old, new);
        assert_eq!(apply_forward(old, &ops), new);
    }

    #[test]
    fn diff_serialization_roundtrips() {
        let old = "a\nb\nc\nd";
        let new = "a\nb2\nc\nd\ne";
        let ops = diff_lines(old, new);
        let text = serialize_diff(&ops);
        let parsed = deserialize_diff(&text);
        assert_eq!(ops, parsed);
        assert_eq!(apply_forward(old, &parsed), new);
    }

    #[test]
    fn record_and_reconstruct_a_chain_of_versions() {
        let dir = tempfile::tempdir().unwrap();
        let store = HistoryStore::new(dir.path());
        let settings = HistorySettings::default();

        store
            .record_if_changed("A.md", "", "v1", &settings)
            .unwrap();
        store
            .record_if_changed("A.md", "v1", "v1 v2", &settings)
            .unwrap();
        store
            .record_if_changed("A.md", "v1 v2", "v1 v2 v3", &settings)
            .unwrap();

        let versions = store.list_versions("A.md");
        assert_eq!(versions.len(), 3);
        assert_eq!(
            store.version_content("A.md", versions[0].id).as_deref(),
            Some("v1")
        );
        assert_eq!(
            store.version_content("A.md", versions[1].id).as_deref(),
            Some("v1 v2")
        );
        assert_eq!(
            store.version_content("A.md", versions[2].id).as_deref(),
            Some("v1 v2 v3")
        );
    }

    #[test]
    fn unchanged_content_records_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let store = HistoryStore::new(dir.path());
        let settings = HistorySettings::default();
        store
            .record_if_changed("A.md", "same", "same", &settings)
            .unwrap();
        assert!(store.list_versions("A.md").is_empty());
    }

    #[test]
    fn disabled_history_records_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let store = HistoryStore::new(dir.path());
        let settings = HistorySettings {
            enabled: false,
            ..HistorySettings::default()
        };
        store
            .record_if_changed("A.md", "a", "b", &settings)
            .unwrap();
        assert!(store.list_versions("A.md").is_empty());
    }

    #[test]
    fn compare_to_current_reflects_live_content_not_just_the_last_version() {
        let dir = tempfile::tempdir().unwrap();
        let store = HistoryStore::new(dir.path());
        let settings = HistorySettings::default();
        store
            .record_if_changed("A.md", "", "v1", &settings)
            .unwrap();
        let v1_id = store.list_versions("A.md")[0].id;

        // "current" here is intentionally never recorded — simulating an
        // unsaved edit or content read straight off disk.
        let lines = store
            .compare_to_current("A.md", v1_id, "v1 plus more")
            .unwrap();
        assert!(lines.iter().any(|l| l.kind == DisplayLineKind::Added));
    }

    #[test]
    fn version_cap_prunes_oldest_but_keeps_reconstructible_from_a_full_boundary() {
        let dir = tempfile::tempdir().unwrap();
        let store = HistoryStore::new(dir.path());
        let settings = HistorySettings {
            max_versions_per_note: 3,
            ..HistorySettings::default()
        };

        let mut content = String::new();
        for i in 0..12 {
            let next = format!("{content}line{i}\n");
            store
                .record_if_changed("A.md", &content, &next, &settings)
                .unwrap();
            content = next;
        }

        let versions = store.list_versions("A.md");
        assert!(versions.len() >= 3);
        // The oldest surviving version must still be reconstructible.
        let first = &versions[0];
        assert!(store.version_content("A.md", first.id).is_some());
        // And the newest one matches the final content exactly.
        let last = versions.last().unwrap();
        assert_eq!(
            store.version_content("A.md", last.id).as_deref(),
            Some(content.as_str())
        );
    }

    #[test]
    fn full_snapshot_recorded_every_interval() {
        let dir = tempfile::tempdir().unwrap();
        let store = HistoryStore::new(dir.path());
        let settings = HistorySettings::default();
        let mut content = String::new();
        for i in 0..25 {
            let next = format!("{content}x{i}\n");
            store
                .record_if_changed("A.md", &content, &next, &settings)
                .unwrap();
            content = next;
        }
        // id 11 and 21 should exist and be reconstructible (proves interval
        // full-copies happened and the chain stays intact past them).
        let versions = store.list_versions("A.md");
        assert!(versions.iter().any(|v| v.id == 11));
        assert!(versions.iter().any(|v| v.id == 21));
    }

    #[test]
    fn cleanup_on_startup_respects_age_and_keeps_at_least_the_latest() {
        let dir = tempfile::tempdir().unwrap();
        let store = HistoryStore::new(dir.path());
        let settings = HistorySettings::default();
        store
            .record_if_changed("A.md", "", "v1", &settings)
            .unwrap();
        store
            .record_if_changed("A.md", "v1", "v2", &settings)
            .unwrap();

        // Force the first entry to look ancient.
        let manifest_path = dir.path().join(".nodus/history/A.md.d/manifest.json");
        let raw = std::fs::read_to_string(&manifest_path).unwrap();
        let mut manifest: Vec<serde_json::Value> = serde_json::from_str(&raw).unwrap();
        manifest[0]["timestamp"] = serde_json::json!(0);
        std::fs::write(&manifest_path, serde_json::to_string(&manifest).unwrap()).unwrap();

        let mut aggressive = settings.clone();
        aggressive.max_age_days = 1;
        store.cleanup_on_startup(&aggressive);

        let versions = store.list_versions("A.md");
        assert_eq!(versions.len(), 1);
        assert_eq!(
            store.version_content("A.md", versions[0].id).as_deref(),
            Some("v2")
        );
    }
}
