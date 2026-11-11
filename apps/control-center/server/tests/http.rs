use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tower::ServiceExt;
use www_server::{AppState, http, storage};
const RELEASE_TOKEN: &str = "fixture-release-only-token-32-bytes";
async fn fixture() -> (tempfile::TempDir, Router, sqlx::SqlitePool) {
    let dir = tempfile::tempdir().unwrap();
    let db = storage::open(&dir.path().join("test.sqlite"))
        .await
        .unwrap();
    let mut state = AppState::new(db.clone(), dir.path().join("media"));
    state.config = std::sync::Arc::new(www_server::config::Config {
        release_token: Some(RELEASE_TOKEN.into()),
        ..Default::default()
    });
    (dir, http::router(state), db)
}
async fn call(app: &Router, method: &str, path: &str, body: Value) -> (StatusCode, Value) {
    let mut request = Request::builder().method(method).uri(path);
    if method == "POST" && path == "/api/v1/releases/latest" {
        request = request.header("authorization", format!("Bearer {RELEASE_TOKEN}"));
    }
    let request = request
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
async fn tailnet_api_requires_no_app_credentials_and_health_is_real() {
    let (_dir, app, db) = fixture().await;
    let r = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/settings")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK);
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
async fn retired_walk_routes_are_unavailable() {
    let (_dir, app, _db) = fixture().await;
    for (method, path) in [
        ("GET", "/api/v1/walks/state"),
        ("GET", "/api/v1/walks/history"),
        ("POST", "/api/v1/walks/start"),
        ("POST", "/api/v1/walks/stop"),
        ("DELETE", "/api/v1/walks/historic"),
        ("PATCH", "/api/v1/walks/historic"),
    ] {
        assert_eq!(
            call(&app, method, path, Value::Null).await.0,
            StatusCode::NOT_FOUND
        );
    }
}
#[tokio::test]
async fn notification_cursor_observes_deduplication_and_dismissal() {
    let (_dir, app, _db) = fixture().await;
    let input = json!({"source_module":"calendar","title":"Event","body":"Soon","deep_link":"module/calendar","dedupe_key":"same"});
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
    let s = AppState::new(db.clone(), dir.path().join("media"));
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
    let mut s = AppState::new(db.clone(), dir.path().join("media"));
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
    assert_eq!(body["action"], "Idle");
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
    let mut s = AppState::new(db.clone(), dir.path().join("media"));
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

#[tokio::test]
async fn sound_uses_fresh_topology_and_persists_calibration_without_touching_zero_rooms() {
    use axum::{
        Json,
        extract::Path,
        routing::{get, post},
    };
    use std::sync::{Arc, RwLock};
    use www_server::{config::Config, integrations::homeassistant::HomeAssistant};
    let (dir, _, db) = fixture().await;
    let live = Arc::new(RwLock::new(json!([
        {"entity_id":"media_player.desk","state":"playing","attributes":{"friendly_name":"Desk","group_members":["media_player.desk","media_player.bedroom"],"volume_level":0.6,"source":"Spotify","media_title":"Actual title","media_position":12,"media_duration":120,"media_position_updated_at":"2026-11-07T12:00:00Z"}},
        {"entity_id":"media_player.bedroom","state":"paused","attributes":{"friendly_name":"Bedroom","group_members":["media_player.desk","media_player.bedroom"],"volume_level":0.0}},
        {"entity_id":"media_player.television","state":"playing","attributes":{"friendly_name":"TV"}}
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
    let mut state = AppState::new(db.clone(), dir.path().join("media"));
    state.config = Arc::new(Config {
        ha: Some(HomeAssistant::new(&format!("http://{addr}"), "fixture".into()).unwrap()),
        ..Default::default()
    });
    let app = http::router(state);
    sqlx::query(
        "INSERT INTO sound_calibration VALUES('media_player.bedroom',40,'2026-11-07T00:00:00Z')",
    )
    .execute(&db)
    .await
    .unwrap();
    let (status, body) = call(&app, "GET", "/api/v1/sound", Value::Null).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["rooms"].as_array().unwrap().len(), 2);
    assert_eq!(body["rooms"][1]["trackTitle"], "Actual title");
    assert_eq!(body["rooms"][1]["transportState"], "PLAYING");
    assert_eq!(body["rooms"][1]["volume"], 0);
    assert_eq!(body["rooms"][1]["position"], 12.0);
    let (status, calibration) = call(&app, "POST", "/api/v1/sound/calibration", json!({})).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(calibration["media_player.desk"], 120);
    assert!(calibration.get("media_player.bedroom").is_none());
    let (_, body) = call(&app, "GET", "/api/v1/sound", Value::Null).await;
    assert_eq!(body["rooms"][1]["baseline"], 40);
    live.write().unwrap()[1]["attributes"]["group_members"] = json!(["media_player.bedroom"]);
    let (_, body) = call(&app, "GET", "/api/v1/sound", Value::Null).await;
    assert_eq!(body["rooms"][1]["isCoordinator"], true);
    // Invalid group members are rejected before selecting TV or making any write.
    assert_eq!(
        call(
            &app,
            "POST",
            "/api/v1/sound",
            json!({"action":"tv","room":"media_player.desk","members":["media_player.television"]})
        )
        .await
        .0,
        StatusCode::SERVICE_UNAVAILABLE
    );
    assert!(calls.read().unwrap().is_empty());
    assert_eq!(
        call(
            &app,
            "POST",
            "/api/v1/sound",
            json!({"action":"volume","room":"media_player.desk","volume":101})
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert!(calls.read().unwrap().is_empty());
    assert_eq!(call(&app,"POST","/api/v1/sound",json!({"action":"join","coordinator":"media_player.desk","members":["media_player.bedroom"]})).await.0,StatusCode::OK);
    assert_eq!(
        call(
            &app,
            "POST",
            "/api/v1/sound",
            json!({"action":"seek","room":"media_player.desk","positionSeconds":15.5})
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(calls.read().unwrap().len(), 2);
    assert_eq!(
        calls.read().unwrap()[0],
        (
            "media_player/join".into(),
            json!({"entity_id":"media_player.desk","group_members":["media_player.bedroom"]})
        )
    );
    assert_eq!(calls.read().unwrap()[1].1["seek_position"], 15.5);
    call(&app, "DELETE", "/api/v1/sound/calibration", Value::Null).await;
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sound_calibration")
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(count, 0);
    task.abort();
}

#[tokio::test]
async fn tesla_converts_real_telemetry_keeps_snapshot_and_checks_pin_before_commands() {
    use axum::{
        Json,
        extract::Path,
        routing::{get, post},
    };
    use std::sync::{Arc, RwLock};
    use www_server::{config::Config, integrations::homeassistant::HomeAssistant};
    let (dir, _, db) = fixture().await;
    let live = Arc::new(RwLock::new(json!([
        {"entity_id":"sensor.evee_battery_level","state":"72","attributes":{"unit_of_measurement":"%"}},
        {"entity_id":"sensor.evee_battery_range","state":"321.8688","attributes":{"unit_of_measurement":"km"}},
        {"entity_id":"sensor.evee_charging","state":"NoPower","attributes":{}},
        {"entity_id":"sensor.evee_charger_power","state":"7000","attributes":{"unit_of_measurement":"W"}},
        {"entity_id":"sensor.evee_odometer","state":"16093.44","attributes":{"unit_of_measurement":"km"}},
        {"entity_id":"sensor.evee_inside_temperature","state":"20","attributes":{"unit_of_measurement":"°C"}},
        {"entity_id":"lock.evee_lock","state":"locked","attributes":{}},
        {"entity_id":"climate.evee_climate","state":"off","attributes":{}},
        {"entity_id":"switch.evee_charge","state":"off","attributes":{}},
        {"entity_id":"sensor.evee_shift_state","state":"D","attributes":{}},
        {"entity_id":"update.evee_software_update","state":"on","attributes":{"installed_version":"old","latest_version":"new"}}
    ])));
    let calls = Arc::new(RwLock::new(Vec::<(String, Value)>::new()));
    let read = live.clone();
    let called = calls.clone();
    let ha_app = Router::new()
        .route(
            "/api/states",
            get(move || {
                let r = read.clone();
                async move { Json(r.read().unwrap().clone()) }
            }),
        )
        .route(
            "/api/services/{domain}/{service}",
            post(
                move |Path((d, s)): Path<(String, String)>, Json(v): Json<Value>| {
                    let c = called.clone();
                    async move {
                        c.write().unwrap().push((format!("{d}/{s}"), v));
                        Json(json!([]))
                    }
                },
            ),
        );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let task = tokio::spawn(async move { axum::serve(listener, ha_app).await.unwrap() });
    let mut state = AppState::new(db.clone(), dir.path().join("media"));
    state.config = Arc::new(Config {
        ha: Some(HomeAssistant::new(&format!("http://{addr}"), "fixture".into()).unwrap()),
        ..Default::default()
    });
    let app = http::router(state);
    let (status, body) = call(&app, "GET", "/api/v1/tesla", Value::Null).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "ready");
    assert_eq!(body["stale"], false);
    assert!((body["data"]["rangeMiles"].as_f64().unwrap() - 200.0).abs() < 0.001);
    assert!((body["data"]["odometerMiles"].as_f64().unwrap() - 10000.0).abs() < 0.001);
    assert_eq!(body["data"]["chargePowerKW"], 7.0);
    assert_eq!(body["data"]["cabinFahrenheit"], 68.0);
    assert_eq!(body["data"]["driveState"], "driving");
    assert_eq!(body["data"]["chargingState"], "no_power");
    assert_eq!(body["data"]["softwareUpdate"]["status"], "available");
    // Neither a missing PIN configuration nor a wrong PIN can actuate the car.
    assert_eq!(
        call(
            &app,
            "POST",
            "/api/v1/tesla/commands",
            json!({"action":"unlock","pin":"123456"})
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    sqlx::query("INSERT INTO settings(id,value,updated_at_utc) VALUES('singleton',?,?)")
        .bind(json!({"pinCode":"654321"}).to_string())
        .bind("2026-11-07T00:00:00Z")
        .execute(&db)
        .await
        .unwrap();
    assert_eq!(
        call(
            &app,
            "POST",
            "/api/v1/tesla/commands",
            json!({"action":"unlock","pin":"123456"})
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert!(calls.read().unwrap().is_empty());
    assert_eq!(
        call(
            &app,
            "POST",
            "/api/v1/tesla/commands",
            json!({"action":"unlock","pin":"654321"})
        )
        .await
        .1["accepted"],
        true
    );
    assert_eq!(
        calls.read().unwrap()[0],
        ("lock/unlock".into(), json!({"entity_id":"lock.evee_lock"}))
    );
    live.write().unwrap()[0]["state"] = json!("unavailable");
    let (_, cached) = call(&app, "GET", "/api/v1/tesla", Value::Null).await;
    assert_eq!(cached["status"], "ready");
    assert_eq!(cached["stale"], true);
    assert_eq!(cached["data"], body["data"]);
    // Missing discovery prevents commands even though a cached display is available.
    *live.write().unwrap() = json!([]);
    assert_eq!(
        call(
            &app,
            "POST",
            "/api/v1/tesla/commands",
            json!({"action":"unlock","pin":"654321"})
        )
        .await
        .0,
        StatusCode::SERVICE_UNAVAILABLE
    );
    assert_eq!(calls.read().unwrap().len(), 1);
    task.abort();
}

#[tokio::test]
async fn bedroom_input_edges_are_atomic_debounced_and_never_replayed_after_restart() {
    use www_server::{features::lights::BedroomInput, integrations::homeassistant::Entity};
    let (dir, _, db) = fixture().await;
    let state = AppState::new(db.clone(), dir.path().join("media"));
    for (id, entity) in [
        ("bed-left", "light.bed_lamp_left"),
        ("bed-right", "light.bed_lamp_right"),
        ("mirror", "light.mirror"),
    ] {
        sqlx::query("INSERT INTO device_state(id,kind,entity_id,domain,label,desired_state,created_at_utc,updated_at_utc) VALUES(?,'light',?,'light',?,'{\"on\":false,\"brightness\":128}',?,?)").bind(id).bind(entity).bind(id).bind("2026-11-07T00:00:00Z").bind("2026-11-07T00:00:00Z").execute(&db).await.unwrap();
    }
    let id = "binary_sensor.bedroom_input";
    let sample = |on: bool, time: &str| -> Entity {
        serde_json::from_value(json!({"entity_id":id,"state":if on{"on"}else{"off"},"attributes":{},"last_changed":time})).unwrap()
    };
    let base = sample(false, "2026-11-07T10:00:00Z");
    let a = sample(true, "2026-11-07T10:00:01.000001Z");
    let bounce = sample(false, "2026-11-07T10:00:01.100001Z");
    let b = sample(true, "2026-11-07T10:00:01.250001Z");
    let on_count = || async {
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM device_state WHERE json_extract(desired_state,'$.on')=1",
        )
        .fetch_one(&db)
        .await
        .unwrap()
    };
    let mut input = BedroomInput::default();
    input
        .sample(&state, id, Some(&base), true, None)
        .await
        .unwrap();
    assert_eq!(on_count().await, 0);
    input
        .sample(&state, id, Some(&a), false, Some(&base))
        .await
        .unwrap();
    assert_eq!(on_count().await, 3);
    input
        .sample(&state, id, Some(&bounce), false, Some(&a))
        .await
        .unwrap();
    assert_eq!(on_count().await, 3);
    input
        .sample(&state, id, Some(&b), false, Some(&bounce))
        .await
        .unwrap();
    assert_eq!(on_count().await, 0);
    // Same durable snapshot on a new connection establishes continuity without replaying it.
    let mut input = BedroomInput::default();
    input
        .sample(&state, id, Some(&b), true, None)
        .await
        .unwrap();
    assert_eq!(on_count().await, 0);
    let c = sample(false, "2026-11-07T10:00:02.000001Z");
    // Force a failure after lamp updates; checkpoint and all lamp intents must roll back.
    sqlx::query("CREATE TRIGGER fail_checkpoint BEFORE UPDATE ON input_checkpoint BEGIN SELECT RAISE(ABORT,'fixture'); END").execute(&db).await.unwrap();
    assert!(
        input
            .sample(&state, id, Some(&c), false, Some(&b))
            .await
            .is_err()
    );
    assert_eq!(on_count().await, 0);
    sqlx::query("DROP TRIGGER fail_checkpoint")
        .execute(&db)
        .await
        .unwrap();
    input
        .sample(&state, id, Some(&c), false, Some(&b))
        .await
        .unwrap();
    assert_eq!(on_count().await, 3);
    input
        .sample(&state, id, Some(&a), false, Some(&base))
        .await
        .unwrap();
    assert_eq!(on_count().await, 3);
    input.sample(&state, id, None, false, None).await.unwrap();
    let d = sample(true, "2026-11-07T10:00:03Z");
    input
        .sample(&state, id, Some(&d), false, Some(&c))
        .await
        .unwrap();
    assert_eq!(on_count().await, 3);
}

#[tokio::test]
async fn bedroom_websocket_subscribes_before_snapshot_and_ignores_early_events() {
    use futures_util::{SinkExt, StreamExt};
    use std::sync::Arc;
    use tokio_tungstenite::tungstenite::Message;
    use www_server::{
        config::Config, features::bedroom_input, integrations::homeassistant::HomeAssistant,
    };
    let (dir, _, db) = fixture().await;
    let id = "binary_sensor.bedroom_input";
    let entity =
        |time: &str| json!({"entity_id":id,"state":"off","attributes":{},"last_changed":time});
    let baseline = entity("2026-11-07T10:00:00Z");
    let early = entity("2026-11-07T09:00:00Z");
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let task = tokio::spawn(async move {
        let (tcp, _) = listener.accept().await.unwrap();
        let mut ws = tokio_tungstenite::accept_async(tcp).await.unwrap();
        ws.send(Message::Text(
            json!({"type":"auth_required"}).to_string().into(),
        ))
        .await
        .unwrap();
        let read = ws.next().await.unwrap().unwrap();
        let auth: Value = serde_json::from_str(read.to_text().unwrap()).unwrap();
        assert_eq!(auth["type"], "auth");
        assert_eq!(auth["access_token"], "fixture");
        ws.send(Message::Text(json!({"type":"auth_ok"}).to_string().into()))
            .await
            .unwrap();
        let read = ws.next().await.unwrap().unwrap();
        let subscribe: Value = serde_json::from_str(read.to_text().unwrap()).unwrap();
        assert_eq!(
            subscribe,
            json!({"id":1,"type":"subscribe_events","event_type":"state_changed"})
        );
        ws.send(Message::Text(
            json!({"type":"result","id":1,"success":true})
                .to_string()
                .into(),
        ))
        .await
        .unwrap();
        let read = ws.next().await.unwrap().unwrap();
        let snapshot: Value = serde_json::from_str(read.to_text().unwrap()).unwrap();
        assert_eq!(snapshot, json!({"id":2,"type":"get_states"}));
        ws.send(Message::Text(json!({"type":"event","id":1,"event":{"data":{"entity_id":id,"new_state":early,"old_state":null}}}).to_string().into())).await.unwrap();
        ws.send(Message::Text(
            json!({"type":"result","id":2,"success":true,"result":[baseline]})
                .to_string()
                .into(),
        ))
        .await
        .unwrap();
        ws.close(None).await.unwrap();
    });
    let mut state = AppState::new(db.clone(), dir.path().join("media"));
    state.config = Arc::new(Config {
        ha: Some(HomeAssistant::new(&format!("http://{addr}"), "fixture".into()).unwrap()),
        ..Default::default()
    });
    assert!(
        tokio::time::timeout(
            std::time::Duration::from_secs(3),
            bedroom_input::session(&state, id)
        )
        .await
        .unwrap()
        .is_err()
    );
    task.await.unwrap();
    let raw: String = sqlx::query_scalar("SELECT value FROM input_checkpoint WHERE entity_id=?")
        .bind(id)
        .fetch_one(&db)
        .await
        .unwrap();
    let saved: Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(saved["changed"], "2026-11-07T10:00:00.000000Z");
    assert!(saved["actedAt"].is_null());
}

#[tokio::test]
async fn slow_alarm_lights_do_not_hold_the_sqlite_writer_or_delay_other_rings() {
    use axum::{
        Json,
        routing::{get, post},
    };
    use std::sync::Arc;
    use www_server::{
        config::Config, features::alarms, integrations::homeassistant::HomeAssistant,
    };
    let (dir, _, db) = fixture().await;
    let entered = Arc::new(tokio::sync::Notify::new());
    let release = Arc::new(tokio::sync::Notify::new());
    let (seen, unblock) = (entered.clone(), release.clone());
    let ha_app = Router::new()
        .route("/api/states", get(|| async { Json(json!([])) }))
        .route(
            "/api/services/light/turn_on",
            post(move || {
                let seen = seen.clone();
                let unblock = unblock.clone();
                async move {
                    seen.notify_one();
                    unblock.notified().await;
                    Json(json!([]))
                }
            }),
        );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let task = tokio::spawn(async move { axum::serve(listener, ha_app).await.unwrap() });
    let mut s = AppState::new(db.clone(), dir.path().join("media"));
    s.config = Arc::new(Config {
        ha: Some(HomeAssistant::new(&format!("http://{addr}"), "fixture".into()).unwrap()),
        ..Default::default()
    });
    let start = chrono::DateTime::parse_from_rfc3339("2026-11-07T10:00:00Z")
        .unwrap()
        .with_timezone(&chrono::Utc);
    let due = start + chrono::Duration::minutes(1);
    for (n, at) in [(0, due), (1, due + chrono::Duration::minutes(1))] {
        let def=serde_json::from_value(json!({"label":format!("alarm {n}"),"timeZone":"UTC","at":at.to_rfc3339(),"lightTarget":"light.bed_lamp_left"})).unwrap();
        let _ = alarms::create_at(&s, def, None, start).await.unwrap();
    }
    assert_eq!(alarms::claim_due(&s, due).await.unwrap(), 1);
    let state = s.clone();
    let delivery = tokio::spawn(async move { alarms::deliver_lights(&state, due).await });
    tokio::time::timeout(std::time::Duration::from_secs(2), entered.notified())
        .await
        .unwrap();
    // An actual pending HTTP call is holding the delivery gate here.
    assert_eq!(
        tokio::time::timeout(
            std::time::Duration::from_millis(250),
            alarms::claim_due(&s, due + chrono::Duration::minutes(1))
        )
        .await
        .unwrap()
        .unwrap(),
        1
    );
    release.notify_one();
    delivery.await.unwrap().unwrap();
    let delivered: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM alarm_ring WHERE lights_delivered_at IS NOT NULL")
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(delivered, 1);
    let brightness:f64=sqlx::query_scalar("SELECT json_extract(desired_state,'$.brightness') FROM device_state WHERE entity_id='light.bed_lamp_left'").fetch_one(&db).await.unwrap();
    assert_eq!(brightness, 180.0);
    task.abort();
}

#[tokio::test]
async fn pin_verification_and_replacement_never_expose_digits_in_settings() {
    let (_dir, app, db) = fixture().await;
    sqlx::query("INSERT INTO settings VALUES('singleton',?,?)")
        .bind(json!({"pinCode":"123456","accent":"blue"}).to_string())
        .bind("2026-11-07T00:00:00Z")
        .execute(&db)
        .await
        .unwrap();
    assert_eq!(
        call(
            &app,
            "POST",
            "/api/v1/settings/pin/verify",
            json!({"pin":"123456"})
        )
        .await
        .1["verified"],
        true
    );
    assert_eq!(
        call(
            &app,
            "POST",
            "/api/v1/settings/pin/verify",
            json!({"pin":"654321"})
        )
        .await
        .1["verified"],
        false
    );
    assert_eq!(
        call(
            &app,
            "PATCH",
            "/api/v1/settings/pin",
            json!({"current":"654321","replacement":"111111"})
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(
            &app,
            "PATCH",
            "/api/v1/settings/pin",
            json!({"current":"123456","replacement":"654321"})
        )
        .await
        .1["changed"],
        true
    );
    let (_, value) = call(&app, "GET", "/api/v1/settings", Value::Null).await;
    assert!(value.get("pinCode").is_none());
    assert_eq!(value["accent"], "blue");
    assert_eq!(
        call(
            &app,
            "POST",
            "/api/v1/settings/pin/verify",
            json!({"pin":"123456"})
        )
        .await
        .1["verified"],
        false
    );
}
#[tokio::test]
async fn diagnostics_accept_only_redacted_bounded_support_evidence() {
    let (_dir, app, _) = fixture().await;
    let submission = json!({"snapshot":{"source":"live","backendURL":"https://api.example.invalid","build":"123","gitSHA":"abcdef0","backend":"reachable","latencyMs":12,"homeAssistant":"connected"},"commands":[{"control":"controls","payload":{"on":"1","key":"<redacted>"},"status":200,"error":null,"latencyMs":12}]});
    assert_eq!(
        call(&app, "POST", "/api/v1/diagnostics", submission.clone())
            .await
            .1["accepted"],
        true
    );
    let mut bad = submission.clone();
    bad["commands"][0]["payload"]["key"] = json!("private-text");
    assert_eq!(
        call(&app, "POST", "/api/v1/diagnostics", bad).await.0,
        StatusCode::BAD_REQUEST
    );
    let mut bad = submission.clone();
    bad["snapshot"]["backendURL"] = json!("https://api.example.invalid/?token=private");
    assert_eq!(
        call(&app, "POST", "/api/v1/diagnostics", bad).await.0,
        StatusCode::BAD_REQUEST
    );
    for _ in 0..22 {
        assert_eq!(
            call(&app, "POST", "/api/v1/diagnostics", submission.clone())
                .await
                .0,
            StatusCode::OK
        );
    }
    assert_eq!(
        call(&app, "GET", "/api/v1/diagnostics", Value::Null)
            .await
            .1
            .as_array()
            .unwrap()
            .len(),
        20
    );
}

#[tokio::test]
async fn release_publication_still_requires_the_automation_credential() {
    let (_, app, _) = fixture().await;
    let request = Request::builder()
        .method("POST")
        .uri("/api/v1/releases/latest")
        .header("content-type", "application/json")
        .body(Body::from(json!({"app":"panel","build":123}).to_string()))
        .unwrap();
    assert_eq!(
        app.oneshot(request).await.unwrap().status(),
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn late_alarm_claim_preserves_native_scheduled_occurrence() {
    use www_server::features::alarms;
    let (dir, _, db) = fixture().await;
    let state = AppState::new(db.clone(), dir.path().join("media"));
    let start = chrono::DateTime::parse_from_rfc3339("2026-11-07T10:00:00Z")
        .unwrap()
        .with_timezone(&chrono::Utc);
    let due = start + chrono::Duration::minutes(1);
    let def = serde_json::from_value(
        json!({"label":"Native occurrence", "timeZone":"UTC", "at":due.to_rfc3339()}),
    )
    .unwrap();
    let _ = alarms::create_at(&state, def, None, start).await.unwrap();
    assert_eq!(
        alarms::claim_due(&state, due + chrono::Duration::milliseconds(375))
            .await
            .unwrap(),
        1
    );
    let (scheduled, ring): (String, String) =
        sqlx::query_as("SELECT scheduled_at,ring_at FROM alarm_ring")
            .fetch_one(&db)
            .await
            .unwrap();
    assert_eq!(
        ring, scheduled,
        "native intents match the original scheduled instant"
    );
    assert_eq!(
        alarms::claim_due(&state, due + chrono::Duration::seconds(1))
            .await
            .unwrap(),
        0
    );
}
