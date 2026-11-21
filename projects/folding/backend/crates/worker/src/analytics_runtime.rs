//! Anonymous usage analytics: unauthenticated batch ingest and the admin dashboard.
//! Ingest never reads or stores the network address; per-IP burst limits run before this.
use crate::{
    analytics::{Prepared, prepare},
    analytics_report::{EventRow, Exclusions, Filter, InstallRow, compute, render, render_install},
    config::Configuration,
    support::{Failure, now, number, response, statement, text},
};
use askama::Template;
use folding_domain::wire::Id;
use serde::Deserialize;
use wasm_bindgen::JsValue;
use worker::*;

const DAY_MS: i64 = 86_400_000;
const EVENT_COLUMNS: &str = "analytics_id,event_id,kind,at_ms,timezone_id,local_day,local_hour,local_weekday,backfill,detail";
const INSTALL_COLUMNS: &str = "analytics_id,app_version,build,channel,os_version,device_model,region,locale,competition,first_seen_ms,last_received_ms";

#[derive(Template)]
#[template(path = "analytics.html")]
struct Page {
    title: String,
    body: String,
}
#[derive(Deserialize)]
struct Removed {
    analytics_id: String,
    event_id: String,
}
#[derive(Deserialize)]
struct Reset {
    analytics_id: String,
    at_ms: i64,
}
#[derive(Deserialize)]
struct Newest {
    at_ms: Option<i64>,
}

fn malformed() -> Failure {
    Failure {
        status: 400,
        code: "malformed_request",
        retryable: false,
    }
}
fn not_found() -> Failure {
    Failure {
        status: 404,
        code: "not_found",
        retryable: false,
    }
}
fn optional(value: Option<&str>) -> JsValue {
    value.map_or(JsValue::NULL, text)
}

pub(crate) async fn submit(
    db: &D1Database,
    config: &Configuration,
    body: &[u8],
    request_id: &Id,
) -> std::result::Result<Response, Failure> {
    let received = now();
    let Prepared {
        analytics_id,
        context,
        first_seen_ms,
        events,
    } = prepare(body, received).map_err(|_| malformed())?;
    crate::rate_limit::enforce(db, config, "analytics", &analytics_id, 3_600_000, 600).await?;
    let mut writes = vec![statement(
        db,
        "INSERT INTO analytics_installs VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11) ON CONFLICT(analytics_id) DO UPDATE SET app_version=excluded.app_version,build=excluded.build,channel=excluded.channel,os_version=excluded.os_version,device_model=excluded.device_model,region=excluded.region,locale=excluded.locale,competition=excluded.competition,first_seen_ms=min(first_seen_ms,excluded.first_seen_ms),last_received_ms=excluded.last_received_ms",
        &[
            text(&analytics_id),
            text(&context.app_version),
            number(context.build.into()),
            text(&context.channel),
            text(&context.os_version),
            text(&context.device_model),
            optional(context.region.as_deref()),
            text(&context.locale),
            number(context.competition.into()),
            number(first_seen_ms),
            number(received),
        ],
    )?];
    for event in &events {
        writes.push(statement(
            db,
            "INSERT INTO analytics_events VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11) ON CONFLICT DO NOTHING",
            &[
                text(&analytics_id),
                text(&event.event_id),
                text(event.kind),
                number(event.at_ms),
                text(&event.timezone_id),
                text(&event.local.day),
                number(event.local.hour.into()),
                number(event.local.weekday.into()),
                number(event.backfill.into()),
                optional(event.detail.as_deref()),
                number(received),
            ],
        )?);
        for removed in &event.refs {
            writes.push(statement(
                db,
                "INSERT INTO analytics_removed_events VALUES(?1,?2) ON CONFLICT DO NOTHING",
                &[text(&analytics_id), text(removed)],
            )?);
        }
    }
    db.batch(writes).await.map_err(|_| Failure::unavailable())?;
    response(&serde_json::json!({"accepted": events.len(), "request_id": request_id}))
}

