//! Deletes chunk bytes no file's current manifest references any more (an
//! edit that replaced a chunk, or a file tombstoned entirely). A grace
//! window keeps a chunk mid-upload — referenced by nothing yet because its
//! file's manifest commit hasn't landed — from being swept before that
//! commit has a chance to happen.

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;

use crate::storage;

const GRACE_PERIOD_SECS: i64 = 3600;

/// How long an unrefreshed discovery announcement is kept around after it
/// stops being useful (well past its short TTL) — bounding storage for a
/// public instance without touching the normal "recently stale, still
/// worth showing a last-seen time for" path.
const ANNOUNCEMENT_RETENTION_SECS: i64 = 30 * 24 * 3600;

pub fn run_gc_once(conn: &Connection, data_dir: &Path) -> rusqlite::Result<usize> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    let cutoff = now - GRACE_PERIOD_SECS;

    let mut stmt = conn.prepare(
        "SELECT id FROM chunks
         WHERE created_at < ?1
           AND NOT EXISTS (SELECT 1 FROM chunk_refs WHERE chunk_refs.chunk_id = chunks.id)",
    )?;
    let orphaned: Vec<String> = stmt
        .query_map([cutoff], |row| row.get(0))?
        .collect::<Result<_, _>>()?;

    for id in &orphaned {
        let _ = storage::delete_chunk(data_dir, id);
        conn.execute("DELETE FROM chunks WHERE id = ?1", [id])?;
    }

    crate::db::delete_long_stale_announcements(conn, now - ANNOUNCEMENT_RETENTION_SECS)?;

    Ok(orphaned.len())
}
