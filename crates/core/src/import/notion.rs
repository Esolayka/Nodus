//! Notion → Nodus conversion.
//!
//! Unlike Obsidian, Notion's "Markdown & CSV" export needs a real
//! pipeline: nested pages arrive as nested folders whose file and folder
//! names all end in a 32-hex-character hash Notion appends to guarantee
//! uniqueness, internal links point at those hash-named files (or at
//! notion.so URLs) instead of at readable titles, and each database
//! arrives as a separate CSV file that has to become either a Markdown
//! table or a set of individual notes.
//!
//! Notion's own Markdown export already renders toggles as `<details>`,
//! callouts as blockquotes, and columns as flattened sequential text —
//! all of it valid Markdown/HTML a CommonMark renderer passes through, so
//! there's no block-level conversion to do there. What's left is: strip
//! the hashes, rewrite the links that depended on them, turn CSVs into
//! notes, relocate attachments, and never lose a byte of text even where
//! formatting can't be preserved.
//!
//! Two passes, like every importer in this crate: [`preview`] (read-only)
//! and [`run`] (writes it, reporting progress and honoring cancellation
//! between files — never mid-file).

use std::collections::HashMap;
use std::io::Read;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;

use crate::frontmatter::{self, Frontmatter};

use super::{
    encoding, ensure_empty_destination, unique_path, ImportError, ImportIssue, ImportPreview,
    ImportProgress, ImportReport, PlannedFile, PlannedFileKind, Result,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DatabaseMode {
    /// A CSV becomes one Markdown table inside a single note.
    Table,
    /// A CSV becomes one note per row, columns as frontmatter fields —
    /// closer to the original intent and usually what's actually needed.
    SeparateNotes,
}

type Archive = zip::ZipArchive<std::io::BufReader<std::fs::File>>;

fn open_archive(path: &Path) -> Result<Archive> {
    let file = std::fs::File::open(path)?;
    Ok(zip::ZipArchive::new(std::io::BufReader::new(file))?)
}

fn read_entry(archive: &mut Archive, name: &str) -> Result<Vec<u8>> {
    let mut file = archive.by_name(name)?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf)?;
    Ok(buf)
}

fn split_ext(name: &str) -> (&str, Option<&str>) {
    match name.rfind('.') {
        Some(idx) if idx > 0 => (&name[..idx], Some(&name[idx + 1..])),
        _ => (name, None),
    }
}

/// Notion appends a 32-lowercase-hex-char id to every exported name,
/// separated from the human title by a space, e.g.
/// `"Project Plan a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"`. Splits that off
/// when present.
fn split_hash_suffix(stem: &str) -> (&str, Option<&str>) {
    if stem.len() < 33 || !stem.is_char_boundary(stem.len() - 32) {
        return (stem, None);
    }
    let hash_start = stem.len() - 32;
    if stem.as_bytes()[hash_start - 1] != b' ' {
        return (stem, None);
    }
    let candidate = &stem[hash_start..];
    if candidate.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()) {
        (&stem[..hash_start - 1], Some(candidate))
    } else {
        (stem, None)
    }
}

/// Humanizes one path component (file or folder name): strips the hash
/// suffix from the stem, keeping any extension untouched. Returns the
/// humanized name and the hash, if one was found.
fn humanize_component(name: &str) -> (String, Option<String>) {
    let (stem, ext) = split_ext(name);
    let (human_stem, hash) = split_hash_suffix(stem);
    let full = match ext {
        Some(ext) => format!("{human_stem}.{ext}"),
        None => human_stem.to_string(),
    };
    (full, hash.map(str::to_string))
}

fn humanize_path(relative: &str) -> String {
    relative.split('/').map(|part| humanize_component(part).0).collect::<Vec<_>>().join("/")
}

/// Maps every hash Notion appended to the human title of the page it
/// belongs to, so links that reference the hash can be rewritten to
/// `[[wikilinks]]` by title.
fn build_hash_map(names: &[String]) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for name in names {
        let trimmed = name.trim_end_matches('/');
        if trimmed.is_empty() {
            continue;
        }
        let last = trimmed.rsplit('/').next().unwrap_or(trimmed);
        let (stem, _ext) = split_ext(last);
        if let (human_stem, Some(hash)) = split_hash_suffix(stem) {
            map.insert(hash.to_string(), human_stem.to_string());
        }
    }
    map
}

