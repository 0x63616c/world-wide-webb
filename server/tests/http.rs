use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;
use www_server::{AppState, http, storage};
const TOKEN: &str = "test-only-provisioned-api-token-32-bytes";
async fn fixture() -> (tempfile::TempDir, Router, sqlx::SqlitePool) {
    let dir = tempfile::tempdir().unwrap();
    let db = storage::open(&dir.path().join("test.sqlite"))
        .await
        .unwrap();
    let state = AppState::new(db.clone(), dir.path().join("media"), TOKEN.into()).unwrap();
    (dir, http::router(state), db)
}
async fn call(app: &Router, method: &str, path: &str, body: Value) -> (StatusCode, Value) {
    let request = Request::builder()
        .method(method)
        .uri(path)
        .header("authorization", format!("Bearer {TOKEN}"))
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}
#[tokio::test]
async fn authentication_is_required_and_health_is_real() {
    let (_dir, app, db) = fixture().await;
    let r = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/walks/state")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        call(&app, "GET", "/healthz", Value::Null).await.0,
        StatusCode::OK
    );
    db.close().await;
    assert_eq!(
        call(&app, "GET", "/healthz", Value::Null).await.0,
        StatusCode::SERVICE_UNAVAILABLE
    );
}
#[tokio::test]
async fn walk_retries_tombstones_and_notifications_are_atomic() {
    let (_dir, app, db) = fixture().await;
    let key = "00000000-0000-4000-8000-000000000001";
    let (_, first) = call(
        &app,
        "POST",
        "/api/v1/walks/start",
        json!({"id":key,"startedAt":"2026-11-07T10:00:00-08:00","source":"iphone"}),
    )
    .await;
    assert_eq!(first["active"]["startedAt"], "2026-11-07T18:00:00.000000Z");
    let (_, second) = call(&app, "POST", "/api/v1/walks/start", json!({"id":key})).await;
    assert_eq!(first["active"], second["active"]);
    call(
        &app,
        "POST",
        "/api/v1/walks/stop",
        json!({"id":key,"endedAt":"2026-11-07T17:00:00Z"}),
    )
    .await;
    call(&app, "POST", "/api/v1/walks/stop", json!({"id":key})).await;
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM notifications")
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(count, 1);
    let (_, history) = call(&app, "GET", "/api/v1/walks/history", Value::Null).await;
    assert_eq!(
        history["walks"][0]["endedAt"],
        history["walks"][0]["startedAt"]
    );
    call(&app, "DELETE", &format!("/api/v1/walks/{key}"), Value::Null).await;
    let (_, retry) = call(&app, "POST", "/api/v1/walks/start", json!({"id":key})).await;
    assert!(retry["active"].is_null());
}
#[tokio::test]
async fn simultaneous_starts_never_create_two_active_walks() {
    let (_dir, app, db) = fixture().await;
    let (a, b) = tokio::join!(
        call(&app, "POST", "/api/v1/walks/start", json!({})),
        call(&app, "POST", "/api/v1/walks/start", json!({}))
    );
    assert_eq!(a.0, StatusCode::OK);
    assert_eq!(b.0, StatusCode::OK);
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM walk WHERE ended_at IS NULL AND deleted_at IS NULL",
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(count, 1);
}
#[tokio::test]
async fn notification_cursor_observes_deduplication_and_dismissal() {
    let (_dir, app, _db) = fixture().await;
    let input = json!({"source_module":"walks","title":"Walk","body":"Finished","deep_link":"module/walks","dedupe_key":"same"});
    let (_, first) = call(&app, "POST", "/api/v1/notifications", input.clone()).await;
    let (_, second) = call(&app, "POST", "/api/v1/notifications", input).await;
    assert_eq!(first["id"], second["id"]);
    assert_ne!(first["revision"], second["revision"]);
    let (_, dismissed) = call(
        &app,
        "POST",
        "/api/v1/notifications/dismiss",
        json!({"id":first["id"]}),
    )
    .await;
    let (_, page) = call(
        &app,
        "GET",
        &format!(
            "/api/v1/notifications?since={}",
            second["revision"].as_str().unwrap()
        ),
        Value::Null,
    )
    .await;
    assert_eq!(page["items"][0]["id"], first["id"]);
    assert_eq!(page["cursor"], dismissed["revision"]);
    let (_, current) = call(&app, "GET", "/api/v1/notifications", Value::Null).await;
    assert_eq!(current["items"], json!([]));
    assert_eq!(
        call(&app, "GET", "/api/v1/notifications?since=-1", Value::Null)
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
}
#[tokio::test]
async fn settings_preserve_pin_without_exposing_it() {
    let (_dir, app, db) = fixture().await;
    sqlx::query("INSERT INTO settings VALUES('singleton',?,?)")
        .bind(
            json!({"pinCode":"123456","accent":"blue","timeZone":"America/Los_Angeles"})
                .to_string(),
        )
        .bind(www_server::now())
        .execute(&db)
        .await
        .unwrap();
    let (_, result) = call(&app, "PATCH", "/api/v1/settings", json!({"accent":"green"})).await;
    assert!(result.get("pinCode").is_none());
    let saved: String = sqlx::query_scalar("SELECT value FROM settings")
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&saved).unwrap()["pinCode"],
        "123456"
    );
    assert_eq!(
        call(
            &app,
            "PATCH",
            "/api/v1/settings",
            json!({"pinCode":"000000"})
        )
        .await
        .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
}
#[tokio::test]
async fn booth_upload_rejects_bad_bytes_and_removal_preserves_file() {
    let (dir, app, _db) = fixture().await;
    let request = |bytes: Vec<u8>| {
        Request::builder()
            .method("POST")
            .uri("/media/booth-photo")
            .header("authorization", format!("Bearer {TOKEN}"))
            .header("x-mode", "photo")
            .body(Body::from(bytes))
            .unwrap()
    };
    assert_eq!(
        app.clone()
            .oneshot(request(vec![0, 1, 2]))
            .await
            .unwrap()
            .status(),
        StatusCode::BAD_REQUEST
    );
    let r = app
        .clone()
        .oneshot(request(vec![0xff, 0xd8, 0xff, 0xe0]))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::CREATED);
    let saved: Value =
        serde_json::from_slice(&r.into_body().collect().await.unwrap().to_bytes()).unwrap();
    let file = dir
        .path()
        .join("media/booth-photos")
        .join(saved["path"].as_str().unwrap().rsplit('/').next().unwrap());
    assert!(file.exists());
    call(
        &app,
        "DELETE",
        &format!("/api/v1/booth/{}", saved["groupId"].as_str().unwrap()),
        Value::Null,
    )
    .await;
    assert!(file.exists());
    assert_eq!(
        call(&app, "GET", saved["path"].as_str().unwrap(), Value::Null)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
}
