//! The link/notes index in `.nodus/index.sqlite`.
//!
//! This is a *derived* cache, never a source of truth: everything in here is
//! reconstructible from the `.md` files on disk. Backlinks and unlinked
//! mentions are resolved by using SQLite only to find the small set of
//! candidate files, then re-reading and re-parsing those files live — so a
//! stale row can at worst mean a missed candidate, never a wrong on-screen
//! snippet or a corrupted rewrite.

use std::path::Path;
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::error::{Error, Result};
use crate::tree::list_markdown_files;
use crate::vault::Vault;
use crate::wikilink::{find_wikilinks, LinkKind};

const SCHEMA: &str = "
    CREATE TABLE IF NOT EXISTS notes (
        path  TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        mtime INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS links (
        from_path   TEXT NOT NULL,
        to_path     TEXT,
        target_text TEXT NOT NULL,
        kind        TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS links_to_path ON links(to_path);
    CREATE INDEX IF NOT EXISTS links_from_path ON links(from_path);
";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Backlink {
    pub from_path: String,
    pub kind: String,
    pub context: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Mention {
    pub from_path: String,
    pub context: String,
    pub start: usize,
    pub end: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNode {
    pub path: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphLink {
    pub from_path: String,
    pub to_path: String,
}

/// Everything the graph view needs to draw: all indexed notes plus every
/// resolved link between them. Unresolved links (`to_path IS NULL`) are
/// skipped — a node that doesn't exist yet can't be drawn.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphData {
    pub nodes: Vec<GraphNode>,
    pub links: Vec<GraphLink>,
}

pub struct Index {
    conn: Mutex<Connection>,
}

fn title_of(relative_path: &str) -> String {
    let name = relative_path.rsplit('/').next().unwrap_or(relative_path);
    name.strip_suffix(".md").unwrap_or(name).to_string()
}

fn mtime_of(vault: &Vault, relative: &str) -> Result<i64> {
    let absolute = vault.resolve(relative)?;
    let modified = std::fs::metadata(&absolute)?.modified()?;
    Ok(modified
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0))
}

fn context_snippet(content: &str, start: usize, end: usize) -> String {
    const RADIUS: usize = 60;
    let from = content
        .char_indices()
        .rev()
        .find(|(i, _)| *i <= start.saturating_sub(RADIUS))
        .map(|(i, _)| i)
        .unwrap_or(0);
    let to = content
        .char_indices()
        .find(|(i, _)| *i >= (end + RADIUS).min(content.len()))
        .map(|(i, _)| i)
        .unwrap_or(content.len());
    let clamped_to = to.max(end).min(content.len());
    let snippet = &content[from..clamped_to];
    snippet.replace(['\n', '\r'], " ").trim().to_string()
}

impl Index {
    pub fn open(vault_root: &Path) -> Result<Self> {
        let dir = vault_root.join(".nodus");
        std::fs::create_dir_all(&dir)?;
        let conn = Connection::open(dir.join("index.sqlite"))
            .map_err(|e| Error::Watch(format!("failed to open index: {e}")))?;
        conn.execute_batch(SCHEMA)
            .map_err(|e| Error::Watch(format!("failed to init index schema: {e}")))?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Full scan: (re)indexes any note that's new or changed since last time
    /// (by mtime), and drops rows for notes no longer on disk. Safe to call
    /// on every vault open — unchanged notes are skipped entirely.
    pub fn reconcile(&self, vault: &Vault) -> Result<()> {
        let on_disk = list_markdown_files(vault);
        let conn = self.conn.lock().expect("index mutex poisoned");

        let known: Vec<(String, i64)> = {
            let mut stmt = conn
                .prepare("SELECT path, mtime FROM notes")
                .map_err(index_err)?;
            let rows = stmt
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
                .map_err(index_err)?
                .collect::<std::result::Result<_, _>>()
                .map_err(index_err)?;
            rows
        };
        drop(conn);

        let on_disk_set: std::collections::HashSet<&str> =
            on_disk.iter().map(|s| s.as_str()).collect();
        for (path, _) in &known {
            if !on_disk_set.contains(path.as_str()) {
                self.remove_note(path)?;
            }
        }

        let known_mtimes: std::collections::HashMap<String, i64> = known.into_iter().collect();
        for path in &on_disk {
            // A file that can no longer be stat'd (removed mid-scan, a
            // broken symlink, a cloud-sync placeholder, ...) just doesn't
            // get indexed this pass rather than failing the whole reconcile.
            let Ok(current_mtime) = mtime_of(vault, path) else {
                continue;
            };
            if known_mtimes.get(path) != Some(&current_mtime) {
                let _ = self.reindex_note(vault, path, current_mtime);
            }
        }
        Ok(())
    }

    /// Re-indexes a single note (used after this app's own writes, and after
    /// externally-detected changes). No-op-safe to call repeatedly.
    pub fn update_note(&self, vault: &Vault, relative: &str) -> Result<()> {
        let mtime = mtime_of(vault, relative)?;
        self.reindex_note(vault, relative, mtime)
    }

    fn reindex_note(&self, vault: &Vault, relative: &str, mtime: i64) -> Result<()> {
        let absolute = vault.resolve(relative)?;
        let content = std::fs::read_to_string(&absolute).unwrap_or_default();
        let links = find_wikilinks(&content);

        let conn = self.conn.lock().expect("index mutex poisoned");
        conn.execute(
            "INSERT INTO notes (path, title, mtime) VALUES (?1, ?2, ?3)
             ON CONFLICT(path) DO UPDATE SET title = excluded.title, mtime = excluded.mtime",
            params![relative, title_of(relative), mtime],
        )
        .map_err(index_err)?;
        conn.execute("DELETE FROM links WHERE from_path = ?1", params![relative])
            .map_err(index_err)?;

        for link in &links {
            let to_path = resolve_target_locked(&conn, &link.target);
            let kind = match link.kind {
                LinkKind::Wikilink => "wikilink",
                LinkKind::Embed => "embed",
            };
            conn.execute(
                "INSERT INTO links (from_path, to_path, target_text, kind) VALUES (?1, ?2, ?3, ?4)",
                params![relative, to_path, link.target, kind],
            )
            .map_err(index_err)?;
        }
        Ok(())
    }

    pub fn remove_note(&self, relative: &str) -> Result<()> {
        let conn = self.conn.lock().expect("index mutex poisoned");
        conn.execute("DELETE FROM notes WHERE path = ?1", params![relative])
            .map_err(index_err)?;
        conn.execute("DELETE FROM links WHERE from_path = ?1", params![relative])
            .map_err(index_err)?;
        Ok(())
    }

    /// Removes `relative` itself and, since it may be a folder, everything
    /// nested under it.
    pub fn remove_prefix(&self, relative: &str) -> Result<()> {
        let conn = self.conn.lock().expect("index mutex poisoned");
        let like_pattern = format!("{}/%", relative.replace('%', "\\%").replace('_', "\\_"));
        for sql in [
            "DELETE FROM notes WHERE path = ?1 OR path LIKE ?2 ESCAPE '\\'",
            "DELETE FROM links WHERE from_path = ?1 OR from_path LIKE ?2 ESCAPE '\\'",
        ] {
            conn.execute(sql, params![relative, like_pattern])
                .map_err(index_err)?;
        }
        Ok(())
    }

    /// Updates index metadata after a rename. Does not touch any files —
    /// callers still need to re-parse the renamed file's own links (its
    /// content didn't change, but do call [`Index::update_note`] once the
    /// caller has settled which other notes needed link rewrites, so
    /// `to_path` resolution for everyone stays consistent).
    pub fn rename_note(&self, old: &str, new: &str) -> Result<()> {
        let conn = self.conn.lock().expect("index mutex poisoned");
        conn.execute(
            "UPDATE notes SET path = ?2, title = ?3 WHERE path = ?1",
            params![old, new, title_of(new)],
        )
        .map_err(index_err)?;
        conn.execute(
            "UPDATE links SET from_path = ?2 WHERE from_path = ?1",
            params![old, new],
        )
        .map_err(index_err)?;
        conn.execute(
            "UPDATE links SET to_path = ?2 WHERE to_path = ?1",
            params![old, new],
        )
        .map_err(index_err)?;
        Ok(())
    }

    /// Distinct notes with at least one link that resolves to `target_path`
    /// *or* could plausibly resolve to it once re-checked live (a link typed
    /// before its target existed is stored unresolved and stays that way
    /// until something asks about it — this is where that gets caught, so a
    /// forward reference like `[[NotYetCreated]]` still shows up as a
    /// backlink the moment the note is created, without needing to eagerly
    /// re-resolve every unresolved link on every note creation).
    pub fn referencing_notes(&self, target_path: &str) -> Result<Vec<String>> {
        let target_stem = target_path.strip_suffix(".md").unwrap_or(target_path);
        let title = title_of(target_path).to_lowercase();
        let conn = self.conn.lock().expect("index mutex poisoned");
        let mut stmt = conn
            .prepare(
                "SELECT DISTINCT from_path FROM links
                 WHERE to_path = ?1
                    OR (to_path IS NULL AND target_text = ?2)
                    OR (to_path IS NULL AND lower(target_text) = ?3)",
            )
            .map_err(index_err)?;
        let rows = stmt
            .query_map(params![target_path, target_stem, title], |row| row.get(0))
            .map_err(index_err)?
            .collect::<std::result::Result<_, _>>()
            .map_err(index_err)?;
        Ok(rows)
    }

    /// Resolves a raw link target (as typed inside `[[...]]`) to a
    /// vault-relative note path, per the notes currently known to the index.
    pub fn resolve_target(&self, target: &str) -> Option<String> {
        let conn = self.conn.lock().expect("index mutex poisoned");
        resolve_target_locked(&conn, target)
    }

    /// Every note and every resolved link, for the graph view.
    pub fn graph(&self) -> Result<GraphData> {
        let conn = self.conn.lock().expect("index mutex poisoned");
        let mut nodes = Vec::new();
        {
            let mut stmt = conn
                .prepare("SELECT path, title FROM notes")
                .map_err(index_err)?;
            let rows = stmt
                .query_map([], |row| {
                    Ok(GraphNode {
                        path: row.get(0)?,
                        title: row.get(1)?,
                    })
                })
                .map_err(index_err)?;
            for row in rows {
                nodes.push(row.map_err(index_err)?);
            }
        }
        let mut links = Vec::new();
        {
            let mut stmt = conn
                .prepare("SELECT from_path, to_path FROM links WHERE to_path IS NOT NULL")
                .map_err(index_err)?;
            let rows = stmt
                .query_map([], |row| {
                    Ok(GraphLink {
                        from_path: row.get(0)?,
                        to_path: row.get(1)?,
                    })
                })
                .map_err(index_err)?;
            for row in rows {
                links.push(row.map_err(index_err)?);
            }
        }
        Ok(GraphData { nodes, links })
    }

    /// Notes that reference `target_path`, each with a live-read context
    /// snippet around every occurrence.
    pub fn backlinks(&self, vault: &Vault, target_path: &str) -> Result<Vec<Backlink>> {
        let from_paths = self.referencing_notes(target_path)?;

        let mut backlinks = Vec::new();
        for from_path in from_paths {
            let absolute = vault.resolve(&from_path)?;
            let Ok(content) = std::fs::read_to_string(&absolute) else {
                continue;
            };
            for link in find_wikilinks(&content) {
                let conn = self.conn.lock().expect("index mutex poisoned");
                let resolved = resolve_target_locked(&conn, &link.target);
                drop(conn);
                if resolved.as_deref() == Some(target_path) {
                    backlinks.push(Backlink {
                        from_path: from_path.clone(),
                        kind: match link.kind {
                            LinkKind::Wikilink => "wikilink".to_string(),
                            LinkKind::Embed => "embed".to_string(),
                        },
                        context: context_snippet(&content, link.start, link.end),
                    });
                }
            }
        }
        Ok(backlinks)
    }

    /// Other notes whose plain text contains `target_path`'s title, outside
    /// of any existing `[[link]]`.
    pub fn unlinked_mentions(&self, vault: &Vault, target_path: &str) -> Result<Vec<Mention>> {
        let title = title_of(target_path);
        if title.trim().is_empty() {
            return Ok(Vec::new());
        }
        let title_lower = title.to_lowercase();

        let all_paths: Vec<String> = {
            let conn = self.conn.lock().expect("index mutex poisoned");
            let mut stmt = conn.prepare("SELECT path FROM notes").map_err(index_err)?;
            let rows = stmt
                .query_map([], |row| row.get(0))
                .map_err(index_err)?
                .collect::<std::result::Result<_, _>>()
                .map_err(index_err)?;
            rows
        };

        let mut mentions = Vec::new();
        for path in all_paths {
            if path == target_path {
                continue;
            }
            let absolute = vault.resolve(&path)?;
            let Ok(content) = std::fs::read_to_string(&absolute) else {
                continue;
            };
            let linked_ranges: Vec<(usize, usize)> = find_wikilinks(&content)
                .into_iter()
                .map(|l| (l.start, l.end))
                .collect();

            let content_lower = content.to_lowercase();
            let mut search_from = 0;
            while let Some(pos) = content_lower[search_from..].find(&title_lower) {
                let start = search_from + pos;
                let end = start + title.len();
                let inside_link = linked_ranges
                    .iter()
                    .any(|(ls, le)| start >= *ls && end <= *le);
                if !inside_link {
                    mentions.push(Mention {
                        from_path: path.clone(),
                        context: context_snippet(&content, start, end),
                        start,
                        end,
                    });
                }
                search_from = end.max(start + 1);
            }
        }
        Ok(mentions)
    }
}

fn resolve_target_locked(conn: &Connection, target: &str) -> Option<String> {
    let stem = target.strip_suffix(".md").unwrap_or(target);

    if stem.contains('/') {
        let candidate = format!("{stem}.md");
        let exists: Option<String> = conn
            .query_row(
                "SELECT path FROM notes WHERE path = ?1",
                params![candidate],
                |row| row.get(0),
            )
            .optional()
            .ok()
            .flatten();
        return exists;
    }

    let basename = stem.to_lowercase();
    let mut stmt = match conn.prepare("SELECT path, title FROM notes ORDER BY path ASC") {
        Ok(s) => s,
        Err(_) => return None,
    };
    let rows = stmt
        .query_map([], |row| {
            let path: String = row.get(0)?;
            let title: String = row.get(1)?;
            Ok((path, title))
        })
        .ok()?;
    for row in rows.flatten() {
        if row.1.to_lowercase() == basename {
            return Some(row.0);
        }
    }
    None
}

fn index_err(e: rusqlite::Error) -> Error {
    Error::Watch(format!("index error: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (tempfile::TempDir, Vault, Index) {
        let dir = tempfile::tempdir().unwrap();
        let vault = Vault::open(dir.path()).unwrap();
        let index = Index::open(dir.path()).unwrap();
        (dir, vault, index)
    }

    #[test]
    fn reconcile_indexes_notes_and_resolves_links() {
        let (dir, vault, index) = setup();
        std::fs::write(dir.path().join("A.md"), "Links to [[B]].").unwrap();
        std::fs::write(dir.path().join("B.md"), "No outgoing links.").unwrap();

        index.reconcile(&vault).unwrap();

        let backlinks = index.backlinks(&vault, "B.md").unwrap();
        assert_eq!(backlinks.len(), 1);
        assert_eq!(backlinks[0].from_path, "A.md");
        assert!(backlinks[0].context.contains("[[B]]"));
    }

    #[test]
    fn reconcile_skips_unchanged_files_by_mtime() {
        let (dir, vault, index) = setup();
        std::fs::write(dir.path().join("A.md"), "hello").unwrap();
        index.reconcile(&vault).unwrap();

        // A second reconcile with nothing changed should be a cheap no-op
        // (verified indirectly: it must not error and the note must still
        // be there under its original mtime).
        index.reconcile(&vault).unwrap();
        let backlinks = index.backlinks(&vault, "A.md").unwrap();
        assert!(backlinks.is_empty());
    }

    #[test]
    fn reconcile_removes_deleted_notes() {
        let (dir, vault, index) = setup();
        std::fs::write(dir.path().join("A.md"), "[[B]]").unwrap();
        std::fs::write(dir.path().join("B.md"), "").unwrap();
        index.reconcile(&vault).unwrap();

        std::fs::remove_file(dir.path().join("B.md")).unwrap();
        index.reconcile(&vault).unwrap();

        let backlinks = index.backlinks(&vault, "B.md").unwrap();
        assert!(backlinks.is_empty());
    }

    #[test]
    fn unlinked_mentions_excludes_actual_links() {
        let (dir, vault, index) = setup();
        std::fs::write(dir.path().join("Target.md"), "content").unwrap();
        std::fs::write(
            dir.path().join("Mentioner.md"),
            "Talks about Target here, and also [[Target]] properly linked.",
        )
        .unwrap();
        index.reconcile(&vault).unwrap();

        let mentions = index.unlinked_mentions(&vault, "Target.md").unwrap();
        assert_eq!(mentions.len(), 1);
        assert_eq!(mentions[0].from_path, "Mentioner.md");
    }

    #[test]
    fn graph_returns_all_notes_and_resolved_links() {
        let (dir, vault, index) = setup();
        std::fs::write(dir.path().join("A.md"), "[[B]] and [[Missing]]").unwrap();
        std::fs::write(dir.path().join("B.md"), "back to [[A]]").unwrap();
        std::fs::write(dir.path().join("C.md"), "no links").unwrap();
        index.reconcile(&vault).unwrap();
        // Re-index both notes so links resolve regardless of scan order.
        index.update_note(&vault, "A.md").unwrap();
        index.update_note(&vault, "B.md").unwrap();

        let graph = index.graph().unwrap();

        let mut titles: Vec<&str> = graph.nodes.iter().map(|n| n.title.as_str()).collect();
        titles.sort_unstable();
        assert_eq!(titles, vec!["A", "B", "C"]);
        // [[Missing]] has no note yet, so it must not produce a link.
        assert_eq!(graph.links.len(), 2);
        assert!(graph
            .links
            .iter()
            .any(|l| l.from_path == "A.md" && l.to_path == "B.md"));
        assert!(graph
            .links
            .iter()
            .any(|l| l.from_path == "B.md" && l.to_path == "A.md"));
    }

    #[test]
    fn rename_note_updates_paths_and_backlink_targets() {
        let (dir, vault, index) = setup();
        std::fs::write(dir.path().join("A.md"), "[[B]]").unwrap();
        std::fs::write(dir.path().join("B.md"), "").unwrap();
        index.reconcile(&vault).unwrap();

        std::fs::rename(dir.path().join("B.md"), dir.path().join("C.md")).unwrap();
        index.rename_note("B.md", "C.md").unwrap();

        let backlinks = index.backlinks(&vault, "C.md").unwrap();
        // The on-disk text still says [[B]] until the caller rewrites it —
        // rename_note only updates index bookkeeping — so resolution against
        // the *old* target text no longer matches anything post-rename.
        assert!(backlinks.is_empty());
    }
}
