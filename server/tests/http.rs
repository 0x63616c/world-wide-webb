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

#[tokio::test]
async fn weather_ingest_is_atomic_and_newest_forecast_wins() {
    use chrono::{Timelike, Utc};
    use www_server::features::weather::{Forecast, store_forecast};
    let (dir, app, db) = fixture().await;
    let s = AppState::new(db.clone(), dir.path().join("media"), TOKEN.into()).unwrap();
    let at = Utc::now();
    let hour = at
        .with_minute(0)
        .unwrap()
        .with_second(0)
        .unwrap()
        .with_nanosecond(0)
        .unwrap()
        .timestamp();
    let mut source = json!({"hourly":{"time":[hour],"temperature_2m":[70.0],"apparent_temperature":[69.0],
        "relative_humidity_2m":[50.0],"weather_code":[0],"wind_speed_10m":[5.0],"is_day":[1],
        "precipitation_probability":[0.0],"uv_index":[2.0]},
        "daily":{"time":[at.timestamp()],"temperature_2m_max":[76.0],"temperature_2m_min":[62.0],
        "weather_code":[0],"precipitation_probability_max":[0.0],"sunrise":[hour-3600],"sunset":[hour+3600]}});
    let tz = chrono_tz::America::Los_Angeles;
    let f: Forecast = serde_json::from_value(source.clone()).unwrap();
    store_forecast(&s, f, at, tz).await.unwrap();
    source["hourly"]["temperature_2m"] = json!([72.0]);
    store_forecast(
        &s,
        serde_json::from_value(source.clone()).unwrap(),
        at + chrono::Duration::seconds(1),
        tz,
    )
    .await
    .unwrap();
    let (status, body) = call(&app, "GET", "/api/v1/weather/hourly", Value::Null).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body.as_array().unwrap().len(), 1);
    assert_eq!(body[0]["temp"], 72);
    assert_eq!(
        call(&app, "GET", "/api/v1/weather/now", Value::Null)
            .await
            .0,
        StatusCode::OK
    );
    source["daily"]["temperature_2m_max"] = json!([]);
    assert!(
        store_forecast(&s, serde_json::from_value(source).unwrap(), at, tz)
            .await
            .is_err()
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM weather_reading")
            .fetch_one(&db)
            .await
            .unwrap(),
        2
    );
}

