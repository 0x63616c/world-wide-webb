use crate::{
    AppState,
    http::{ApiError, Result},
    id, now,
};
use axum::{
    Json,
    body::Bytes,
    extract::{Path, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::Serialize;
use sqlx::FromRow;
use std::path::Component;

#[derive(FromRow)]
struct Photo {
    id: String,
    path: String,
    captured_at: String,
    mode: String,
    group_id: String,
    frame_idx: i64,
    mime_type: String,
    bytes: i64,
    filter: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Frame {
    id: String,
    path: String,
    captured_at: i64,
    frame_idx: i64,
    mime_type: String,
    filter: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Group {
    group_id: String,
    mode: String,
    captured_at: i64,
    filter: Option<String>,
    frames: Vec<Frame>,
}
fn milliseconds(v: &str) -> Result<i64> {
    chrono::DateTime::parse_from_rfc3339(v)
        .map(|d| d.timestamp_millis())
        .map_err(|_| ApiError::bad("Invalid stored timestamp"))
}
fn io_error(_: std::io::Error) -> ApiError {
    ApiError {
        status: StatusCode::SERVICE_UNAVAILABLE,
        message: "Media storage unavailable",
    }
}
pub async fn list(State(s): State<AppState>) -> Result<Json<serde_json::Value>> {
    let rows:Vec<Photo>=sqlx::query_as("SELECT * FROM booth_photo WHERE soft_deleted_at IS NULL AND source_only=0 ORDER BY captured_at DESC,group_id,frame_idx").fetch_all(&s.db).await?;
    let total_count = rows.len();
    let total_bytes: i64 = rows.iter().map(|r| r.bytes).sum();
    let mut groups: Vec<Group> = vec![];
    for row in rows {
        let at = milliseconds(&row.captured_at)?;
        let index = groups
            .iter()
            .position(|g| g.group_id == row.group_id)
            .unwrap_or_else(|| {
                groups.push(Group {
                    group_id: row.group_id.clone(),
                    mode: row.mode.clone(),
                    captured_at: at,
                    filter: row.filter.clone(),
                    frames: vec![],
                });
                groups.len() - 1
            });
        groups[index].frames.push(Frame {
            id: row.id,
            path: format!("/media/booth-photos/{}", row.path),
            captured_at: at,
            frame_idx: row.frame_idx,
            mime_type: row.mime_type,
            filter: row.filter,
        });
    }
    for g in &mut groups {
        g.frames.sort_by_key(|f| f.frame_idx);
    }
    Ok(Json(
        serde_json::json!({"groups":groups,"totalCount":total_count,"totalBytes":total_bytes}),
    ))
}
pub async fn remove(
    State(s): State<AppState>,
    Path(key): Path<String>,
) -> Result<Json<serde_json::Value>> {
    let n = sqlx::query(
        "UPDATE booth_photo SET soft_deleted_at=? WHERE group_id=? AND soft_deleted_at IS NULL",
    )
    .bind(now())
    .bind(key)
    .execute(&s.db)
    .await?
    .rows_affected();
    Ok(Json(serde_json::json!({"removed":n})))
}
pub async fn clear_filter(
    State(s): State<AppState>,
    Path(key): Path<String>,
) -> Result<Json<serde_json::Value>> {
    let n = sqlx::query(
        "UPDATE booth_photo SET filter=NULL WHERE group_id=? AND soft_deleted_at IS NULL",
    )
    .bind(key)
    .execute(&s.db)
    .await?
    .rows_affected();
    Ok(Json(serde_json::json!({"cleared":n})))
}
fn header_value<'a>(h: &'a HeaderMap, name: &str) -> Option<&'a str> {
    h.get(name).and_then(|v| v.to_str().ok())
}
fn identifier(v: &str, prefix: &str) -> bool {
    v.strip_prefix(prefix).is_some_and(|s| {
        !s.is_empty()
            && s.len() <= 36
            && s.bytes()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
    })
}
pub async fn upload(
    State(s): State<AppState>,
    headers: HeaderMap,
    bytes: Bytes,
) -> Result<(StatusCode, Json<serde_json::Value>)> {
    let mode =
        header_value(&headers, "x-mode").ok_or_else(|| ApiError::bad("Missing capture mode"))?;
    if !["photo", "burst", "four_frame", "gif"].contains(&mode) {
        return Err(ApiError::bad("Invalid capture mode"));
    }
    let source_only = header_value(&headers, "x-source-only") == Some("1");
    let gif = bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a");
    let jpeg = bytes.starts_with(&[0xff, 0xd8, 0xff]);
    if bytes.is_empty()
        || bytes.len() > 20 * 1024 * 1024
        || !(if mode == "gif" && !source_only {
            gif
        } else {
            jpeg
        })
    {
        return Err(ApiError::bad("Image format does not match mode"));
    }
    let filter = header_value(&headers, "x-filter");
    if filter.is_some_and(|f| {
        f.is_empty()
            || f.len() > 32
            || !f
                .bytes()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_')
    }) {
        return Err(ApiError::bad("Invalid filter"));
    }
    let group = header_value(&headers, "x-group-id")
        .filter(|v| identifier(v, "bpg_"))
        .map(str::to_owned)
        .unwrap_or_else(|| id("bpg"));
    let device = header_value(&headers, "x-device-id").filter(|s| {
        !s.is_empty()
            && s.len() <= 64
            && s.bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
    });
    let frame = header_value(&headers, "x-frame-idx")
        .map(str::parse::<u32>)
        .transpose()
        .map_err(|_| ApiError::bad("Invalid frame index"))?
        .unwrap_or(0);
    let captured = header_value(&headers, "x-captured-at")
        .map(str::parse::<i64>)
        .transpose()
        .map_err(|_| ApiError::bad("Invalid captured timestamp"))?
        .map(|v| {
            chrono::DateTime::from_timestamp_millis(v)
                .ok_or_else(|| ApiError::bad("Invalid captured timestamp"))
        })
        .transpose()?
        .unwrap_or_else(chrono::Utc::now);
    let key = id("bph");
    let ext = if gif { "gif" } else { "jpg" };
    let rel = format!("{key}.{ext}");
    let root = s.media.join("booth-photos");
    tokio::fs::create_dir_all(&root).await.map_err(io_error)?;
    let dest = root.join(&rel);
    // Create-new prevents overwrites. Bytes are synced before publishing the DB index.
    use tokio::io::AsyncWriteExt;
    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&dest)
        .await
        .map_err(io_error)?;
    file.write_all(&bytes).await.map_err(io_error)?;
    file.sync_all().await.map_err(io_error)?;
    drop(file);
    // Persist the filename as well as its bytes before publishing its database row.
    tokio::fs::File::open(&root)
        .await
        .map_err(io_error)?
        .sync_all()
        .await
        .map_err(io_error)?;
    let mime = if gif { "image/gif" } else { "image/jpeg" };
    let inserted=sqlx::query("INSERT INTO booth_photo(id,path,captured_at,mode,group_id,frame_idx,mime_type,bytes,filter,device_id,source_only,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(&key).bind(&rel).bind(captured.to_rfc3339_opts(chrono::SecondsFormat::Micros,true)).bind(mode).bind(&group).bind(frame).bind(mime).bind(bytes.len() as i64).bind(filter).bind(device).bind(source_only).bind(now()).execute(&s.db).await;
    // Leave an orphan file on DB failure rather than risk losing bytes; reconciliation surfaces it.
    inserted?;
    Ok((
        StatusCode::CREATED,
        Json(
            serde_json::json!({"id":key,"path":format!("/media/booth-photos/{rel}"),"groupId":group,"capturedAt":captured.timestamp_millis(),"frameIdx":frame,"mimeType":mime,"filter":filter}),
        ),
    ))
}
pub async fn download(State(s): State<AppState>, Path(path): Path<String>) -> Result<Response> {
    if path.is_empty()
        || std::path::Path::new(&path)
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(ApiError::not_found());
    }
    // Require the path to belong to an indexed visible capture. Never serve arbitrary media files.
    let mime: Option<String> = sqlx::query_scalar(
        "SELECT mime_type FROM booth_photo WHERE path=? AND soft_deleted_at IS NULL",
    )
    .bind(&path)
    .fetch_optional(&s.db)
    .await?;
    let mime = mime.ok_or_else(ApiError::not_found)?;
    let root = tokio::fs::canonicalize(s.media.join("booth-photos"))
        .await
        .map_err(io_error)?;
    let file = tokio::fs::canonicalize(root.join(path))
        .await
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                ApiError::not_found()
            } else {
                io_error(e)
            }
        })?;
    if !file.starts_with(&root) {
        return Err(ApiError::not_found());
    }
    let bytes = tokio::fs::read(file).await.map_err(io_error)?;
    Ok(([(header::CONTENT_TYPE, mime)], bytes).into_response())
}