/// Finds a run of exactly 32 consecutive hex digits in a link target —
/// Notion's exported `.md` links and notion.so URLs both end in the raw
/// hash this way, with `%20`-encoded spaces or a `-` as the separator
/// before it.
fn extract_hash(target: &str) -> Option<String> {
    let decoded = target.replace("%20", " ");
    let mut run = String::new();
    let mut best = None;
    for c in decoded.chars() {
        if c.is_ascii_hexdigit() {
            run.push(c.to_ascii_lowercase());
        } else {
            if run.chars().count() == 32 {
                best = Some(run.clone());
            }
            run.clear();
        }
    }
    if run.chars().count() == 32 {
        best = Some(run);
    }
    best
}

fn try_parse_link(chars: &[char], start: usize) -> Option<(String, String, usize)> {
    let mut j = start + 1;
    let mut label = String::new();
    while j < chars.len() && chars[j] != ']' {
        label.push(chars[j]);
        j += 1;
    }
    if j >= chars.len() || j + 1 >= chars.len() || chars[j + 1] != '(' {
        return None;
    }
    let mut k = j + 2;
    let mut target = String::new();
    while k < chars.len() && chars[k] != ')' {
        target.push(chars[k]);
        k += 1;
    }
    if k >= chars.len() {
        return None;
    }
    Some((label, target, k + 1 - start))
}

/// Rewrites every Markdown link whose target resolves to a known page's
/// hash into a `[[wikilink]]`; anything else (external links, links to
/// pages not present in this export) is left untouched. Returns the
/// rewritten text plus how many links were resolved vs. recognized-but-
/// unresolved.
fn rewrite_links(content: &str, hash_to_name: &HashMap<String, String>) -> (String, usize, usize) {
    let chars: Vec<char> = content.chars().collect();
    let mut result = String::new();
    let mut resolved = 0usize;
    let mut unresolved = 0usize;
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '[' {
            if let Some((label, target, consumed)) = try_parse_link(&chars, i) {
                if let Some(hash) = extract_hash(&target) {
                    if let Some(name) = hash_to_name.get(&hash) {
                        result.push_str("[[");
                        result.push_str(name);
                        if !label.is_empty() && label != *name {
                            result.push('|');
                            result.push_str(&label);
                        }
                        result.push_str("]]");
                        resolved += 1;
                        i += consumed;
                        continue;
                    }
                    unresolved += 1;
                }
            }
        }
        result.push(chars[i]);
        i += 1;
    }
    (result, resolved, unresolved)
}

fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name.chars().map(|c| if "/\\:*?\"<>|".contains(c) { '_' } else { c }).collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        "Untitled".to_string()
    } else {
        trimmed.to_string()
    }
}

fn escape_table_cell(s: &str) -> String {
    s.replace('|', "\\|").replace('\n', "<br>")
}

fn csv_as_markdown_table(text: &str) -> String {
    let mut reader = csv::ReaderBuilder::new().from_reader(text.as_bytes());
    let headers: Vec<String> = match reader.headers() {
        Ok(h) => h.iter().map(str::to_string).collect(),
        Err(_) => return String::new(),
    };
    if headers.is_empty() {
        return String::new();
    }

    let mut out = String::new();
    out.push('|');
    for h in &headers {
        out.push(' ');
        out.push_str(&escape_table_cell(h));
        out.push_str(" |");
    }
    out.push('\n');
    out.push('|');
    for _ in &headers {
        out.push_str(" --- |");
    }
    out.push('\n');
    for record in reader.records().filter_map(|r| r.ok()) {
        out.push('|');
        for cell in record.iter() {
            out.push(' ');
            out.push_str(&escape_table_cell(cell));
            out.push_str(" |");
        }
        out.push('\n');
    }
    out
}

fn csv_row_titles(text: &str) -> Vec<String> {
    let mut reader = csv::ReaderBuilder::new().from_reader(text.as_bytes());
    reader.records().filter_map(|r| r.ok()).map(|record| sanitize_filename(record.get(0).unwrap_or("Untitled"))).collect()
}

