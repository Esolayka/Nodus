//! Metadata storage. Deliberately plain SQLite behind a mutex rather than an
//! async driver — this service's whole write load is one small transaction
//! per sync call, never worth the complexity of an async connection pool.

use rusqlite::{Connection, OptionalExtension};
use std::time::{SystemTime, UNIX_EPOCH};

pub fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

pub fn open(path: &std::path::Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    migrate(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS devices (
            id TEXT PRIMARY KEY,
            token TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            telegram_user_id INTEGER
        );

        CREATE TABLE IF NOT EXISTS pairing_codes (
            code TEXT PRIMARY KEY,
            created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS files (
            id TEXT PRIMARY KEY,
            version INTEGER NOT NULL,
            deleted INTEGER NOT NULL DEFAULT 0,
            chunk_ids TEXT NOT NULL,
            encrypted_path TEXT,
            updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS chunks (
            id TEXT PRIMARY KEY,
            size INTEGER NOT NULL,
            created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS chunk_refs (
            chunk_id TEXT NOT NULL,
            file_id TEXT NOT NULL,
            PRIMARY KEY (chunk_id, file_id)
        );

        CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS announcements (
            discovery_id TEXT PRIMARY KEY,
            encrypted_address TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL
        );
        ",
    )
}

pub fn used_bytes(conn: &Connection) -> rusqlite::Result<u64> {
    conn.query_row("SELECT COALESCE(SUM(size), 0) FROM chunks", [], |row| {
        row.get::<_, i64>(0)
    })
    .map(|v| v as u64)
}

pub fn device_count(conn: &Connection) -> rusqlite::Result<i64> {
    conn.query_row("SELECT COUNT(*) FROM devices", [], |row| row.get(0))
}

pub fn device_id_for_token(conn: &Connection, token: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row("SELECT id FROM devices WHERE token = ?1", [token], |row| {
        row.get(0)
    })
    .optional()
}

pub fn insert_device(
    conn: &Connection,
    id: &str,
    token: &str,
    name: &str,
    created_at: i64,
    telegram_user_id: Option<i64>,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO devices (id, token, name, created_at, telegram_user_id) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![id, token, name, created_at, telegram_user_id],
    )?;
    Ok(())
}

/// The bootstrap code lets the very first device claim itself: before any
/// device exists there is, by definition, no already-paired device to show
/// a normal pairing code, so the server prints/persists its own one-time
/// code instead. Regenerated on every startup while still unclaimed, so an
/// operator restarting the container gets a fresh code without leaving the
/// old one valid forever.
pub fn set_bootstrap_code(conn: &Connection, code: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO meta (key, value) VALUES ('bootstrap_code', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [code],
    )?;
    Ok(())
}

pub fn bootstrap_code(conn: &Connection) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT value FROM meta WHERE key = 'bootstrap_code'",
        [],
        |row| row.get(0),
    )
    .optional()
}

pub fn clear_bootstrap_code(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM meta WHERE key = 'bootstrap_code'", [])?;
    Ok(())
}

pub struct Announcement {
    pub encrypted_address: String,
    pub updated_at: i64,
    pub expires_at: i64,
}

pub fn upsert_announcement(
    conn: &Connection,
    discovery_id: &str,
    encrypted_address: &str,
    now: i64,
    ttl_secs: i64,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO announcements (discovery_id, encrypted_address, updated_at, expires_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(discovery_id) DO UPDATE SET encrypted_address = excluded.encrypted_address,
             updated_at = excluded.updated_at, expires_at = excluded.expires_at",
        rusqlite::params![discovery_id, encrypted_address, now, now + ttl_secs],
    )?;
    Ok(())
}

pub fn get_announcement(
    conn: &Connection,
    discovery_id: &str,
) -> rusqlite::Result<Option<Announcement>> {
    conn.query_row(
        "SELECT encrypted_address, updated_at, expires_at FROM announcements WHERE discovery_id = ?1",
        [discovery_id],
        |row| {
            Ok(Announcement { encrypted_address: row.get(0)?, updated_at: row.get(1)?, expires_at: row.get(2)? })
        },
    )
    .optional()
}

/// Sweeps announcements nobody has refreshed in a long time — not the
/// normal expiry path (a stale-but-recent row still answers "computer
/// unavailable, last seen at ...", which is deliberate), just bounding
/// storage for a public instance serving devices that stopped using local
/// mode entirely.
pub fn delete_long_stale_announcements(
    conn: &Connection,
    older_than: i64,
) -> rusqlite::Result<usize> {
    conn.execute(
        "DELETE FROM announcements WHERE updated_at < ?1",
        [older_than],
    )
}
