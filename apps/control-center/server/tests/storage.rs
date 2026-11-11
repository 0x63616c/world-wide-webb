use www_server::storage;

#[tokio::test]
async fn validation_never_creates_or_migrates_a_database_and_rejects_corruption() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("test.sqlite");
    assert!(storage::validate(&path).await.is_err());
    assert!(!path.exists());
    let empty = sqlx::SqlitePool::connect(&format!("sqlite://{}?mode=rwc", path.display()))
        .await
        .unwrap();
    sqlx::query("CREATE TABLE unrelated(id INTEGER)")
        .execute(&empty)
        .await
        .unwrap();
    empty.close().await;
    assert!(storage::validate(&path).await.is_err());
    std::fs::remove_file(&path).unwrap();
    let pool = storage::open(&path).await.unwrap();
    sqlx::query("INSERT INTO settings (id, value, updated_at_utc) VALUES ('fixture', '{}', '2026-11-08T00:00:00Z')")
        .execute(&pool)
        .await
        .unwrap();
    storage::validate(&path).await.unwrap();
    pool.close().await;
    std::fs::write(&path, vec![0; 4096]).unwrap();
    assert!(storage::validate(&path).await.is_err());
}

#[tokio::test]
async fn online_snapshot_includes_committed_wal_without_stopping_the_writer() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("source.sqlite");
    let target = dir.path().join("snapshot.sqlite");
    let pool = storage::open(&source).await.unwrap();
    sqlx::query("INSERT INTO settings(id,value,updated_at_utc) VALUES('fixture','{}','2026-11-08T00:00:00Z')").execute(&pool).await.unwrap();
    storage::snapshot(&source, &target).await.unwrap();
    assert!(storage::snapshot(&source, &target).await.is_err());
    sqlx::query("DELETE FROM settings WHERE id='fixture'")
        .execute(&pool)
        .await
        .unwrap();
    let copy = sqlx::SqlitePool::connect(&format!("sqlite://{}?mode=ro", target.display()))
        .await
        .unwrap();
    let count: (i64,) = sqlx::query_as("SELECT count(*) FROM settings WHERE id='fixture'")
        .fetch_one(&copy)
        .await
        .unwrap();
    assert_eq!(count.0, 1);
    copy.close().await;
    pool.close().await;
}

#[tokio::test]
async fn scratch_cleanup_preserves_live_database_and_unrelated_files() {
    let dir = tempfile::tempdir().unwrap();
    for name in [
        "control-center.sqlite",
        ".hourly-20261108T010000Z.sqlite",
        ".hourly-20261108T010000Z.sqlite-wal",
        ".hourly-manual.sqlite",
        "incident.sqlite",
    ] {
        std::fs::write(dir.path().join(name), b"preserved").unwrap();
    }
    storage::clean_snapshots(dir.path()).await.unwrap();
    assert!(!dir.path().join(".hourly-20261108T010000Z.sqlite").exists());
    assert!(
        !dir.path()
            .join(".hourly-20261108T010000Z.sqlite-wal")
            .exists()
    );
    for name in [
        "control-center.sqlite",
        ".hourly-manual.sqlite",
        "incident.sqlite",
    ] {
        assert_eq!(std::fs::read(dir.path().join(name)).unwrap(), b"preserved");
    }
}

#[test]
fn production_start_never_reinitializes_an_empty_existing_database() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("empty.sqlite");
    std::fs::write(&path, []).unwrap();
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_www-server"))
        .arg("migrate")
        .env("WWW_DATA_DIR", dir.path())
        .env("MEDIA_STORAGE_DIR", dir.path())
        .env("WWW_DATABASE_PATH", &path)
        .env("WWW_REQUIRE_DATABASE", "on")
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert_eq!(std::fs::metadata(path).unwrap().len(), 0);
}

#[tokio::test]
async fn migration_removes_walk_records_and_keeps_other_data() {
    let dir = tempfile::tempdir().unwrap();
    let migrations = dir.path().join("old-migrations");
    std::fs::create_dir(&migrations).unwrap();
    for file in ["0001_core.sql", "0002_retained_features.sql"] {
        std::fs::copy(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("migrations")
                .join(file),
            migrations.join(file),
        )
        .unwrap();
    }
    let path = dir.path().join("test.sqlite");
    let pool = sqlx::SqlitePool::connect(&format!("sqlite://{}?mode=rwc", path.display()))
        .await
        .unwrap();
    sqlx::migrate::Migrator::new(migrations.as_path())
        .await
        .unwrap()
        .run(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO walk(id, started_at, source, created_at, updated_at) VALUES ('historic', '2026-01-01', 'ipad', '2026-01-01', '2026-01-01')").execute(&pool).await.unwrap();
    sqlx::query(
        "INSERT INTO settings(id, value, updated_at_utc) VALUES ('fixture', '{}', '2026-01-01')",
    )
    .execute(&pool)
    .await
    .unwrap();
    pool.close().await;
    storage::validate(&path).await.unwrap();
    let upgraded = storage::open(&path).await.unwrap();
    let walk_tables: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'walk'",
    )
    .fetch_one(&upgraded)
    .await
    .unwrap();
    let settings: i64 = sqlx::query_scalar("SELECT count(*) FROM settings WHERE id = 'fixture'")
        .fetch_one(&upgraded)
        .await
        .unwrap();
    assert_eq!(walk_tables, 0);
    assert_eq!(settings, 1);
    upgraded.close().await;
    storage::validate(&path).await.unwrap();
}