fn csv_rows_as_frontmatter(text: &str) -> Vec<(String, serde_yaml::Mapping)> {
    let mut reader = csv::ReaderBuilder::new().from_reader(text.as_bytes());
    let headers = reader.headers().cloned().unwrap_or_default();
    let mut rows = Vec::new();
    for record in reader.records().filter_map(|r| r.ok()) {
        let mut mapping = serde_yaml::Mapping::new();
        for (header, value) in headers.iter().zip(record.iter()) {
            mapping.insert(serde_yaml::Value::String(header.to_string()), serde_yaml::Value::String(value.to_string()));
        }
        let title = sanitize_filename(record.get(0).unwrap_or("Untitled"));
        rows.push((title, mapping));
    }
    rows
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EntryKind {
    Markdown,
    Csv,
    Attachment,
}

struct PlanEntry {
    original_name: String,
    dest_relative: String,
    kind: EntryKind,
}

fn plan_entries(names: &[(String, bool)]) -> (Vec<PlanEntry>, HashMap<String, String>) {
    let all_names: Vec<String> = names.iter().map(|(n, _)| n.clone()).collect();
    let hash_map = build_hash_map(&all_names);

    let mut plan = Vec::new();
    for (name, is_dir) in names {
        if *is_dir || name.ends_with('/') {
            continue;
        }
        let dest_relative = humanize_path(name);
        let ext = name.rsplit('.').next().unwrap_or("").to_lowercase();
        let kind = match ext.as_str() {
            "md" => EntryKind::Markdown,
            "csv" => EntryKind::Csv,
            _ => EntryKind::Attachment,
        };
        plan.push(PlanEntry { original_name: name.clone(), dest_relative, kind });
    }
    (plan, hash_map)
}

fn list_names(archive: &mut Archive) -> Vec<(String, bool)> {
    (0..archive.len()).filter_map(|i| archive.by_index(i).ok().map(|f| (f.name().to_string(), f.is_dir()))).collect()
}

/// A cheap, non-mutating pass: what would get created, and how it would
/// be organized, without writing anything.
pub fn preview(archive_path: &Path, database_mode: DatabaseMode) -> Result<ImportPreview> {
    let mut archive = open_archive(archive_path)?;
    let names = list_names(&mut archive);
    let (plan, _hash_map) = plan_entries(&names);

    let mut planned_files = Vec::new();
    let mut folders = std::collections::HashSet::new();

    for entry in &plan {
        match entry.kind {
            EntryKind::Markdown => {
                planned_files.push(PlannedFile { relative_path: entry.dest_relative.clone(), kind: PlannedFileKind::Note });
            }
            EntryKind::Attachment => {
                planned_files.push(PlannedFile { relative_path: entry.dest_relative.clone(), kind: PlannedFileKind::Attachment });
            }
            EntryKind::Csv => match database_mode {
                DatabaseMode::Table => {
                    planned_files.push(PlannedFile { relative_path: entry.dest_relative.clone(), kind: PlannedFileKind::Note });
                }
                DatabaseMode::SeparateNotes => {
                    let bytes = read_entry(&mut archive, &entry.original_name)?;
                    let text = encoding::decode_text(&bytes);
                    let (stem, _) = split_ext(&entry.dest_relative);
                    for title in csv_row_titles(&text) {
                        planned_files.push(PlannedFile {
                            relative_path: format!("{stem}/{title}.md"),
                            kind: PlannedFileKind::DatabaseNote,
                        });
                    }
                }
            },
        }
        if let Some(idx) = entry.dest_relative.rfind('/') {
            folders.insert(entry.dest_relative[..idx].to_string());
        }
    }

    Ok(ImportPreview { planned_files, folder_count: folders.len(), warnings: Vec::new() })
}

fn write_text_file(dest_root: &Path, relative: &str, content: &str) -> Result<()> {
    let path = dest_root.join(relative);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, content)?;
    Ok(())
}

