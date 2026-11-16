//! Watch progress, one shared household state, in a small SQLite file on local disk.
//! Rows are never removed by a scan, so a library that is briefly missing loses nothing.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use anyhow::Result;
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct Progress {
    /// Playback position in seconds.
    pub seconds: f64,
    /// Marked as watched, either by finishing or by hand.
    pub watched: bool,
    /// When it was last saved (set by the server; ignored when sent).
    #[serde(default)]
    pub updated_at: Option<String>,
}

pub struct ProgressStore {
    conn: Mutex<Connection>,
}

impl ProgressStore {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        Self::init(Connection::open(path)?)
    }

    #[cfg(test)]
    pub fn in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> Result<Self> {
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA busy_timeout = 5000;
             CREATE TABLE IF NOT EXISTS progress (
                 id TEXT PRIMARY KEY,
                 seconds REAL NOT NULL,
                 watched INTEGER NOT NULL,
                 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
             );",
        )?;
        Ok(Self { conn: Mutex::new(conn) })
    }

    pub fn all(&self) -> Result<HashMap<String, Progress>> {
        let conn = self.conn.lock().expect("progress lock");
        let mut stmt = conn.prepare("SELECT id, seconds, watched, updated_at FROM progress")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, Progress { seconds: row.get(1)?, watched: row.get(2)?, updated_at: row.get(3)? }))
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn set(&self, id: &str, progress: Progress) -> Result<()> {
        let conn = self.conn.lock().expect("progress lock");
        conn.execute(
            "INSERT INTO progress (id, seconds, watched) VALUES (?1, ?2, ?3)
             ON CONFLICT(id) DO UPDATE SET seconds = excluded.seconds, watched = excluded.watched,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
            params![id, progress.seconds.max(0.0), progress.watched],
        )?;
        Ok(())
    }

    pub fn check(&self) -> Result<()> {
        let conn = self.conn.lock().expect("progress lock");
        conn.query_row("SELECT 1", [], |_| Ok(()))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_and_overwrites_progress() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("data/progress.sqlite");
        let store = ProgressStore::open(&path).unwrap();
        store.set("a", Progress { seconds: 12.5, watched: false, updated_at: None }).unwrap();
        store.set("a", Progress { seconds: -3.0, watched: true, updated_at: None }).unwrap();
        drop(store);
        let reopened = ProgressStore::open(&path).unwrap();
        let saved = reopened.all().unwrap()["a"].clone();
        assert_eq!((saved.seconds, saved.watched), (0.0, true));
        assert!(saved.updated_at.is_some_and(|t| t.ends_with('Z')));
    }
}
