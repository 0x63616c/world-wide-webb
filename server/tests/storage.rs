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