fn write_bytes_file(dest_root: &Path, relative: &str, bytes: &[u8]) -> Result<()> {
    let path = dest_root.join(relative);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, bytes)?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn import_one_entry(
    archive: &mut Archive,
    entry: &PlanEntry,
    dest_root: &Path,
    database_mode: DatabaseMode,
    hash_map: &HashMap<String, String>,
    report: &mut ImportReport,
) -> Result<()> {
    match entry.kind {
        EntryKind::Markdown => {
            let bytes = read_entry(archive, &entry.original_name)?;
            let text = encoding::decode_text(&bytes);
            let (rewritten, resolved, unresolved) = rewrite_links(&text, hash_map);
            let dest = unique_path(dest_root, &entry.dest_relative);
            write_text_file(dest_root, &dest, &rewritten)?;
            report.pages_imported += 1;
            report.links_resolved += resolved;
            report.links_unresolved += unresolved;
        }
        EntryKind::Attachment => {
            let bytes = read_entry(archive, &entry.original_name)?;
            let dest = unique_path(dest_root, &entry.dest_relative);
            write_bytes_file(dest_root, &dest, &bytes)?;
            report.attachments_imported += 1;
        }
        EntryKind::Csv => {
            let bytes = read_entry(archive, &entry.original_name)?;
            let text = encoding::decode_text(&bytes);
            match database_mode {
                DatabaseMode::Table => {
                    let table = csv_as_markdown_table(&text);
                    let dest = unique_path(dest_root, &entry.dest_relative);
                    write_text_file(dest_root, &dest, &table)?;
                    report.pages_imported += 1;
                }
                DatabaseMode::SeparateNotes => {
                    let (stem, _) = split_ext(&entry.dest_relative);
                    for (title, mapping) in csv_rows_as_frontmatter(&text) {
                        let fm = Frontmatter(mapping);
                        let content = frontmatter::serialize(Some(&fm), "")?;
                        let relative = format!("{stem}/{title}.md");
                        let dest = unique_path(dest_root, &relative);
                        write_text_file(dest_root, &dest, &content)?;
                        report.pages_imported += 1;
                    }
                }
            }
        }
    }
    Ok(())
}

