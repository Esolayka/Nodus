//! Local storage for chunk embeddings, next to the app's other derived
//! data — never sent anywhere, rebuilt from vault content at any time,
//! and updated incrementally: a note whose content hash hasn't changed
//! is never re-embedded.

use std::path::Path;

use rusqlite::{params, Connection};

use crate::chunking::TextChunk;

#[derive(Debug, thiserror::Error)]
pub enum VectorStoreError {
    #[error(transparent)]
    Sql(#[from] rusqlite::Error),
}

pub type Result<T> = std::result::Result<T, VectorStoreError>;

pub struct VectorStore {
    conn: Connection,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ChunkMatch {
    pub note_path: String,
    pub start: usize,
    pub end: usize,
    pub score: f32,
}

/// The content hash `needs_reindex`/`reindex_note` compare against — a
/// plain SHA-256 of the note's raw text, since it only needs to detect
/// "did this note change at all," not resist tampering.
pub fn hash_content(content: &str) -> String {
    use sha2::{Digest, Sha256};
    hex::encode(Sha256::digest(content.as_bytes()))
}

fn encode_embedding(vector: &[f32]) -> Vec<u8> {
    vector.iter().flat_map(|v| v.to_le_bytes()).collect()
}

fn decode_embedding(bytes: &[u8]) -> Vec<f32> {
    bytes.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect()
}

fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    let dot: f32 = a.iter().zip(b).map(|(x, y)| x * y).sum();
    let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm_a == 0.0 || norm_b == 0.0 {
        return 0.0;
    }
    dot / (norm_a * norm_b)
}

impl VectorStore {
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE IF NOT EXISTS notes (
                 path TEXT PRIMARY KEY,
                 content_hash TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS chunks (
                 id INTEGER PRIMARY KEY,
                 note_path TEXT NOT NULL REFERENCES notes(path) ON DELETE CASCADE,
                 start_offset INTEGER NOT NULL,
                 end_offset INTEGER NOT NULL,
                 embedding BLOB NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_chunks_note_path ON chunks(note_path);",
        )?;
        Ok(Self { conn })
    }

    /// `true` when `note_path` was never indexed, or was indexed under a
    /// different content hash — the only two cases that actually need
    /// re-embedding.
    pub fn needs_reindex(&self, note_path: &str, content_hash: &str) -> Result<bool> {
        let stored: Option<String> = self
            .conn
            .query_row("SELECT content_hash FROM notes WHERE path = ?1", params![note_path], |row| row.get(0))
            .ok();
        Ok(stored.as_deref() != Some(content_hash))
    }

