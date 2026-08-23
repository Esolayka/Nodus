//! Local, per-vault record of "what did we last successfully sync for this
//! file" — the blob id and version the server knows it by, the chunk ids
//! its manifest was built from, and a full snapshot of the plaintext at
//! that point. The snapshot exists purely to serve as the 3-way-merge
//! ancestor if a conflict ever needs one; without it, "automatic merge"
//! would have nothing to merge *from*.

use rusqlite::{Connection, OptionalExtension};

use super::error::Result;

#[derive(Debug, Clone)]
pub struct FileState {
    pub path: String,
    pub blob_id: String,
    pub version: u64,
    pub chunk_ids: Vec<String>,
    pub content_hash: String,
    pub content_snapshot: Vec<u8>,
}

pub fn open(path: &std::path::Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS files (
            path TEXT PRIMARY KEY,
            blob_id TEXT NOT NULL,
            version INTEGER NOT NULL,
            chunk_ids TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            content_snapshot BLOB NOT NULL
        );
        CREATE INDEX IF NOT EXISTS files_blob_id ON files (blob_id);",
    )?;
    Ok(conn)
}

fn row_to_state(
    path: String,
    blob_id: String,
    version: i64,
    chunk_ids_json: String,
    content_hash: String,
    content_snapshot: Vec<u8>,
) -> FileState {
    FileState {
        path,
        blob_id,
        version: version as u64,
        chunk_ids: serde_json::from_str(&chunk_ids_json).unwrap_or_default(),
        content_hash,
        content_snapshot,
    }
}

pub fn find_by_path(conn: &Connection, path: &str) -> Result<Option<FileState>> {
    let row = conn
        .query_row(
            "SELECT path, blob_id, version, chunk_ids, content_hash, content_snapshot FROM files WHERE path = ?1",
            [path],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, Vec<u8>>(5)?,
                ))
            },
        )
        .optional()?;
    Ok(row.map(|(path, blob_id, version, chunk_ids, hash, snapshot)| {
        row_to_state(path, blob_id, version, chunk_ids, hash, snapshot)
    }))
}

pub fn find_by_blob_id(conn: &Connection, blob_id: &str) -> Result<Option<FileState>> {
    let row = conn
        .query_row(
            "SELECT path, blob_id, version, chunk_ids, content_hash, content_snapshot FROM files WHERE blob_id = ?1",
            [blob_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, Vec<u8>>(5)?,
                ))
            },
        )
        .optional()?;
    Ok(row.map(|(path, blob_id, version, chunk_ids, hash, snapshot)| {
        row_to_state(path, blob_id, version, chunk_ids, hash, snapshot)
    }))
}

/// All paths this vault has ever synced, keyed by blob id — what the client
/// tells the server it already knows about when asking what changed.
pub fn all_known_versions(conn: &Connection) -> Result<std::collections::HashMap<String, u64>> {
    let mut stmt = conn.prepare("SELECT blob_id, version FROM files")?;
    let rows = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)? as u64)))?;
    let mut map = std::collections::HashMap::new();
    for row in rows {
        let (blob_id, version) = row?;
        map.insert(blob_id, version);
    }
    Ok(map)
}

pub fn upsert(
    conn: &Connection,
    path: &str,
    blob_id: &str,
    version: u64,
    chunk_ids: &[String],
    content_hash: &str,
    content_snapshot: &[u8],
) -> Result<()> {
    let chunk_ids_json = serde_json::to_string(chunk_ids)?;
    conn.execute(
        "INSERT INTO files (path, blob_id, version, chunk_ids, content_hash, content_snapshot)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(path) DO UPDATE SET blob_id = excluded.blob_id, version = excluded.version,
             chunk_ids = excluded.chunk_ids, content_hash = excluded.content_hash,
             content_snapshot = excluded.content_snapshot",
        rusqlite::params![path, blob_id, version as i64, chunk_ids_json, content_hash, content_snapshot],
    )?;
    Ok(())
}

pub fn delete(conn: &Connection, path: &str) -> Result<()> {
    conn.execute("DELETE FROM files WHERE path = ?1", [path])?;
    Ok(())
}

pub fn all_paths(conn: &Connection) -> Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT path FROM files")?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
}