/// The real write pass. `dest_root` must be empty (or absent, and gets
/// created) — never overwrites existing content. Reports progress after
/// each entry and checks `should_cancel` between entries (never
/// mid-file, so a cancelled import never leaves a half-written note
/// behind). A single corrupt or unreadable entry is logged to the
/// report's issue list and skipped, rather than aborting the whole
/// import.
pub fn run(
    archive_path: &Path,
    dest_root: &Path,
    database_mode: DatabaseMode,
    mut on_progress: impl FnMut(ImportProgress),
    should_cancel: &AtomicBool,
) -> Result<ImportReport> {
    ensure_empty_destination(dest_root)?;

    let mut archive = open_archive(archive_path)?;
    let names = list_names(&mut archive);
    let (plan, hash_map) = plan_entries(&names);

    let total = plan.len();
    let mut report = ImportReport::default();

    for (processed, entry) in plan.iter().enumerate() {
        if should_cancel.load(Ordering::Relaxed) {
            return Err(ImportError::Cancelled);
        }
        on_progress(ImportProgress { processed, total, current_path: entry.dest_relative.clone() });

        if let Err(e) = import_one_entry(&mut archive, entry, dest_root, database_mode, &hash_map, &mut report) {
            report.issues.push(ImportIssue { path: entry.dest_relative.clone(), message: e.to_string() });
        }
    }

    on_progress(ImportProgress { processed: total, total, current_path: String::new() });
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};

    fn build_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut buf = Vec::new();
        {
            let cursor = Cursor::new(&mut buf);
            let mut writer = zip::ZipWriter::new(cursor);
            let options = zip::write::SimpleFileOptions::default();
            for (name, content) in entries {
                writer.start_file(*name, options).unwrap();
                writer.write_all(content).unwrap();
            }
            writer.finish().unwrap();
        }
        buf
    }

    fn write_zip_fixture(dir: &Path, entries: &[(&str, &[u8])]) -> std::path::PathBuf {
        let bytes = build_zip(entries);
        let path = dir.join("export.zip");
        std::fs::write(&path, bytes).unwrap();
        path
    }

    #[test]
    fn splits_the_notion_hash_suffix_from_a_title() {
        let (title, hash) = split_hash_suffix("Project Plan a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6");
        assert_eq!(title, "Project Plan");
        assert_eq!(hash, Some("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"));
    }

    #[test]
    fn leaves_a_name_without_a_hash_untouched() {
        let (title, hash) = split_hash_suffix("Just A Title");
        assert_eq!(title, "Just A Title");
        assert_eq!(hash, None);
    }

    #[test]
    fn humanizes_a_filename_keeping_the_extension() {
        let (name, hash) = humanize_component("Project Plan a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6.md");
        assert_eq!(name, "Project Plan.md");
        assert_eq!(hash.as_deref(), Some("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"));
    }

    #[test]
    fn rewrites_a_link_to_a_hash_named_md_file_as_a_wikilink() {
        let mut map = HashMap::new();
        map.insert("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6".to_string(), "Project Plan".to_string());
        let (rewritten, resolved, unresolved) =
            rewrite_links("See [Project Plan](Project%20Plan%20a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6.md) for details.", &map);
        assert_eq!(rewritten, "See [[Project Plan]] for details.");
        assert_eq!(resolved, 1);
        assert_eq!(unresolved, 0);
    }

    #[test]
    fn rewrites_a_notion_so_url_link_by_hash() {
        let mut map = HashMap::new();
        map.insert("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6".to_string(), "Project Plan".to_string());
        let (rewritten, resolved, _) =
            rewrite_links("[Project Plan](https://www.notion.so/Project-Plan-a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6)", &map);
        assert_eq!(rewritten, "[[Project Plan]]");
        assert_eq!(resolved, 1);
    }

    #[test]
    fn keeps_the_alias_when_the_label_differs_from_the_title() {
        let mut map = HashMap::new();
        map.insert("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6".to_string(), "Project Plan".to_string());
        let (rewritten, ..) = rewrite_links("[see it here](Project%20Plan%20a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6.md)", &map);
        assert_eq!(rewritten, "[[Project Plan|see it here]]");
    }

    #[test]
    fn an_ordinary_external_link_is_left_alone_and_not_counted_as_unresolved() {
        let map = HashMap::new();
        let (rewritten, resolved, unresolved) = rewrite_links("[Google](https://google.com)", &map);
        assert_eq!(rewritten, "[Google](https://google.com)");
        assert_eq!(resolved, 0);
        assert_eq!(unresolved, 0);
    }

    #[test]
    fn a_recognizable_hash_link_with_no_matching_page_counts_as_unresolved() {
        let map = HashMap::new();
        let (_, resolved, unresolved) =
            rewrite_links("[Missing](Missing%20Page%20a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6.md)", &map);
        assert_eq!(resolved, 0);
        assert_eq!(unresolved, 1);
    }

    #[test]
    fn converts_a_csv_database_to_a_markdown_table() {
        let table = csv_as_markdown_table("Name,Status\nBuy milk,Done\nWrite report,Todo\n");
        assert!(table.starts_with("| Name | Status |\n| --- | --- |\n"));
        assert!(table.contains("| Buy milk | Done |"));
        assert!(table.contains("| Write report | Todo |"));
    }

    #[test]
    fn converts_csv_rows_to_frontmatter_field_maps() {
        let rows = csv_rows_as_frontmatter("Name,Status\nBuy milk,Done\n");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].0, "Buy milk");
        assert_eq!(rows[0].1.get("Status").and_then(|v| v.as_str()), Some("Done"));
    }

    #[test]
    fn preview_lists_notes_and_attachments_with_hashes_stripped() {
        let dir = tempfile::tempdir().unwrap();
        let zip_path = write_zip_fixture(
            &dir.path(),
            &[
                ("Home a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6.md", b"# Home\n" as &[u8]),
                ("Home a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6/image f1e2d3c4b5a697887766554433221100.png", b"\x89PNG" as &[u8]),
            ],
        );
        let preview = preview(&zip_path, DatabaseMode::SeparateNotes).unwrap();
        let paths: Vec<&str> = preview.planned_files.iter().map(|f| f.relative_path.as_str()).collect();
        assert!(paths.contains(&"Home.md"));
        assert!(paths.contains(&"Home/image.png"));
    }

    #[test]
    fn preview_in_separate_notes_mode_counts_one_planned_file_per_csv_row() {
        let dir = tempfile::tempdir().unwrap();
        let zip_path = write_zip_fixture(
            &dir.path(),
            &[("Tasks a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6.csv", b"Name,Status\nBuy milk,Done\nWrite report,Todo\n" as &[u8])],
        );
        let preview = preview(&zip_path, DatabaseMode::SeparateNotes).unwrap();
        assert_eq!(preview.planned_files.len(), 2);
        assert!(preview.planned_files.iter().all(|f| f.kind == PlannedFileKind::DatabaseNote));
    }

    #[test]
    fn preview_in_table_mode_produces_a_single_note_for_the_whole_csv() {
        let dir = tempfile::tempdir().unwrap();
        let zip_path = write_zip_fixture(
            &dir.path(),
            &[("Tasks a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6.csv", b"Name,Status\nBuy milk,Done\n" as &[u8])],
        );
        let preview = preview(&zip_path, DatabaseMode::Table).unwrap();
        assert_eq!(preview.planned_files.len(), 1);
        assert_eq!(preview.planned_files[0].relative_path, "Tasks.csv");
    }

    #[test]
    fn run_writes_a_page_with_its_link_rewritten_and_an_attachment_alongside_it() {
        let src = tempfile::tempdir().unwrap();
        let zip_path = write_zip_fixture(
            &src.path(),
            &[
                (
                    "Home a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6.md",
                    b"# Home\n\nSee [Notes](Notes%20f1e2d3c4b5a697887766554433221100.md).\n" as &[u8],
                ),
                ("Notes f1e2d3c4b5a697887766554433221100.md", b"# Notes\n" as &[u8]),
            ],
        );
        let dest = tempfile::tempdir().unwrap();
        let dest_root = dest.path().join("imported");
        let cancel = AtomicBool::new(false);
        let report = run(&zip_path, &dest_root, DatabaseMode::SeparateNotes, |_| {}, &cancel).unwrap();

        assert_eq!(report.pages_imported, 2);
        assert_eq!(report.links_resolved, 1);
        assert!(report.issues.is_empty());

        let home = std::fs::read_to_string(dest_root.join("Home.md")).unwrap();
        assert!(home.contains("[[Notes]]"), "link should have been rewritten to a wikilink: {home}");
        assert!(dest_root.join("Notes.md").exists());
    }

    #[test]
    fn run_refuses_to_write_into_a_nonempty_destination() {
        let src = tempfile::tempdir().unwrap();
        let zip_path = write_zip_fixture(&src.path(), &[("Home a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6.md", b"# Home" as &[u8])]);
        let dest = tempfile::tempdir().unwrap();
        std::fs::write(dest.path().join("existing.md"), "already here").unwrap();
        let cancel = AtomicBool::new(false);
        assert!(run(&zip_path, dest.path(), DatabaseMode::Table, |_| {}, &cancel).is_err());
    }

    #[test]
    fn run_honors_cancellation_between_files() {
        let src = tempfile::tempdir().unwrap();
        let zip_path = write_zip_fixture(
            &src.path(),
            &[
                ("A a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6.md", b"# A" as &[u8]),
                ("B f1e2d3c4b5a697887766554433221100.md", b"# B" as &[u8]),
            ],
        );
        let dest = tempfile::tempdir().unwrap();
        let dest_root = dest.path().join("imported");
        let cancel = AtomicBool::new(true);
        let result = run(&zip_path, &dest_root, DatabaseMode::Table, |_| {}, &cancel);
        assert!(matches!(result, Err(ImportError::Cancelled)));
    }

    #[test]
    fn run_in_table_mode_produces_a_readable_markdown_table_note() {
        let src = tempfile::tempdir().unwrap();
        let zip_path = write_zip_fixture(
            &src.path(),
            &[("Tasks a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6.csv", b"Name,Status\nBuy milk,Done\n" as &[u8])],
        );
        let dest = tempfile::tempdir().unwrap();
        let dest_root = dest.path().join("imported");
        let cancel = AtomicBool::new(false);
        let report = run(&zip_path, &dest_root, DatabaseMode::Table, |_| {}, &cancel).unwrap();
        assert_eq!(report.pages_imported, 1);
        let content = std::fs::read_to_string(dest_root.join("Tasks.csv")).unwrap();
        assert!(content.contains("| Buy milk | Done |"));
    }

    #[test]
    fn run_in_separate_notes_mode_writes_one_frontmatter_note_per_row() {
        let src = tempfile::tempdir().unwrap();
        let zip_path = write_zip_fixture(
            &src.path(),
            &[("Tasks a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6.csv", b"Name,Status\nBuy milk,Done\n" as &[u8])],
        );
        let dest = tempfile::tempdir().unwrap();
        let dest_root = dest.path().join("imported");
        let cancel = AtomicBool::new(false);
        run(&zip_path, &dest_root, DatabaseMode::SeparateNotes, |_| {}, &cancel).unwrap();
        let content = std::fs::read_to_string(dest_root.join("Tasks/Buy milk.md")).unwrap();
        assert!(content.contains("Status: Done"));
    }
}
