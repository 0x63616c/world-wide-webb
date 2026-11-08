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
