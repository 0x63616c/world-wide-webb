use super::notifications;
use crate::{
    AppState,
    http::{ApiError, Result},
    id, now, timestamp,
};
use axum::{
    Json,
    extract::{Path, Query, State},
};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqliteConnection};

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Walk {
    id: String,
    started_at: String,
    ended_at: Option<String>,
    source: String,
    created_at: String,
    updated_at: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    active: Option<Walk>,
    updated_at: String,
    server_time: String,
}
async fn snapshot(conn: &mut SqliteConnection) -> Result<Snapshot> {
    let active =
        sqlx::query_as("SELECT * FROM walk WHERE ended_at IS NULL AND deleted_at IS NULL LIMIT 1")
            .fetch_optional(&mut *conn)
            .await?;
    let updated_at: Option<String> = sqlx::query_scalar("SELECT MAX(updated_at) FROM walk")
        .fetch_one(conn)
        .await?;
    Ok(Snapshot {
        active,
        updated_at: updated_at.unwrap_or_else(|| "1970-01-01T00:00:00.000000Z".into()),
        server_time: now(),
    })
}
pub async fn state(State(s): State<AppState>) -> Result<Json<Snapshot>> {
    Ok(Json(snapshot(&mut *s.db.acquire().await?).await?))
}
#[derive(Deserialize)]
pub struct History {
    limit: Option<u32>,
    before: Option<String>,
}
pub async fn history(
    State(s): State<AppState>,
    Query(q): Query<History>,
) -> Result<Json<serde_json::Value>> {
    let limit = q.limit.unwrap_or(50);
    if !(1..=500).contains(&limit) {
        return Err(ApiError::bad("limit must be 1...500"));
    }
    let before = q.before.as_deref().map(timestamp).transpose()?;
    let rows: Vec<Walk> = sqlx::query_as("SELECT * FROM walk WHERE deleted_at IS NULL AND ended_at IS NOT NULL AND (? IS NULL OR started_at < ?) ORDER BY started_at DESC,id DESC LIMIT ?")
        .bind(&before).bind(&before).bind(limit).fetch_all(&s.db).await?;
    Ok(Json(serde_json::json!({"walks":rows})))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Start {
    id: Option<String>,
    started_at: Option<String>,
    source: Option<String>,
}
pub async fn start(State(s): State<AppState>, Json(v): Json<Start>) -> Result<Json<Snapshot>> {
    if v.id
        .as_ref()
        .is_some_and(|v| uuid::Uuid::parse_str(v).is_err())
    {
        return Err(ApiError::bad("id must be a UUID"));
    }
    let source = v.source.as_deref().unwrap_or("unknown");
    if !["iphone", "ipad", "mac", "web", "unknown"].contains(&source) {
        return Err(ApiError::bad("Invalid walk source"));
    }
    let at = v
        .started_at
        .as_deref()
        .map(timestamp)
        .transpose()?
        .unwrap_or_else(now);
    let mut tx = s.db.begin().await?;
    let existing: bool = match &v.id {
        Some(key) => {
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM walk WHERE id=?)")
                .bind(key)
                .fetch_one(&mut *tx)
                .await?
        }
        None => false,
    };
    if !existing {
        sqlx::query("INSERT INTO walk(id,started_at,source,created_at,updated_at) SELECT ?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM walk WHERE ended_at IS NULL AND deleted_at IS NULL)")
            .bind(v.id.unwrap_or_else(|| id("walk"))).bind(at).bind(source).bind(now()).bind(now()).execute(&mut *tx).await?;
    }
    let result = snapshot(&mut tx).await?;
    tx.commit().await?;
    Ok(Json(result))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Stop {
    id: String,
    ended_at: Option<String>,
}
pub async fn stop(State(s): State<AppState>, Json(v): Json<Stop>) -> Result<Json<Snapshot>> {
    let ended = v
        .ended_at
        .as_deref()
        .map(timestamp)
        .transpose()?
        .unwrap_or_else(now);
    let mut tx = s.db.begin().await?;
    let changed = sqlx::query("UPDATE walk SET ended_at=MAX(started_at,?),updated_at=? WHERE id=? AND ended_at IS NULL AND deleted_at IS NULL")
        .bind(ended).bind(now()).bind(&v.id).execute(&mut *tx).await?.rows_affected();
    if changed > 0 {
        stopped(&mut tx, &v.id).await?;
    }
    let result = snapshot(&mut tx).await?;
    tx.commit().await?;
    Ok(Json(result))
}
async fn stopped(conn: &mut SqliteConnection, key: &str) -> Result<()> {
    notifications::insert(
        conn,
        notifications::Input {
            source_module: "walks".into(),
            title: "Walk stopped".into(),
            body: "Dog Walk has finished.".into(),
            deep_link: "module/walks".into(),
            priority: "normal".into(),
            dedupe_key: Some(format!("{key}:stopped")),
        },
    )
    .await?;
    Ok(())
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Update {
    started_at: Option<String>,
    ended_at: Option<String>,
}
pub async fn update(
    State(s): State<AppState>,
    Path(key): Path<String>,
    Json(v): Json<Update>,
) -> Result<Json<Snapshot>> {
    let start = v.started_at.as_deref().map(timestamp).transpose()?;
    let end = v.ended_at.as_deref().map(timestamp).transpose()?;
    let mut tx = s.db.begin().await?;
    let row: Walk = sqlx::query_as("SELECT * FROM walk WHERE id=? AND deleted_at IS NULL")
        .bind(&key)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(ApiError::not_found)?;
    let started = start.as_ref().unwrap_or(&row.started_at);
    let ended = end.as_ref().or(row.ended_at.as_ref());
    if ended.is_some_and(|end| end < started) {
        return Err(ApiError::bad("endedAt must be at or after startedAt"));
    }
    if start.is_some() || end.is_some() {
        sqlx::query("UPDATE walk SET started_at=?,ended_at=?,updated_at=? WHERE id=?")
            .bind(started)
            .bind(ended)
            .bind(now())
            .bind(&key)
            .execute(&mut *tx)
            .await?;
    }
    if end.is_some() && row.ended_at.is_none() {
        stopped(&mut tx, &key).await?;
    }
    let result = snapshot(&mut tx).await?;
    tx.commit().await?;
    Ok(Json(result))
}
pub async fn delete(State(s): State<AppState>, Path(key): Path<String>) -> Result<Json<Snapshot>> {
    let mut tx = s.db.begin().await?;
    sqlx::query("UPDATE walk SET deleted_at=?,updated_at=? WHERE id=? AND deleted_at IS NULL")
        .bind(now())
        .bind(now())
        .bind(key)
        .execute(&mut *tx)
        .await?;
    let result = snapshot(&mut tx).await?;
    tx.commit().await?;
    Ok(Json(result))
}
