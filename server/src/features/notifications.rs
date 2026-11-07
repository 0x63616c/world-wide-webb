use crate::{
    AppState,
    http::{ApiError, Result},
    id, now,
};
use axum::{
    Json,
    extract::{Query, State},
    http::HeaderMap,
    response::sse::{Event, KeepAlive, Sse},
};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqliteConnection};

fn normal() -> String {
    "normal".into()
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Input {
    pub source_module: String,
    pub title: String,
    pub body: String,
    pub deep_link: String,
    #[serde(default = "normal")]
    pub priority: String,
    pub dedupe_key: Option<String>,
}
#[derive(Serialize, FromRow)]
pub struct Notification {
    id: String,
    source_module: String,
    title: String,
    body: String,
    deep_link: String,
    priority: String,
    dedupe_key: Option<String>,
    created_at: String,
    updated_at: String,
    read_at: Option<String>,
    dismissed_at: Option<String>,
    #[serde(serialize_with = "revision_string")]
    revision: i64,
}
fn revision_string<S: serde::Serializer>(v: &i64, s: S) -> std::result::Result<S::Ok, S::Error> {
    s.serialize_str(&v.to_string())
}
fn valid(v: &Input) -> bool {
    !v.title.trim().is_empty()
        && v.title.chars().count() <= 200
        && v.body.chars().count() <= 4000
        && !v.source_module.is_empty()
        && v.source_module.len() <= 64
        && v.source_module.as_bytes()[0].is_ascii_lowercase()
        && v.source_module
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_' || c == b'-')
        && v.deep_link.len() <= 512
        && v.deep_link.strip_prefix("module/").is_some_and(|p| {
            !p.is_empty()
                && p.split('/').all(|s| {
                    !s.is_empty()
                        && s.bytes()
                            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
                })
        })
        && ["low", "normal", "high", "critical"].contains(&v.priority.as_str())
        && v.dedupe_key
            .as_ref()
            .is_none_or(|k| !k.is_empty() && k.chars().count() <= 200)
}
async fn revision(conn: &mut SqliteConnection) -> Result<i64> {
    Ok(sqlx::query_scalar("UPDATE notification_revision SET value=MAX(value,(SELECT COALESCE(MAX(revision),0) FROM notifications))+1 WHERE id=1 RETURNING value").fetch_one(conn).await?)
}
pub async fn insert(conn: &mut SqliteConnection, v: Input) -> Result<Notification> {
    if !valid(&v) {
        return Err(ApiError::bad("Invalid notification"));
    }
    let rev = revision(conn).await?;
    let at = now();
    Ok(sqlx::query_as("INSERT INTO notifications(id,source_module,title,body,deep_link,priority,dedupe_key,created_at,updated_at,revision) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source_module,dedupe_key) WHERE dismissed_at IS NULL DO UPDATE SET title=excluded.title,body=excluded.body,deep_link=excluded.deep_link,priority=excluded.priority,created_at=excluded.created_at,updated_at=excluded.updated_at,read_at=NULL,revision=excluded.revision RETURNING *")
        .bind(id("ntf")).bind(v.source_module).bind(v.title.trim()).bind(v.body).bind(v.deep_link).bind(v.priority).bind(v.dedupe_key).bind(&at).bind(&at).bind(rev).fetch_one(conn).await?)
}
pub async fn create(State(s): State<AppState>, Json(v): Json<Input>) -> Result<Json<Notification>> {
    let mut tx = s.db.begin().await?;
    let row = insert(&mut tx, v).await?;
    tx.commit().await?;
    Ok(Json(row))
}
#[derive(Default, Deserialize)]
pub struct List {
    since: Option<String>,
    unread: Option<bool>,
    limit: Option<u32>,
}
#[derive(Serialize)]
pub struct Page {
    items: Vec<Notification>,
    cursor: String,
    has_more: bool,
}
fn cursor(raw: Option<&str>) -> Result<Option<i64>> {
    raw.map(|s| {
        if s.is_empty()
            || !s.bytes().all(|c| c.is_ascii_digit())
            || (s.len() > 1 && s.starts_with('0'))
        {
            return Err(ApiError::bad("Invalid cursor"));
        }
        s.parse::<i64>()
            .map_err(|_| ApiError::bad("Invalid cursor"))
    })
    .transpose()
}
async fn page(s: &AppState, q: List) -> Result<Page> {
    let since = cursor(q.since.as_deref())?;
    let limit = q.limit.unwrap_or(100);
    if !(1..=200).contains(&limit) {
        return Err(ApiError::bad("limit must be 1...200"));
    }
    let mut items:Vec<Notification>=sqlx::query_as("SELECT * FROM notifications WHERE ((? IS NULL AND dismissed_at IS NULL) OR (? IS NOT NULL AND revision>?)) AND (? IS NULL OR (?=1 AND read_at IS NULL AND dismissed_at IS NULL) OR (?=0 AND read_at IS NOT NULL)) ORDER BY revision LIMIT ?")
        .bind(since).bind(since).bind(since).bind(q.unread).bind(q.unread).bind(q.unread).bind(limit+1).fetch_all(&s.db).await?;
    let has_more = items.len() > limit as usize;
    items.truncate(limit as usize);
    let cursor = items
        .last()
        .map_or(since.unwrap_or(0), |n| n.revision)
        .to_string();
    Ok(Page {
        items,
        cursor,
        has_more,
    })
}
pub async fn list(State(s): State<AppState>, Query(q): Query<List>) -> Result<Json<Page>> {
    Ok(Json(page(&s, q).await?))
}
#[derive(Deserialize)]
pub struct Key {
    id: String,
}
async fn act(s: AppState, key: String, read: bool) -> Result<Json<Notification>> {
    let mut tx = s.db.begin().await?;
    let rev = revision(&mut tx).await?;
    let sql = if read {
        "UPDATE notifications SET read_at=COALESCE(read_at,?),updated_at=?,revision=? WHERE id=? RETURNING *"
    } else {
        "UPDATE notifications SET dismissed_at=COALESCE(dismissed_at,?),updated_at=?,revision=? WHERE id=? RETURNING *"
    };
    let row = sqlx::query_as(sql)
        .bind(now())
        .bind(now())
        .bind(rev)
        .bind(key)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(ApiError::not_found)?;
    tx.commit().await?;
    Ok(Json(row))
}
pub async fn read(State(s): State<AppState>, Json(k): Json<Key>) -> Result<Json<Notification>> {
    act(s, k.id, true).await
}
pub async fn dismiss(State(s): State<AppState>, Json(k): Json<Key>) -> Result<Json<Notification>> {
    act(s, k.id, false).await
}
pub async fn dismiss_all(State(s): State<AppState>) -> Result<Json<serde_json::Value>> {
    let mut tx = s.db.begin().await?;
    let keys: Vec<String> =
        sqlx::query_scalar("SELECT id FROM notifications WHERE dismissed_at IS NULL")
            .fetch_all(&mut *tx)
            .await?;
    for key in &keys {
        let rev = revision(&mut tx).await?;
        sqlx::query("UPDATE notifications SET dismissed_at=?,updated_at=?,revision=? WHERE id=?")
            .bind(now())
            .bind(now())
            .bind(rev)
            .bind(key)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(Json(serde_json::json!({"dismissed":keys.len()})))
}
pub async fn stream(
    State(s): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<List>,
) -> Result<Sse<impl futures_core::Stream<Item = std::result::Result<Event, std::io::Error>>>> {
    let mut since = headers
        .get("last-event-id")
        .and_then(|h| h.to_str().ok())
        .map(str::to_owned)
        .or(q.since);
    cursor(since.as_deref())?;
    let stream = async_stream::try_stream! {
        let started=tokio::time::Instant::now();let mut first=true;
        while started.elapsed()<std::time::Duration::from_secs(55) {
            let p=page(&s,List{since:since.clone(),unread:None,limit:Some(200)}).await.map_err(|_|std::io::Error::other("notification stream unavailable"))?;
            since=Some(p.cursor.clone());let more=p.has_more;
            if first||!p.items.is_empty() {
                let event=Event::default().id(&p.cursor).event("notifications").json_data(&p).map_err(std::io::Error::other)?;
                yield event;
            }
            first=false;
            if !more {tokio::time::sleep(std::time::Duration::from_secs(1)).await;}
        }
    };
    Ok(Sse::new(stream).keep_alive(KeepAlive::new().interval(std::time::Duration::from_secs(10))))
}
