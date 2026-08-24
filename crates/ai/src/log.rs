//! The request log: when, to which provider, and how many tokens — never
//! the prompt or the reply. It exists to help with cost and with trust
//! ("what has this actually been sending"), not as a transcript archive;
//! keeping message content out of it entirely means it can't become a
//! second, forgotten copy of sensitive vault content.

use std::path::Path;

use rusqlite::{params, Connection};

#[derive(Debug, thiserror::Error)]
pub enum LogError {
    #[error(transparent)]
    Sql(#[from] rusqlite::Error),
}

pub type Result<T> = std::result::Result<T, LogError>;

pub struct RequestLog {
    conn: Connection,
}

pub struct NewLogEntry<'a> {
    /// Human-readable label for which connection this went through, e.g.
    /// "OpenAI", "Ollama (llama3:8b)" — not a secret, just a name.
    pub provider_label: &'a str,
    pub model: &'a str,
    /// Which assistant feature triggered this request, e.g.
    /// "continue-text", "ask-vault", "suggest-links".
    pub feature: &'a str,
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub success: bool,
    /// A short failure description (never the request/response content),
    /// so the log can also answer "why did that fail" without needing to
    /// hold onto anything sensitive.
    pub error_summary: Option<&'a str>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LogEntry {
    pub id: i64,
    pub timestamp: i64,
    pub provider_label: String,
    pub model: String,
    pub feature: String,
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub success: bool,
    pub error_summary: Option<String>,
}

impl RequestLog {
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute(
            "CREATE TABLE IF NOT EXISTS requests (
                id INTEGER PRIMARY KEY,
                timestamp INTEGER NOT NULL,
                provider_label TEXT NOT NULL,
                model TEXT NOT NULL,
                feature TEXT NOT NULL,
                prompt_tokens INTEGER NOT NULL,
                completion_tokens INTEGER NOT NULL,
                success INTEGER NOT NULL,
                error_summary TEXT
            )",
            [],
        )?;
        Ok(Self { conn })
    }

    pub fn record(&self, entry: NewLogEntry) -> Result<()> {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        self.conn.execute(
            "INSERT INTO requests (timestamp, provider_label, model, feature, prompt_tokens, completion_tokens, success, error_summary)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                timestamp,
                entry.provider_label,
                entry.model,
                entry.feature,
                entry.prompt_tokens,
                entry.completion_tokens,
                entry.success,
                entry.error_summary,
            ],
        )?;
        Ok(())
    }

    pub fn recent(&self, limit: usize) -> Result<Vec<LogEntry>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, timestamp, provider_label, model, feature, prompt_tokens, completion_tokens, success, error_summary
             FROM requests ORDER BY id DESC LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit as i64], |row| {
            Ok(LogEntry {
                id: row.get(0)?,
                timestamp: row.get(1)?,
                provider_label: row.get(2)?,
                model: row.get(3)?,
                feature: row.get(4)?,
                prompt_tokens: row.get(5)?,
                completion_tokens: row.get(6)?,
                success: row.get(7)?,
                error_summary: row.get(8)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(LogError::from)
    }

    pub fn clear(&self) -> Result<()> {
        self.conn.execute("DELETE FROM requests", [])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open_temp() -> (tempfile::TempDir, RequestLog) {
        let dir = tempfile::tempdir().unwrap();
        let log = RequestLog::open(&dir.path().join("ai-log.sqlite")).unwrap();
        (dir, log)
    }

    #[test]
    fn records_and_lists_entries_newest_first() {
        let (_dir, log) = open_temp();
        log.record(NewLogEntry {
            provider_label: "OpenAI",
            model: "gpt-4o",
            feature: "continue-text",
            prompt_tokens: 100,
            completion_tokens: 20,
            success: true,
            error_summary: None,
        })
        .unwrap();
        log.record(NewLogEntry {
            provider_label: "Ollama (llama3:8b)",
            model: "llama3:8b",
            feature: "ask-vault",
            prompt_tokens: 500,
            completion_tokens: 80,
            success: true,
            error_summary: None,
        })
        .unwrap();

        let entries = log.recent(10).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(
            entries[0].feature, "ask-vault",
            "most recent entry comes first"
        );
        assert_eq!(entries[1].feature, "continue-text");
    }

    #[test]
    fn records_a_failure_with_its_summary_but_never_any_request_content() {
        let (_dir, log) = open_temp();
        log.record(NewLogEntry {
            provider_label: "Custom",
            model: "local-model",
            feature: "summarize",
            prompt_tokens: 0,
            completion_tokens: 0,
            success: false,
            error_summary: Some("this API key was rejected"),
        })
        .unwrap();

        let entries = log.recent(10).unwrap();
        assert_eq!(entries.len(), 1);
        assert!(!entries[0].success);
        assert_eq!(
            entries[0].error_summary.as_deref(),
            Some("this API key was rejected")
        );
    }

    #[test]
    fn recent_respects_the_limit() {
        let (_dir, log) = open_temp();
        for i in 0..5 {
            log.record(NewLogEntry {
                provider_label: "OpenAI",
                model: "gpt-4o",
                feature: if i % 2 == 0 {
                    "continue-text"
                } else {
                    "rephrase"
                },
                prompt_tokens: 10,
                completion_tokens: 5,
                success: true,
                error_summary: None,
            })
            .unwrap();
        }
        assert_eq!(log.recent(2).unwrap().len(), 2);
    }

    #[test]
    fn clear_empties_the_log() {
        let (_dir, log) = open_temp();
        log.record(NewLogEntry {
            provider_label: "OpenAI",
            model: "gpt-4o",
            feature: "continue-text",
            prompt_tokens: 10,
            completion_tokens: 5,
            success: true,
            error_summary: None,
        })
        .unwrap();
        log.clear().unwrap();
        assert!(log.recent(10).unwrap().is_empty());
    }

    #[test]
    fn reopening_the_same_file_keeps_previous_entries() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("ai-log.sqlite");
        {
            let log = RequestLog::open(&path).unwrap();
            log.record(NewLogEntry {
                provider_label: "OpenAI",
                model: "gpt-4o",
                feature: "continue-text",
                prompt_tokens: 10,
                completion_tokens: 5,
                success: true,
                error_summary: None,
            })
            .unwrap();
        }
        let log = RequestLog::open(&path).unwrap();
        assert_eq!(log.recent(10).unwrap().len(), 1);
    }
}