async fn rows<T: for<'de> Deserialize<'de>>(
    db: &D1Database,
    sql: &str,
    args: &[JsValue],
) -> std::result::Result<Vec<T>, Failure> {
    statement(db, sql, args)?
        .all()
        .await
        .map_err(|_| Failure::unavailable())?
        .results()
        .map_err(|_| Failure::unavailable())
}
async fn exclusions(
    db: &D1Database,
    install: Option<&str>,
) -> std::result::Result<Exclusions, Failure> {
    let scope = if install.is_some() {
        "WHERE analytics_id=?1"
    } else {
        ""
    };
    let args: Vec<JsValue> = install.map(text).into_iter().collect();
    let removed: Vec<Removed> = rows(
        db,
        &format!("SELECT analytics_id,event_id FROM analytics_removed_events {scope}"),
        &args,
    )
    .await?;
    let resets: Vec<Reset> = rows(
        db,
        &format!(
            "SELECT analytics_id,max(at_ms) AS at_ms FROM analytics_events {} kind='reset' GROUP BY analytics_id",
            if install.is_some() { "WHERE analytics_id=?1 AND" } else { "WHERE" }
        ),
        &args,
    )
    .await?;
    Ok(Exclusions {
        removed: removed
            .into_iter()
            .map(|r| (r.analytics_id, r.event_id))
            .collect(),
        latest_reset: resets
            .into_iter()
            .map(|r| (r.analytics_id, r.at_ms))
            .collect(),
    })
}
fn page(title: &str, body: String) -> std::result::Result<Response, Failure> {
    crate::admin_runtime::secure_html(
        Page {
            title: title.into(),
            body,
        }
        .render()
        .map_err(|_| Failure::unavailable())?,
    )
}
fn today() -> chrono::NaiveDate {
    chrono::DateTime::from_timestamp_millis(now())
        .map(|t| t.date_naive())
        .unwrap_or_default()
}
fn day_start_ms(day: chrono::NaiveDate) -> i64 {
    day.and_hms_opt(0, 0, 0)
        .map(|t| t.and_utc().timestamp_millis())
        .unwrap_or_default()
}

pub(crate) async fn admin(
    request: &Request,
    db: &D1Database,
) -> std::result::Result<Response, Failure> {
    if request.method() != Method::Get {
        return Err(Failure::malformed());
    }
    if let Some(id) = request.path().strip_prefix("/admin/analytics/installs/") {
        let id = Id::parse(id).map_err(|_| Failure::malformed())?;
        return install(db, id.as_str()).await;
    }
    if request.path() != "/admin/analytics" {
        return Err(not_found());
    }
    let url = request.url().map_err(|_| Failure::malformed())?;
    let pairs: Vec<(String, String)> = url.query_pairs().into_owned().collect();
    if pairs.len() > 3 {
        return Err(Failure::malformed());
    }
    let filter = Filter::parse(&pairs, today()).map_err(|_| Failure::malformed())?;
    // Local days can sit up to 14 hours either side of UTC; a wider window also lets
    // sessions that cross the range edges pair with their close.
    let from_ms = day_start_ms(filter.from) - 2 * DAY_MS;
    let to_ms = day_start_ms(filter.to) + 3 * DAY_MS;
    let installs: Vec<InstallRow> = rows(
        db,
        &format!("SELECT {INSTALL_COLUMNS} FROM analytics_installs"),
        &[],
    )
    .await?;
    let events: Vec<EventRow> = rows(
        db,
        &format!("SELECT {EVENT_COLUMNS} FROM analytics_events WHERE at_ms>=?1 AND at_ms<?2"),
        &[number(from_ms), number(to_ms)],
    )
    .await?;
    let newest: Vec<Newest> = rows(
        db,
        "SELECT max(at_ms) AS at_ms FROM analytics_events WHERE backfill=0",
        &[],
    )
    .await?;
    let report = compute(
        &filter,
        &installs,
        &events,
        &exclusions(db, None).await?,
        newest.first().and_then(|n| n.at_ms),
    );
    page("Usage analytics", render(&filter, &report))
}

async fn install(db: &D1Database, id: &str) -> std::result::Result<Response, Failure> {
    let found: Vec<InstallRow> = rows(
        db,
        &format!("SELECT {INSTALL_COLUMNS} FROM analytics_installs WHERE analytics_id=?1"),
        &[text(id)],
    )
    .await?;
    let Some(install) = found.into_iter().next() else {
        return Err(not_found());
    };
    let end = today() + chrono::Duration::days(1);
    let events: Vec<EventRow> = rows(
        db,
        &format!(
            "SELECT {EVENT_COLUMNS} FROM analytics_events WHERE analytics_id=?1 AND at_ms>=?2 AND at_ms<?3"
        ),
        &[
            text(id),
            number(day_start_ms(end) - 16 * DAY_MS),
            number(day_start_ms(end) + 2 * DAY_MS),
        ],
    )
    .await?;
    let end_day = events
        .iter()
        .filter_map(|e| chrono::NaiveDate::parse_from_str(&e.local_day, "%Y-%m-%d").ok())
        .max()
        .unwrap_or_else(today)
        .max(today());
    page(
        "Install analytics",
        render_install(&install, &events, &exclusions(db, Some(id)).await?, end_day),
    )
}
