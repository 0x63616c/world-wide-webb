use crate::{
    AppState,
    http::{ApiError, Result},
    id, now,
};
use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use sqlx::Row;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    id: String,
    name: String,
    photo: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Mutation {
    pin: String,
    name: String,
    photo: String,
}

fn validate(input: &Mutation) -> Result<(String, Vec<u8>)> {
    let name = input.name.trim();
    if name.is_empty() || name.chars().count() > 80 || name.chars().any(char::is_control) {
        return Err(ApiError::bad("Enter a name of 1–80 characters"));
    }
    let photo = STANDARD
        .decode(&input.photo)
        .map_err(|_| ApiError::bad("Invalid photo"))?;
    if photo.len() < 3 || photo.len() > 256 * 1024 || !photo.starts_with(&[0xff, 0xd8, 0xff]) {
        return Err(ApiError::bad("Invalid JPEG photo"));
    }
    Ok((name.to_owned(), photo))
}

pub async fn list(State(s): State<AppState>) -> Result<Json<Vec<Profile>>> {
    let rows = sqlx::query("SELECT id,name,photo FROM profile ORDER BY created_at_utc,id")
        .fetch_all(&s.db)
        .await?;
    Ok(Json(
        rows.into_iter()
            .map(|row| Profile {
                id: row.get("id"),
                name: row.get("name"),
                photo: STANDARD.encode(row.get::<Vec<u8>, _>("photo")),
            })
            .collect(),
    ))
}

pub async fn create(
    State(s): State<AppState>,
    Json(input): Json<Mutation>,
) -> Result<(StatusCode, Json<Profile>)> {
    let (name, photo) = validate(&input)?;
    super::settings::verify_pin(&s, &input.pin).await?;
    let profile = Profile {
        id: id("profile"),
        name,
        photo: STANDARD.encode(&photo),
    };
    let timestamp = now();
    sqlx::query(
        "INSERT INTO profile(id,name,photo,created_at_utc,updated_at_utc) VALUES(?,?,?,?,?)",
    )
    .bind(&profile.id)
    .bind(&profile.name)
    .bind(photo)
    .bind(&timestamp)
    .bind(timestamp)
    .execute(&s.db)
    .await?;
    Ok((StatusCode::CREATED, Json(profile)))
}

pub async fn update(
    State(s): State<AppState>,
    Path(profile_id): Path<String>,
    Json(input): Json<Mutation>,
) -> Result<Json<Profile>> {
    let (name, photo) = validate(&input)?;
    super::settings::verify_pin(&s, &input.pin).await?;
    let result = sqlx::query("UPDATE profile SET name=?,photo=?,updated_at_utc=? WHERE id=?")
        .bind(&name)
        .bind(photo)
        .bind(now())
        .bind(&profile_id)
        .execute(&s.db)
        .await?;
    if result.rows_affected() == 0 {
        return Err(ApiError::not_found());
    }
    Ok(Json(Profile {
        id: profile_id,
        name,
        photo: input.photo,
    }))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Delete {
    pin: String,
}

pub async fn remove(
    State(s): State<AppState>,
    Path(profile_id): Path<String>,
    Json(input): Json<Delete>,
) -> Result<Json<serde_json::Value>> {
    super::settings::verify_pin(&s, &input.pin).await?;
    let result = sqlx::query("DELETE FROM profile WHERE id=?")
        .bind(profile_id)
        .execute(&s.db)
        .await?;
    if result.rows_affected() == 0 {
        return Err(ApiError::not_found());
    }
    Ok(Json(serde_json::json!({"deleted": true})))
}
