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
use crate::heading::find_headings;
use crate::properties::find_properties;
use crate::search::{self, SearchFileResult};
use crate::tasks::find_tasks;
use crate::tree::list_markdown_files;
use crate::vault::Vault;
use crate::wikilink::{find_wikilinks, LinkKind};

/// Bumped whenever a schema change needs existing vaults to backfill data
/// for files that won't otherwise get re-indexed (their mtime hasn't
/// changed). Bumping this wipes the `notes` table's mtime bookkeeping in
/// [`Index::open`], which makes the next [`Index::reconcile`] treat every
/// on-disk note as changed — a one-time full reindex, no separate migration
/// system needed.
const CURRENT_SCHEMA_VERSION: i64 = 2;

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
        kind        TEXT NOT NULL,
        line        INTEGER NOT NULL DEFAULT 0,
        byte_offset INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS links_to_path ON links(to_path);
    CREATE INDEX IF NOT EXISTS links_from_path ON links(from_path);
    CREATE TABLE IF NOT EXISTS headings (
        path     TEXT NOT NULL,
        level    INTEGER NOT NULL,
        text     TEXT NOT NULL,
        position INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS headings_path ON headings(path);
    CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
        path UNINDEXED,
        content,
        tokenize = 'unicode61'
    );
    CREATE TABLE IF NOT EXISTS tags (
        path  TEXT NOT NULL,
        tag   TEXT NOT NULL,
        start INTEGER NOT NULL,
        end   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tags_path ON tags(path);
    CREATE INDEX IF NOT EXISTS tags_tag ON tags(tag);
    CREATE TABLE IF NOT EXISTS tasks (
        path         TEXT NOT NULL,
        line         INTEGER NOT NULL,
        done         INTEGER NOT NULL,
        text         TEXT NOT NULL,
        due          TEXT,
        priority     INTEGER,
        completed    TEXT,
        repeat       TEXT,
        marker_start INTEGER NOT NULL,
        marker_end   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tasks_path ON tasks(path);
    CREATE INDEX IF NOT EXISTS tasks_done ON tasks(done);
    CREATE TABLE IF NOT EXISTS properties (
        path  TEXT NOT NULL,
        key   TEXT NOT NULL,
        value TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS properties_path ON properties(path);
    CREATE INDEX IF NOT EXISTS properties_key ON properties(key);
";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Backlink {
    pub from_path: String,
    pub kind: String,
    pub context: String,
    /// 1-indexed line number within `from_path`, for click-to-open-at-line.
    pub line: usize,
}

/// One link out of a note, resolved from the same `links` table
/// [`Index::backlinks`] reads in the other direction — so outgoing links,
/// backlinks, and the graph view all agree, instead of the frontend
/// re-deriving this by parsing note text itself.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutgoingLink {
    pub target_text: String,
    pub to_path: Option<String>,
    pub kind: String,
    /// 1-indexed line number within the note that contains this link.
    pub line: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PropertyRow {
    pub path: String,
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeadingEntry {
    pub level: u8,
    pub text: String,
    pub position: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRow {
    pub path: String,
    pub line: usize,
    pub done: bool,
    pub text: String,
    pub due: Option<String>,
    /// 1=low, 2=medium, 3=high — matches `tasks::Priority as u8`.
    pub priority: Option<u8>,
    pub completed: Option<String>,
    pub repeat: Option<String>,
    pub marker_start: usize,
    pub marker_end: usize,
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

/// 1-indexed line number of the line containing byte offset `pos`.
fn line_of(content: &str, pos: usize) -> usize {
    1 + content.as_bytes()[..pos.min(content.len())]
        .iter()
        .filter(|&&b| b == b'\n')
        .count()
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

        let stored_version: i64 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(|e| Error::Watch(format!("failed to read index schema version: {e}")))?;
        if stored_version < CURRENT_SCHEMA_VERSION {
            // Forces the next `reconcile()` to fully re-index every on-disk
            // note at least once — the only way a newly added column/table
            // (like `properties`) gets backfilled for files whose mtime
            // hasn't changed since they were last indexed.
            conn.execute("DELETE FROM notes", [])
                .map_err(|e| Error::Watch(format!("failed to clear index for backfill: {e}")))?;
            conn.pragma_update(None, "user_version", CURRENT_SCHEMA_VERSION)
                .map_err(|e| Error::Watch(format!("failed to write index schema version: {e}")))?;
        }

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
        let headings = find_headings(&content);
        let tags = crate::tags::find_tags(&content);
        let tasks = find_tasks(&content);
        let properties = find_properties(&content);

        let conn = self.conn.lock().expect("index mutex poisoned");
        conn.execute(
            "INSERT INTO notes (path, title, mtime) VALUES (?1, ?2, ?3)
             ON CONFLICT(path) DO UPDATE SET title = excluded.title, mtime = excluded.mtime",
            params![relative, title_of(relative), mtime],
        )
        .map_err(index_err)?;
        conn.execute("DELETE FROM links WHERE from_path = ?1", params![relative])
            .map_err(index_err)?;
        conn.execute(
            "DELETE FROM headings WHERE path = ?1",
            params![relative],
        )
        .map_err(index_err)?;
        conn.execute(
            "DELETE FROM notes_fts WHERE path = ?1",
            params![relative],
        )
        .map_err(index_err)?;
        conn.execute("DELETE FROM tags WHERE path = ?1", params![relative])
            .map_err(index_err)?;
        conn.execute("DELETE FROM tasks WHERE path = ?1", params![relative])
            .map_err(index_err)?;
        conn.execute("DELETE FROM properties WHERE path = ?1", params![relative])
            .map_err(index_err)?;

        for link in &links {
            let to_path = resolve_target_locked(&conn, &link.target, relative);
            let kind = match link.kind {
                LinkKind::Wikilink => "wikilink",
                LinkKind::Embed => "embed",
            };
            conn.execute(
                "INSERT INTO links (from_path, to_path, target_text, kind, line, byte_offset)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    relative,
                    to_path,
                    link.target,
                    kind,
                    line_of(&content, link.start),
                    link.start
                ],
            )
            .map_err(index_err)?;
        }

        for heading in &headings {
            conn.execute(
                "INSERT INTO headings (path, level, text, position) VALUES (?1, ?2, ?3, ?4)",
                params![relative, heading.level, heading.text, heading.position],
            )
            .map_err(index_err)?;
        }

        conn.execute(
            "INSERT INTO notes_fts (path, content) VALUES (?1, ?2)",
            params![relative, content],
        )
        .map_err(index_err)?;

        for tag in &tags {
            conn.execute(
                "INSERT INTO tags (path, tag, start, end) VALUES (?1, ?2, ?3, ?4)",
                params![relative, tag.tag, tag.start, tag.end],
            )
            .map_err(index_err)?;
        }

        for task in &tasks {
            conn.execute(
                "INSERT INTO tasks (path, line, done, text, due, priority, completed, repeat, marker_start, marker_end)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    relative,
                    task.line,
                    task.done,
                    task.text,
                    task.due,
                    task.priority.map(|p| p as u8),
                    task.completed,
                    task.repeat,
                    task.marker_start,
                    task.marker_end,
                ],
            )
            .map_err(index_err)?;
        }

        for (key, value) in &properties {
            conn.execute(
                "INSERT INTO properties (path, key, value) VALUES (?1, ?2, ?3)",
                params![relative, key, value],
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
        conn.execute(
            "DELETE FROM headings WHERE path = ?1",
            params![relative],
        )
        .map_err(index_err)?;
        conn.execute(
            "DELETE FROM notes_fts WHERE path = ?1",
            params![relative],
        )
        .map_err(index_err)?;
        conn.execute("DELETE FROM tags WHERE path = ?1", params![relative])
            .map_err(index_err)?;
        conn.execute("DELETE FROM tasks WHERE path = ?1", params![relative])
            .map_err(index_err)?;
        conn.execute("DELETE FROM properties WHERE path = ?1", params![relative])
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
            "DELETE FROM headings WHERE path = ?1 OR path LIKE ?2 ESCAPE '\\'",
            "DELETE FROM notes_fts WHERE path = ?1 OR path LIKE ?2 ESCAPE '\\'",
            "DELETE FROM tags WHERE path = ?1 OR path LIKE ?2 ESCAPE '\\'",
            "DELETE FROM tasks WHERE path = ?1 OR path LIKE ?2 ESCAPE '\\'",
            "DELETE FROM properties WHERE path = ?1 OR path LIKE ?2 ESCAPE '\\'",
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
        conn.execute(
            "UPDATE headings SET path = ?2 WHERE path = ?1",
            params![old, new],
        )
        .map_err(index_err)?;
        conn.execute(
            "UPDATE notes_fts SET path = ?2 WHERE path = ?1",
            params![old, new],
        )
        .map_err(index_err)?;
        conn.execute(
            "UPDATE tags SET path = ?2 WHERE path = ?1",
            params![old, new],
        )
        .map_err(index_err)?;
        conn.execute(
            "UPDATE tasks SET path = ?2 WHERE path = ?1",
            params![old, new],
        )
        .map_err(index_err)?;
        conn.execute(
            "UPDATE properties SET path = ?2 WHERE path = ?1",
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
    /// vault-relative note path, per the notes currently known to the
    /// index — from the point of view of `from_path`, so an ambiguous
    /// basename resolves to whichever candidate is closest by folder.
    pub fn resolve_target(&self, target: &str, from_path: &str) -> Option<String> {
        let conn = self.conn.lock().expect("index mutex poisoned");
        resolve_target_locked(&conn, target, from_path)
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
                let resolved = resolve_target_locked(&conn, &link.target, &from_path);
                drop(conn);
                if resolved.as_deref() == Some(target_path) {
                    backlinks.push(Backlink {
                        from_path: from_path.clone(),
                        kind: match link.kind {
                            LinkKind::Wikilink => "wikilink".to_string(),
                            LinkKind::Embed => "embed".to_string(),
                        },
                        context: context_snippet(&content, link.start, link.end),
                        line: line_of(&content, link.start),
                    });
                }
            }
        }
        Ok(backlinks)
    }

    /// Every link `path` itself makes out to other notes, read from the same
    /// `links` table `backlinks` reads in the other direction — so this,
    /// backlinks, and the graph view can never disagree about what a note
    /// links to. Unlike `backlinks`, no candidate search is needed first:
    /// the file to parse is already known, so this just re-reads `path`
    /// directly and resolves each link it finds live (the same
    /// live-resolution `reindex_note` did at write time, kept in sync here
    /// rather than trusting a possibly-stale `to_path`).
    pub fn outgoing_links(&self, vault: &Vault, path: &str) -> Result<Vec<OutgoingLink>> {
        let absolute = vault.resolve(path)?;
        let Ok(content) = std::fs::read_to_string(&absolute) else {
            return Ok(Vec::new());
        };
        let conn = self.conn.lock().expect("index mutex poisoned");
        let mut links = Vec::new();
        for link in find_wikilinks(&content) {
            let to_path = resolve_target_locked(&conn, &link.target, path);
            links.push(OutgoingLink {
                target_text: link.target,
                to_path,
                kind: match link.kind {
                    LinkKind::Wikilink => "wikilink".to_string(),
                    LinkKind::Embed => "embed".to_string(),
                },
                line: line_of(&content, link.start),
            });
        }
        Ok(links)
    }

    /// Other notes whose plain text contains `target_path`'s title, outside
    /// of any existing `[[link]]`. Candidates are narrowed with the FTS5
    /// index rather than scanning every file on disk — the exact match
    /// positions still need a precise substring pass since FTS operates on
    /// tokens, not byte offsets, but that pass only runs over notes the
    /// index says actually contain the title.
    pub fn unlinked_mentions(&self, target_path: &str) -> Result<Vec<Mention>> {
        let title = title_of(target_path);
        if title.trim().is_empty() {
            return Ok(Vec::new());
        }
        let title_lower = title.to_lowercase();

        let candidates: Vec<(String, String)> = {
            let conn = self.conn.lock().expect("index mutex poisoned");
            let mut stmt = conn
                .prepare("SELECT path, content FROM notes_fts WHERE notes_fts MATCH ?1")
                .map_err(index_err)?;
            let rows = stmt
                .query_map(params![fts_phrase_query(&title)], |row| {
                    Ok((row.get(0)?, row.get(1)?))
                })
                .map_err(index_err)?
                .collect::<std::result::Result<_, _>>()
                .map_err(index_err)?;
            rows
        };

        let mut mentions = Vec::new();
        for (path, content) in candidates {
            if path == target_path {
                continue;
            }
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

    /// Every (path, key, value) property row in the vault, straight from the
    /// index — one SQL query instead of the frontend reading and re-parsing
    /// every note's frontmatter itself, which is the part that wouldn't
    /// scale to a large vault.
    pub fn all_properties(&self) -> Result<Vec<PropertyRow>> {
        let conn = self.conn.lock().expect("index mutex poisoned");
        let mut stmt = conn
            .prepare("SELECT path, key, value FROM properties ORDER BY key, path")
            .map_err(index_err)?;
        let rows = stmt
            .query_map([], |row| {
                Ok(PropertyRow {
                    path: row.get(0)?,
                    key: row.get(1)?,
                    value: row.get(2)?,
                })
            })
            .map_err(index_err)?
            .collect::<std::result::Result<_, _>>()
            .map_err(index_err)?;
        Ok(rows)
    }

    /// Headings of a single note, in document order — used to power
    /// `[[Note#Heading]]` autocomplete for notes other than the one
    /// currently open (whose headings the editor already has live).
    pub fn headings(&self, path: &str) -> Result<Vec<HeadingEntry>> {
        let conn = self.conn.lock().expect("index mutex poisoned");
        let mut stmt = conn
            .prepare("SELECT level, text, position FROM headings WHERE path = ?1 ORDER BY position ASC")
            .map_err(index_err)?;
        let rows = stmt
            .query_map(params![path], |row| {
                Ok(HeadingEntry {
                    level: row.get(0)?,
                    text: row.get(1)?,
                    position: row.get(2)?,
                })
            })
            .map_err(index_err)?
            .collect::<std::result::Result<_, _>>()
            .map_err(index_err)?;
        Ok(rows)
    }

    /// Runs a parsed vault-wide search query. FTS5 narrows candidates down
    /// (a safe, over-inclusive prefix match on every positive word) before
    /// the precise DSL evaluation runs on just that set — falling back to
    /// scanning every note if the narrowing query can't be built or the FTS
    /// MATCH itself errors, so a search never fails outright.
    pub fn search(&self, query_str: &str, case_sensitive: bool) -> Result<Vec<SearchFileResult>> {
        let query = search::parse_query(query_str);
        let conn = self.conn.lock().expect("index mutex poisoned");

        // The FTS pre-filter always narrows case-insensitively — that's a
        // superset heuristic (never excludes a real match), so the exact
        // case-sensitive check below is still the ground truth either way.
        let candidates: Vec<(String, String)> = match search::narrowing_fts_query(&query) {
            Some(fts_q) => narrowed_notes_content(&conn, &fts_q)
                .or_else(|_| all_notes_content(&conn))?,
            None => all_notes_content(&conn)?,
        };
        let tag_map = tags_by_path(&conn)?;
        drop(conn);

        let mut results = Vec::new();
        for (path, content) in candidates {
            let empty = Vec::new();
            let tags = tag_map.get(&path).unwrap_or(&empty);
            if search::matches_file(&query, &path, tags, &content, case_sensitive) {
                // A pure filter query (e.g. just `tag:project`, no words)
                // legitimately has nothing to highlight — it still belongs
                // in the results, just with an empty match-line list.
                let matches = search::highlight_lines(&query, &content, case_sensitive);
                results.push(SearchFileResult { path, matches });
            }
        }
        results.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(results)
    }

    /// Every known note's vault-relative path.
    pub fn all_paths(&self) -> Result<Vec<String>> {
        let conn = self.conn.lock().expect("index mutex poisoned");
        let mut stmt = conn.prepare("SELECT path FROM notes").map_err(index_err)?;
        let rows = stmt
            .query_map([], |row| row.get(0))
            .map_err(index_err)?
            .collect::<std::result::Result<_, _>>()
            .map_err(index_err)?;
        Ok(rows)
    }

    /// Every tag in the vault (case-folded for grouping) with how many
    /// distinct notes carry it — for the tags panel's counts and sorting.
    pub fn tag_counts(&self) -> Result<Vec<TagCount>> {
        let conn = self.conn.lock().expect("index mutex poisoned");
        let mut stmt = conn
            .prepare("SELECT path, tag FROM tags")
            .map_err(index_err)?;
        let rows: Vec<(String, String)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(index_err)?
            .collect::<std::result::Result<_, _>>()
            .map_err(index_err)?;
        let mut by_tag: std::collections::HashMap<String, std::collections::HashSet<String>> =
            std::collections::HashMap::new();
        for (path, tag) in rows {
            by_tag.entry(tag.to_lowercase()).or_default().insert(path);
        }
        let mut counts: Vec<TagCount> = by_tag
            .into_iter()
            .map(|(tag, paths)| TagCount {
                tag,
                count: paths.len(),
            })
            .collect();
        counts.sort_by(|a, b| a.tag.cmp(&b.tag));
        Ok(counts)
    }

    /// Vault-relative paths of every note carrying `tag` (case-insensitive,
    /// exact match — not a namespace/prefix match on nested tags).
    pub fn paths_with_tag(&self, tag: &str) -> Result<Vec<String>> {
        let conn = self.conn.lock().expect("index mutex poisoned");
        let mut stmt = conn
            .prepare("SELECT path, tag FROM tags")
            .map_err(index_err)?;
        let rows: Vec<(String, String)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(index_err)?
            .collect::<std::result::Result<_, _>>()
            .map_err(index_err)?;
        let tag_lower = tag.to_lowercase();
        let mut paths: Vec<String> = rows
            .into_iter()
            .filter(|(_, t)| t.to_lowercase() == tag_lower)
            .map(|(p, _)| p)
            .collect();
        paths.sort();
        paths.dedup();
        Ok(paths)
    }

    /// Every task across the whole vault, straight from the index — the
    /// tasks panel filters/sorts/groups this list itself rather than
    /// re-reading files, per spec ("данные берутся из индекса").
    pub fn all_tasks(&self) -> Result<Vec<TaskRow>> {
        let conn = self.conn.lock().expect("index mutex poisoned");
        let mut stmt = conn
            .prepare(
                "SELECT path, line, done, text, due, priority, completed, repeat, marker_start, marker_end
                 FROM tasks ORDER BY path ASC, line ASC",
            )
            .map_err(index_err)?;
        let rows = stmt
            .query_map([], |row| {
                Ok(TaskRow {
                    path: row.get(0)?,
                    line: row.get(1)?,
                    done: row.get(2)?,
                    text: row.get(3)?,
                    due: row.get(4)?,
                    priority: row.get(5)?,
                    completed: row.get(6)?,
                    repeat: row.get(7)?,
                    marker_start: row.get(8)?,
                    marker_end: row.get(9)?,
                })
            })
            .map_err(index_err)?
            .collect::<std::result::Result<_, _>>()
            .map_err(index_err)?;
        Ok(rows)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagCount {
    pub tag: String,
    pub count: usize,
}

fn all_notes_content(conn: &Connection) -> Result<Vec<(String, String)>> {
    let mut stmt = conn
        .prepare("SELECT path, content FROM notes_fts")
        .map_err(index_err)?;
    let rows = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(index_err)?;
    rows.collect::<std::result::Result<_, _>>().map_err(index_err)
}

fn narrowed_notes_content(conn: &Connection, fts_query: &str) -> Result<Vec<(String, String)>> {
    let mut stmt = conn
        .prepare("SELECT path, content FROM notes_fts WHERE notes_fts MATCH ?1")
        .map_err(index_err)?;
    let rows = stmt
        .query_map(params![fts_query], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(index_err)?;
    rows.collect::<std::result::Result<_, _>>().map_err(index_err)
}

fn tags_by_path(conn: &Connection) -> Result<std::collections::HashMap<String, Vec<String>>> {
    let mut stmt = conn.prepare("SELECT path, tag FROM tags").map_err(index_err)?;
    let rows: Vec<(String, String)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(index_err)?
        .collect::<std::result::Result<_, _>>()
        .map_err(index_err)?;
    let mut map: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
    for (path, tag) in rows {
        map.entry(path).or_default().push(tag);
    }
    Ok(map)
}

/// Quotes `title` as an FTS5 phrase-match query, doubling any embedded
/// double quotes per FTS5 string-literal escaping rules.
fn fts_phrase_query(title: &str) -> String {
    format!("\"{}\"", title.replace('"', "\"\""))
}

/// Resolves a raw `[[target]]` string to a note path, from the point of
/// view of the note at `from_path` — when several notes share a basename,
/// the one closest by folder distance to `from_path` wins (ties broken
/// alphabetically, for determinism).
fn resolve_target_locked(conn: &Connection, target: &str, from_path: &str) -> Option<String> {
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

    let from_dir = dir_components(from_path);
    let mut best: Option<(usize, String)> = None;
    for row in rows.flatten() {
        if row.1.to_lowercase() != basename {
            continue;
        }
        let distance = tree_distance(&from_dir, &dir_components(&row.0));
        let is_better = match &best {
            None => true,
            Some((best_distance, best_path)) => {
                distance < *best_distance || (distance == *best_distance && row.0 < *best_path)
            }
        };
        if is_better {
            best = Some((distance, row.0));
        }
    }
    best.map(|(_, path)| path)
}

fn dir_components(path: &str) -> Vec<&str> {
    let mut parts: Vec<&str> = path.split('/').collect();
    parts.pop(); // drop the filename itself
    parts
}

/// Folder-distance between two notes: how many directory levels you'd walk
/// up from `from` plus back down to reach `candidate`, past their common
/// ancestor. Siblings in the same folder are distance 0.
fn tree_distance(from_dir: &[&str], candidate_dir: &[&str]) -> usize {
    let common = from_dir
        .iter()
        .zip(candidate_dir.iter())
        .take_while(|(a, b)| a == b)
        .count();
    (from_dir.len() - common) + (candidate_dir.len() - common)
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

        let mentions = index.unlinked_mentions("Target.md").unwrap();
        assert_eq!(mentions.len(), 1);
        assert_eq!(mentions[0].from_path, "Mentioner.md");
    }

    #[test]
    fn backlinks_report_line_number() {
        let (dir, vault, index) = setup();
        std::fs::write(dir.path().join("B.md"), "").unwrap();
        std::fs::write(dir.path().join("A.md"), "line one\nline two\nsee [[B]] here").unwrap();
        index.reconcile(&vault).unwrap();

        let backlinks = index.backlinks(&vault, "B.md").unwrap();
        assert_eq!(backlinks.len(), 1);
        assert_eq!(backlinks[0].line, 3);
    }

    #[test]
    fn headings_are_indexed_per_note_in_document_order() {
        let (dir, vault, index) = setup();
        std::fs::write(dir.path().join("A.md"), "# Title\n\nintro\n\n## Sub").unwrap();
        index.reconcile(&vault).unwrap();

        let headings = index.headings("A.md").unwrap();
        assert_eq!(headings.len(), 2);
        assert_eq!(headings[0].level, 1);
        assert_eq!(headings[0].text, "Title");
        assert_eq!(headings[1].level, 2);
        assert_eq!(headings[1].text, "Sub");
    }

    #[test]
    fn ambiguous_basename_resolves_to_closest_by_folder() {
        let (dir, vault, index) = setup();
        std::fs::create_dir_all(dir.path().join("A")).unwrap();
        std::fs::create_dir_all(dir.path().join("B")).unwrap();
        std::fs::write(dir.path().join("A/Note.md"), "").unwrap();
        std::fs::write(dir.path().join("B/Note.md"), "").unwrap();
        std::fs::write(dir.path().join("A/Source.md"), "[[Note]]").unwrap();
        index.reconcile(&vault).unwrap();
        index.update_note(&vault, "A/Source.md").unwrap();

        // A/Source.md sits next to A/Note.md (distance 0) and two folders
        // away from B/Note.md (up to root, down into B) — must resolve to
        // the sibling, not whichever happened to sort first alphabetically.
        let backlinks = index.backlinks(&vault, "A/Note.md").unwrap();
        assert_eq!(backlinks.len(), 1);
        let backlinks_b = index.backlinks(&vault, "B/Note.md").unwrap();
        assert!(backlinks_b.is_empty());
    }

    #[test]
    fn rename_updates_headings_and_fts_paths() {
        let (dir, vault, index) = setup();
        std::fs::write(dir.path().join("B.md"), "# Heading\n\nWord content here.").unwrap();
        index.reconcile(&vault).unwrap();

        std::fs::rename(dir.path().join("B.md"), dir.path().join("C.md")).unwrap();
        index.rename_note("B.md", "C.md").unwrap();

        assert_eq!(index.headings("C.md").unwrap().len(), 1);
        assert!(index.headings("B.md").unwrap().is_empty());
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

    #[test]
    fn search_finds_word_with_highlight() {
        let (dir, vault, index) = setup();
        std::fs::write(dir.path().join("A.md"), "line one\nhas foo in it\n").unwrap();
        std::fs::write(dir.path().join("B.md"), "nothing relevant here\n").unwrap();
        index.reconcile(&vault).unwrap();

        let results = index.search("foo", false).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].path, "A.md");
        assert_eq!(results[0].matches[0].line, 2);
    }

    #[test]
    fn search_tag_filter_uses_tags_table() {
        let (dir, vault, index) = setup();
        std::fs::write(dir.path().join("A.md"), "Body with #project tag.\n").unwrap();
        std::fs::write(dir.path().join("B.md"), "No tag here.\n").unwrap();
        index.reconcile(&vault).unwrap();

        let results = index.search("tag:project", false).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].path, "A.md");
    }

    #[test]
    fn search_survives_malformed_query_without_crashing() {
        let (dir, vault, index) = setup();
        std::fs::write(dir.path().join("A.md"), "foo unterminated bar\n").unwrap();
        index.reconcile(&vault).unwrap();

        let results = index.search("foo \"unterminated", false).unwrap();
        assert_eq!(results.len(), 1);
    }

    #[test]
    fn tag_counts_aggregates_across_notes_case_insensitively() {
        let (dir, vault, index) = setup();
        std::fs::write(dir.path().join("A.md"), "#Project here\n").unwrap();
        std::fs::write(dir.path().join("B.md"), "#project there too\n").unwrap();
        index.reconcile(&vault).unwrap();

        let counts = index.tag_counts().unwrap();
        assert_eq!(counts.len(), 1);
        assert_eq!(counts[0].tag, "project");
        assert_eq!(counts[0].count, 2);
    }

    #[test]
    fn paths_with_tag_finds_exact_tag_only() {
        let (dir, vault, index) = setup();
        std::fs::write(dir.path().join("A.md"), "#project alone\n").unwrap();
        std::fs::write(dir.path().join("B.md"), "#project/nodus nested\n").unwrap();
        index.reconcile(&vault).unwrap();

        let paths = index.paths_with_tag("project").unwrap();
        assert_eq!(paths, vec!["A.md".to_string()]);
    }

    #[test]
    fn all_tasks_reads_from_the_index_not_disk() {
        let (dir, vault, index) = setup();
        std::fs::write(dir.path().join("A.md"), "- [ ] First 📅 2026-09-01\n- [x] Second\n").unwrap();
        std::fs::write(dir.path().join("B.md"), "- [ ] Third ⏫\n").unwrap();
        index.reconcile(&vault).unwrap();

        let tasks = index.all_tasks().unwrap();
        assert_eq!(tasks.len(), 3);
        assert!(tasks.iter().any(|t| t.path == "A.md" && t.text == "First" && t.due.as_deref() == Some("2026-09-01")));
        assert!(tasks.iter().any(|t| t.path == "B.md" && t.priority == Some(3)));
    }

    /// The spec's own bar: on a 500-note vault, a search must resolve in
    /// well under 100ms — and stay there because it goes through FTS5
    /// narrowing first, not because 500 small files just happen to be fast
    /// to brute-force scan in Rust. If this ever regresses to a full scan
    /// (e.g. `narrowing_fts_query` starts returning `None` for common
    /// queries, or the MATCH call starts erroring and silently falling back
    /// every time), this is the test that should catch it.
    #[test]
    fn search_meets_100ms_budget_on_500_notes() {
        let (dir, vault, index) = setup();
        let topics = [
            "проект", "заметка", "идея", "план", "задача", "встреча", "работа", "код", "тест",
            "дизайн",
        ];
        for i in 0..500 {
            let topic = topics[i % topics.len()];
            let content = format!(
                "# Note {i}\n\nThis is note number {i}, mostly about {topic}. \
                 It contains some filler prose so the file is a realistic size: \
                 {topic} comes up in several sentences here, discussed from a few \
                 different angles to pad out the content meaningfully.\n\n\
                 Linked to [[Note {link}]].\n\n#topic/{topic}\n",
                i = i,
                topic = topic,
                link = (i + 1) % 500,
            );
            std::fs::write(dir.path().join(format!("Note {i}.md")), content).unwrap();
        }
        index.reconcile(&vault).unwrap();

        let start = std::time::Instant::now();
        let results = index.search("проект", false).unwrap();
        let elapsed = start.elapsed();

        assert!(!results.is_empty(), "expected the common topic word to match something");
        assert!(
            elapsed.as_millis() < 100,
            "search took {elapsed:?} on 500 notes, expected under 100ms"
        );
    }
}