#[tokio::test]
async fn release_publication_is_monotonic_and_weather_has_no_fake_defaults() {
    let (_dir, app, _db) = fixture().await;
    assert_eq!(
        call(&app, "GET", "/api/v1/weather/now", Value::Null)
            .await
            .0,
        StatusCode::SERVICE_UNAVAILABLE
    );
    call(
        &app,
        "POST",
        "/api/v1/releases/latest",
        json!({"app":"panel","build":100}),
    )
    .await;
    let (status, body) = call(
        &app,
        "POST",
        "/api/v1/releases/latest",
        json!({"app":"panel","build":99}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["build"], 100);
    assert_eq!(
        call(
            &app,
            "GET",
            "/api/v1/releases/latest?app=panel",
            Value::Null
        )
        .await
        .1["build"],
        100
    );
}

#[tokio::test]
async fn ha_adapter_rejects_invalid_routes_and_never_retries() {
    use axum::routing::post;
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };
    use www_server::integrations::homeassistant::HomeAssistant;
    let calls = Arc::new(AtomicUsize::new(0));
    let counter = calls.clone();
    let app = Router::new().route(
        "/api/services/light/turn_on",
        post(move || {
            let c = counter.clone();
            async move {
                c.fetch_add(1, Ordering::SeqCst);
                StatusCode::SERVICE_UNAVAILABLE
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let ha = HomeAssistant::new(&format!("http://{addr}"), "fixture".into()).unwrap();
    assert!(
        ha.call("light", "turn_on", json!({"entity_id":"light.test"}))
            .await
            .is_err()
    );
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert!(ha.call("../light", "turn_on", json!({})).await.is_err());
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    task.abort();
}

#[tokio::test]
async fn climate_keeps_live_temperature_and_adopts_external_changes() {
    use axum::{
        Json,
        extract::Path,
        routing::{get, post},
    };
    use std::sync::{Arc, RwLock};
    use www_server::{
        config::Config, features::climate, integrations::homeassistant::HomeAssistant,
    };
    let (dir, _, db) = fixture().await;
    let live = Arc::new(RwLock::new(
        json!({"entity_id":"climate.home","state":"cool",
        "attributes":{"temperature":70,"current_temperature":73,"hvac_action":"idle","fan_mode":"auto","fan_modes":["auto","on"]}}),
    ));
    let calls = Arc::new(RwLock::new(Vec::<String>::new()));
    let read = live.clone();
    let mutate = live.clone();
    let called = calls.clone();
    let ha_app = Router::new()
        .route(
            "/api/states",
            get(move || {
                let x = read.clone();
                async move { Json(json!([x.read().unwrap().clone()])) }
            }),
        )
        .route(
            "/api/services/climate/{service}",
            post(
                move |Path(service): Path<String>, Json(body): Json<Value>| {
                    let x = mutate.clone();
                    let c = called.clone();
                    async move {
                        c.write().unwrap().push(service.clone());
                        if service == "set_temperature" {
                            x.write().unwrap()["attributes"]["temperature"] =
                                body["temperature"].clone();
                        }
                        Json(json!([]))
                    }
                },
            ),
        );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let task = tokio::spawn(async move { axum::serve(listener, ha_app).await.unwrap() });
    let mut s = AppState::new(db.clone(), dir.path().join("media"), TOKEN.into()).unwrap();
    s.config = Arc::new(Config {
        ha: Some(HomeAssistant::new(&format!("http://{addr}"), "fixture".into()).unwrap()),
        ..Default::default()
    });
    let mut last_fan = None;
    climate::reconcile(&s, &mut last_fan).await.unwrap();
    assert!(calls.read().unwrap().is_empty());
    let app = http::router(s.clone());
    assert_eq!(
        call(&app, "PATCH", "/api/v1/climate", json!({"target":72}))
            .await
            .0,
        StatusCode::OK
    );
    climate::reconcile(&s, &mut last_fan).await.unwrap();
    assert_eq!(
        *calls.read().unwrap(),
        vec!["set_temperature", "set_fan_mode"]
    );
    live.write().unwrap()["attributes"]["current_temperature"] = json!(74);
    climate::reconcile(&s, &mut last_fan).await.unwrap();
    let (_, body) = call(&app, "GET", "/api/v1/climate", Value::Null).await;
    assert_eq!(body["ambient"], 74.0);
    assert_eq!(body["target"], 72.0);
    sqlx::query("UPDATE device_state SET desired_until_utc='2000-01-01T00:00:00.000000Z' WHERE id='climate-thermostat'").execute(&db).await.unwrap();
    live.write().unwrap()["attributes"]["temperature"] = json!(71);
    climate::reconcile(&s, &mut last_fan).await.unwrap();
    assert_eq!(calls.read().unwrap().len(), 2);
    assert_eq!(
        call(&app, "GET", "/api/v1/climate", Value::Null).await.1["target"],
        71.0
    );
    task.abort();
}

#[tokio::test]
async fn lights_enforce_lamps_but_adopt_wall_switches_and_honor_fresh_commands() {
    use axum::{
        Json,
        extract::Path,
        routing::{get, post},
    };
    use std::sync::{Arc, RwLock};
    use www_server::{
        config::Config, features::lights, integrations::homeassistant::HomeAssistant,
    };
    let (dir, _, db) = fixture().await;
    let live = Arc::new(RwLock::new(json!([
        {"entity_id":"light.living_room_globe","state":"on","attributes":{"brightness":128,"color_mode":"xy","xy_color":[0.2,0.3]}},
        {"entity_id":"switch.overhead_lights","state":"on","attributes":{}}
    ])));
    let calls = Arc::new(RwLock::new(Vec::<(String, Value)>::new()));
    let read = live.clone();
    let called = calls.clone();
    let ha_app = Router::new()
        .route(
            "/api/states",
            get(move || {
                let x = read.clone();
                async move { Json(x.read().unwrap().clone()) }
            }),
        )
        .route(
            "/api/services/{domain}/{service}",
            post(
                move |Path((domain, service)): Path<(String, String)>, Json(body): Json<Value>| {
                    let c = called.clone();
                    async move {
                        c.write()
                            .unwrap()
                            .push((format!("{domain}/{service}"), body));
                        Json(json!([]))
                    }
                },
            ),
        );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let task = tokio::spawn(async move { axum::serve(listener, ha_app).await.unwrap() });
    let mut s = AppState::new(db.clone(), dir.path().join("media"), TOKEN.into()).unwrap();
    s.config = Arc::new(Config {
        ha: Some(HomeAssistant::new(&format!("http://{addr}"), "fixture".into()).unwrap()),
        ..Default::default()
    });
    lights::reconcile(&s).await.unwrap();
    assert!(calls.read().unwrap().is_empty());
    live.write().unwrap()[0]["state"] = json!("off");
    live.write().unwrap()[1]["state"] = json!("off");
    lights::reconcile(&s).await.unwrap();
    assert_eq!(calls.read().unwrap().len(), 1);
    assert_eq!(calls.read().unwrap()[0].0, "light/turn_on");
    let app = http::router(s.clone());
    let (_, body) = call(&app, "GET", "/api/v1/controls", Value::Null).await;
    assert_eq!(body["lamps"]["on"], true);
    assert_eq!(body["ceiling"]["on"], false);
    assert_eq!(body["all"]["on"], false);
    assert_eq!(
        call(
            &app,
            "POST",
            "/api/v1/controls",
            json!({"action":"toggle","key":"ceiling","on":true})
        )
        .await
        .0,
        StatusCode::OK
    );
    lights::reconcile(&s).await.unwrap();
    assert!(
        calls
            .read()
            .unwrap()
            .iter()
            .any(|c| c.0 == "switch/turn_on")
    );
    // A failed group update rolls back its mode/desired changes; absent devices cannot report fake success.
    let before: String =
        sqlx::query_scalar("SELECT desired_state FROM device_state WHERE id='living-globe'")
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(
        call(
            &app,
            "POST",
            "/api/v1/controls",
            json!({"action":"scene","scene":"red"})
        )
        .await
        .0,
        StatusCode::SERVICE_UNAVAILABLE
    );
    let after: String =
        sqlx::query_scalar("SELECT desired_state FROM device_state WHERE id='living-globe'")
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(before, after);
    task.abort();
}
