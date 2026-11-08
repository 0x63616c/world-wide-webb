use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use std::{path::Path, time::Duration};

/// Validate existing production storage without creating a database or applying migrations.
/// Run inside the same Linux filesystem as the writer, never through macOS file sharing.
pub async fn validate(path: &Path) -> Result<(), sqlx::Error> {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(
            SqliteConnectOptions::new()
                .filename(path)
                .read_only(true)
                .busy_timeout(Duration::from_secs(5)),
        )
        .await?;
    let result = async {
        let checks: Vec<(String,)> = sqlx::query_as("PRAGMA quick_check")
            .fetch_all(&pool)
            .await?;
        if checks != [("ok".to_owned(),)] {
            return Err(sqlx::Error::Protocol(
                "SQLite integrity check failed".into(),
            ));
        }
        for table in ["settings", "booth_photo", "walk", "_sqlx_migrations"] {
            let count: (i64,) =
                sqlx::query_as("SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?")
                    .bind(table)
                    .fetch_one(&pool)
                    .await?;
            if count.0 != 1 {
                return Err(sqlx::Error::Protocol(
                    "Production SQLite schema is missing".into(),
                ));
            }
        }
        Ok(())
    }
    .await;
    pool.close().await;
    result
}

pub async fn open(path: &Path) -> Result<sqlx::SqlitePool, sqlx::Error> {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .foreign_keys(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Full)
        .busy_timeout(Duration::from_secs(5));
    // One connection intentionally serializes mutations/revision commits. At household scale this
    // is simpler than a second application-level lock and avoids SQLite read-to-write upgrade races.
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await?;
    sqlx::migrate!().run(&pool).await?;
    Ok(pool)
}

/// A transactionally consistent online copy, produced entirely inside Linux.
pub async fn snapshot(source: &Path, destination: &Path) -> Result<(), sqlx::Error> {
    if destination.exists() {
        return Err(sqlx::Error::Protocol(
            "Snapshot destination already exists".into(),
        ));
    }
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(
            SqliteConnectOptions::new()
                .filename(source)
                .read_only(true)
                .busy_timeout(Duration::from_secs(5)),
        )
        .await?;
    let result = sqlx::query("VACUUM INTO ?")
        .bind(destination.to_string_lossy().as_ref())
        .execute(&pool)
        .await;
    pool.close().await;
    result?;
    validate(destination).await?;
    let copy = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(
            SqliteConnectOptions::new()
                .filename(destination)
                .read_only(true),
        )
        .await?;
    let invalid = sqlx::query("PRAGMA foreign_key_check")
        .fetch_optional(&copy)
        .await?;
    copy.close().await;
    if invalid.is_some() {
        return Err(sqlx::Error::Protocol(
            "Snapshot foreign key check failed".into(),
        ));
    }
    Ok(())
}

/// Remove only reserved hourly scratch artifacts while the caller holds the deployment lock.
pub async fn clean_snapshots(directory: &Path) -> std::io::Result<()> {
    let mut entries = tokio::fs::read_dir(directory).await?;
    while let Some(entry) = entries.next_entry().await? {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let base = name
            .strip_suffix("-wal")
            .or_else(|| name.strip_suffix("-shm"))
            .unwrap_or(&name);
        let Some(stamp) = base
            .strip_prefix(".hourly-")
            .and_then(|v| v.strip_suffix(".sqlite"))
        else {
            continue;
        };
        let valid = stamp.len() == 16
            && stamp.as_bytes().iter().enumerate().all(|(i, b)| {
                if i == 8 {
                    *b == b'T'
                } else if i == 15 {
                    *b == b'Z'
                } else {
                    b.is_ascii_digit()
                }
            });
        if valid && entry.file_type().await?.is_file() {
            tokio::fs::remove_file(entry.path()).await?;
        }
    }
    Ok(())
}
