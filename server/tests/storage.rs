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