    /// Replaces every chunk stored for `note_path` with `chunks` in one
    /// transaction — a crash partway through never leaves a note with a
    /// mix of stale and fresh chunks.
    pub fn reindex_note(&mut self, note_path: &str, content_hash: &str, chunks: &[(TextChunk, Vec<f32>)]) -> Result<()> {
        let tx = self.conn.transaction()?;
        tx.execute("DELETE FROM notes WHERE path = ?1", params![note_path])?;
        tx.execute(
            "INSERT INTO notes (path, content_hash) VALUES (?1, ?2)",
            params![note_path, content_hash],
        )?;
        for (chunk, embedding) in chunks {
            tx.execute(
                "INSERT INTO chunks (note_path, start_offset, end_offset, embedding) VALUES (?1, ?2, ?3, ?4)",
                params![note_path, chunk.start as i64, chunk.end as i64, encode_embedding(embedding)],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Drops every chunk for a note that no longer exists (deleted or
    /// moved out from under the index).
    pub fn remove_note(&mut self, note_path: &str) -> Result<()> {
        self.conn.execute("DELETE FROM notes WHERE path = ?1", params![note_path])?;
        Ok(())
    }

    pub fn indexed_note_count(&self) -> Result<usize> {
        Ok(self.conn.query_row("SELECT COUNT(*) FROM notes", [], |row| row.get::<_, i64>(0))? as usize)
    }

    pub fn indexed_chunk_count(&self) -> Result<usize> {
        Ok(self.conn.query_row("SELECT COUNT(*) FROM chunks", [], |row| row.get::<_, i64>(0))? as usize)
    }

    /// Brute-force cosine similarity over every stored chunk — plenty
    /// fast at the scale of one vault's worth of notes, and much simpler
    /// than standing up an approximate-nearest-neighbor index for it.
    pub fn search(&self, query_embedding: &[f32], limit: usize) -> Result<Vec<ChunkMatch>> {
        let mut stmt = self.conn.prepare("SELECT note_path, start_offset, end_offset, embedding FROM chunks")?;
        let rows = stmt.query_map([], |row| {
            let note_path: String = row.get(0)?;
            let start: i64 = row.get(1)?;
            let end: i64 = row.get(2)?;
            let embedding: Vec<u8> = row.get(3)?;
            Ok((note_path, start as usize, end as usize, decode_embedding(&embedding)))
        })?;

        let mut scored: Vec<ChunkMatch> = rows
            .filter_map(|r| r.ok())
            .map(|(note_path, start, end, embedding)| ChunkMatch {
                note_path,
                start,
                end,
                score: cosine_similarity(query_embedding, &embedding),
            })
            .collect();
        scored.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
        scored.truncate(limit);
        Ok(scored)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open_temp() -> (tempfile::TempDir, VectorStore) {
        let dir = tempfile::tempdir().unwrap();
        let store = VectorStore::open(&dir.path().join("vectors.sqlite")).unwrap();
        (dir, store)
    }

    fn chunk(start: usize, end: usize, text: &str) -> TextChunk {
        TextChunk { text: text.to_string(), start, end }
    }

    #[test]
    fn hash_content_is_deterministic_and_sensitive_to_any_change() {
        assert_eq!(hash_content("hello"), hash_content("hello"));
        assert_ne!(hash_content("hello"), hash_content("hello!"));
    }

    #[test]
    fn a_never_indexed_note_needs_reindexing() {
        let (_dir, store) = open_temp();
        assert!(store.needs_reindex("Note.md", "hash-1").unwrap());
    }

    #[test]
    fn an_unchanged_content_hash_does_not_need_reindexing() {
        let (_dir, mut store) = open_temp();
        store.reindex_note("Note.md", "hash-1", &[(chunk(0, 5, "hello"), vec![0.1, 0.2, 0.3])]).unwrap();
        assert!(!store.needs_reindex("Note.md", "hash-1").unwrap());
    }

    #[test]
    fn a_changed_content_hash_needs_reindexing() {
        let (_dir, mut store) = open_temp();
        store.reindex_note("Note.md", "hash-1", &[(chunk(0, 5, "hello"), vec![0.1, 0.2, 0.3])]).unwrap();
        assert!(store.needs_reindex("Note.md", "hash-2").unwrap());
    }

    #[test]
    fn reindexing_replaces_old_chunks_rather_than_accumulating_them() {
        let (_dir, mut store) = open_temp();
        store
            .reindex_note("Note.md", "hash-1", &[(chunk(0, 5, "hello"), vec![1.0, 0.0]), (chunk(5, 10, "world"), vec![0.0, 1.0])])
            .unwrap();
        assert_eq!(store.indexed_chunk_count().unwrap(), 2);

        store.reindex_note("Note.md", "hash-2", &[(chunk(0, 3, "hi!"), vec![1.0, 1.0])]).unwrap();
        assert_eq!(store.indexed_chunk_count().unwrap(), 1, "the old chunks must be gone, not appended to");
        assert_eq!(store.indexed_note_count().unwrap(), 1);
    }

    #[test]
    fn removing_a_note_drops_its_chunks_via_cascade() {
        let (_dir, mut store) = open_temp();
        store.reindex_note("Note.md", "hash-1", &[(chunk(0, 5, "hello"), vec![1.0, 0.0])]).unwrap();
        store.remove_note("Note.md").unwrap();
        assert_eq!(store.indexed_note_count().unwrap(), 0);
        assert_eq!(store.indexed_chunk_count().unwrap(), 0, "cascade delete should remove orphaned chunks too");
    }

    #[test]
    fn search_ranks_the_closer_vector_first() {
        let (_dir, mut store) = open_temp();
        store
            .reindex_note(
                "A.md",
                "hash-a",
                &[(chunk(0, 5, "close"), vec![1.0, 0.0, 0.0]), (chunk(5, 10, "far"), vec![0.0, 1.0, 0.0])],
            )
            .unwrap();
        store.reindex_note("B.md", "hash-b", &[(chunk(0, 5, "opposite"), vec![-1.0, 0.0, 0.0])]).unwrap();

        let results = store.search(&[1.0, 0.0, 0.0], 2).unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].note_path, "A.md");
        assert!(results[0].score > results[1].score);
    }

    #[test]
    fn search_respects_the_limit() {
        let (_dir, mut store) = open_temp();
        let chunks: Vec<(TextChunk, Vec<f32>)> =
            (0..10).map(|i| (chunk(i, i + 1, "x"), vec![i as f32, 1.0, 0.0])).collect();
        store.reindex_note("Note.md", "hash-1", &chunks).unwrap();
        assert_eq!(store.search(&[5.0, 1.0, 0.0], 3).unwrap().len(), 3);
    }
}
