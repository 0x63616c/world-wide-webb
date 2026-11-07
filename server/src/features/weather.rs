use crate::{
    AppState,
    http::{ApiError, Result},
};
use axum::{Json, extract::State, http::StatusCode};
use chrono::{DateTime, Timelike, Utc};
use chrono_tz::Tz;
use serde_json::{Value, json};
use sqlx::FromRow;

#[derive(FromRow)]
struct Hour {
    target_hour: String,
    temp_f: i64,
    feels_f: i64,
    humidity: Option<i64>,
    weather_code: i64,
    wind_mph: Option<i64>,
    is_day: bool,
    precip_probability: Option<i64>,
    uv_index: Option<i64>,
}
#[derive(FromRow)]
struct Day {
    target_date: String,
    hi_f: i64,
    lo_f: i64,
    weather_code: i64,
    precip_probability: Option<i64>,
    sunrise_iso: Option<String>,
    sunset_iso: Option<String>,
}
fn unavailable() -> ApiError {
    ApiError {
        status: StatusCode::SERVICE_UNAVAILABLE,
        message: "Weather unavailable",
    }
}
fn icon(code: i64, day: bool) -> &'static str {
    if code == 3 || code >= 45 {
        "cloud"
    } else if code >= 2 {
        if day { "cloud-sun" } else { "cloud" }
    } else if day {
        "sun"
    } else {
        "moon"
    }
}
fn condition(code: i64) -> &'static str {
    match code {
        0 => "Clear Sky",
        1 => "Mainly Clear",
        2 => "Partly Cloudy",
        3 => "Overcast",
        45 => "Foggy",
        48 => "Depositing Rime Fog",
        51 => "Light Drizzle",
        53 => "Moderate Drizzle",
        55 => "Dense Drizzle",
        61 => "Slight Rain",
        63 => "Moderate Rain",
        65 => "Heavy Rain",
        71 => "Slight Snow",
        73 => "Moderate Snow",
        75 => "Heavy Snow",
        77 => "Snow Grains",
        80 => "Slight Rain Showers",
        81 => "Moderate Rain Showers",
        82 => "Violent Rain Showers",
        85 => "Slight Snow Showers",
        86 => "Heavy Snow Showers",
        95 => "Thunderstorm",
        96 => "Thunderstorm with Slight Hail",
        99 => "Thunderstorm with Heavy Hail",
        _ => "Unknown",
    }
}
async fn timezone(s: &AppState) -> Result<Tz> {
    let value: Option<String> = sqlx::query_scalar(
        "SELECT json_extract(value,'$.timeZone') FROM settings WHERE id='singleton'",
    )
    .fetch_optional(&s.db)
    .await?
    .flatten();
    value
        .as_deref()
        .unwrap_or("America/Los_Angeles")
        .parse()
        .map_err(|_| unavailable())
}
async fn hours(s: &AppState, at: DateTime<Utc>) -> Result<Vec<Hour>> {
    let boundary = at
        .with_minute(0)
        .and_then(|t| t.with_second(0))
        .and_then(|t| t.with_nanosecond(0))
        .ok_or_else(unavailable)?
        .to_rfc3339_opts(chrono::SecondsFormat::Micros, true);
    // Select one newest record per hour in SQL, rather than materializing all historic forecasts.
    Ok(sqlx::query_as("SELECT * FROM (SELECT *,row_number() OVER (PARTITION BY target_hour ORDER BY recorded_at DESC,id DESC) AS n FROM weather_reading WHERE kind='forecast' AND target_hour>=?) WHERE n=1 ORDER BY target_hour LIMIT 24")
        .bind(boundary).fetch_all(&s.db).await?)
}
async fn days(s: &AppState, at: DateTime<Utc>, tz: Tz) -> Result<Vec<Day>> {
    Ok(sqlx::query_as("SELECT * FROM (SELECT *,row_number() OVER (PARTITION BY target_date ORDER BY recorded_at DESC,id DESC) AS n FROM weather_daily_reading WHERE target_date>=?) WHERE n=1 ORDER BY target_date LIMIT 7")
        .bind(at.with_timezone(&tz).format("%Y-%m-%d").to_string()).fetch_all(&s.db).await?)
}
pub async fn hourly(State(s): State<AppState>) -> Result<Json<Value>> {
    let tz = timezone(&s).await?;
    let rows = hours(&s, Utc::now()).await?;
    if rows.is_empty() {
        return Err(unavailable());
    }
    let out:Vec<Value>=rows.iter().enumerate().map(|(i,r)| {
        let hour=DateTime::parse_from_rfc3339(&r.target_hour).map(|t|t.with_timezone(&tz).hour()).unwrap_or(0);
        json!({"t":if i==0 {"Now".to_owned()} else {((hour+11)%12+1).to_string()},"temp":r.temp_f,"feels":r.feels_f,
            "ic":icon(r.weather_code,r.is_day),"isDay":r.is_day,"isoTime":r.target_hour,"weatherCode":r.weather_code})
    }).collect();
    Ok(Json(json!(out)))
}
pub async fn daily(State(s): State<AppState>) -> Result<Json<Value>> {
    let tz = timezone(&s).await?;
    let rows = days(&s, Utc::now(), tz).await?;
    if rows.is_empty() {
        return Err(unavailable());
    }
    Ok(Json(json!(rows.iter().map(|r|json!({"date":r.target_date,"hi":r.hi_f,"lo":r.lo_f,"weatherCode":r.weather_code,"precipProbability":r.precip_probability})).collect::<Vec<_>>())))
}
pub async fn current(State(s): State<AppState>) -> Result<Json<Value>> {
    let at = Utc::now();
    let tz = timezone(&s).await?;
    let h = hours(&s, at).await?;
    let d = days(&s, at, tz).await?;
    let cur = h.first().ok_or_else(unavailable)?;
    let today = d.first().ok_or_else(unavailable)?;
    let boundary = at
        .with_minute(0)
        .and_then(|t| t.with_second(0))
        .and_then(|t| t.with_nanosecond(0))
        .ok_or_else(unavailable)?;
    if DateTime::parse_from_rfc3339(&cur.target_hour)
        .map_err(|_| unavailable())?
        .with_timezone(&Utc)
        != boundary
        || today.target_date != at.with_timezone(&tz).format("%Y-%m-%d").to_string()
    {
        return Err(unavailable());
    }
    let sunset = today.sunset_iso.as_deref().unwrap_or("");
    let sunrise = today.sunrise_iso.as_deref().unwrap_or("");
    let tomorrow = d
        .get(1)
        .and_then(|v| v.sunrise_iso.as_deref())
        .unwrap_or("");
    let local = at.with_timezone(&tz).format("%Y-%m-%dT%H:%M").to_string();
    let (label, event) = if !sunset.is_empty() && local.as_str() < sunset {
        ("Sunset", sunset)
    } else {
        ("Sunrise", tomorrow)
    };
    let solar = chrono::NaiveDateTime::parse_from_str(event, "%Y-%m-%dT%H:%M")
        .map(|t| t.format("%-I:%M %p").to_string())
        .unwrap_or_default();
    Ok(Json(
        json!({"temp":cur.temp_f,"cond":condition(cur.weather_code),"ic":icon(cur.weather_code,cur.is_day),
        "hi":today.hi_f,"lo":today.lo_f,"feels":cur.feels_f,"hum":cur.humidity.unwrap_or(0),"wind":cur.wind_mph.unwrap_or(0),
        "uvIndex":cur.uv_index.unwrap_or(0),"precipProbability":cur.precip_probability.unwrap_or(0),"sunsetIso":sunset,
        "sunriseIso":sunrise,"tomorrowSunriseIso":tomorrow,"solarLabel":label,"solarValue":solar,"city":"Los Angeles"}),
    ))
}
