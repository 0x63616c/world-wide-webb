use crate::{
    AppState,
    http::{ApiError, Result},
    now,
};
use axum::{
    Json,
    extract::{Query, State},
};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Deserialize)]
pub struct App {
    app: String,
}
#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Release {
    app: String,
    build: i64,
    updated_at: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Publish {
    app: String,
    build: i64,
}
fn valid(app: &str) -> Result<()> {
    if app.is_empty()
        || app.len() > 64
        || !app.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return Err(ApiError::bad("Invalid app"));
    }
    Ok(())
}
pub async fn latest(State(s): State<AppState>, Query(q): Query<App>) -> Result<Json<Release>> {
    valid(&q.app)?;
    sqlx::query_as("SELECT * FROM latest_release WHERE app=?")
        .bind(q.app)
        .fetch_optional(&s.db)
        .await?
        .map(Json)
        .ok_or_else(ApiError::not_found)
}
pub async fn publish(State(s): State<AppState>, Json(p): Json<Publish>) -> Result<Json<Release>> {
    valid(&p.app)?;
    if !(1..=2_147_483_647).contains(&p.build) {
        return Err(ApiError::bad("Invalid build"));
    }
    let mut tx = s.db.begin().await?;
    sqlx::query("INSERT INTO latest_release(app,build,updated_at) VALUES(?,?,?) ON CONFLICT(app) DO UPDATE SET build=excluded.build,updated_at=excluded.updated_at WHERE excluded.build>latest_release.build")
        .bind(&p.app).bind(p.build).bind(now()).execute(&mut *tx).await?;
    let row = sqlx::query_as("SELECT * FROM latest_release WHERE app=?")
        .bind(p.app)
        .fetch_one(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(row))
}
