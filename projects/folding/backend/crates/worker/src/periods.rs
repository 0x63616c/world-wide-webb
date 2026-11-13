//! UTC calendar windows. IDs are opaque to clients; counters are assigned after source replay.
use chrono::{Datelike, TimeZone, Utc};
use serde::Serialize;
#[derive(Clone, Serialize)]
pub struct Window {
    pub id: String,
    pub kind: &'static str,
    pub start_ms: u64,
    pub end_ms: u64,
}
pub fn current(timestamp: u64) -> Option<[Window; 2]> {
    let dt = Utc
        .timestamp_millis_opt(i64::try_from(timestamp).ok()?)
        .single()?;
    let day = dt.date_naive();
    let monday = day.checked_sub_signed(chrono::Duration::days(
        day.weekday().num_days_from_monday() as i64,
    ))?;
    let week_start = monday.and_hms_opt(0, 0, 0)?.and_utc().timestamp_millis() as u64;
    let month_start = Utc
        .with_ymd_and_hms(dt.year(), dt.month(), 1, 0, 0, 0)
        .single()?
        .timestamp_millis() as u64;
    let (year, month) = if dt.month() == 12 {
        (dt.year() + 1, 1)
    } else {
        (dt.year(), dt.month() + 1)
    };
    let month_end = Utc
        .with_ymd_and_hms(year, month, 1, 0, 0, 0)
        .single()?
        .timestamp_millis() as u64;
    Some([
        Window {
            id: format!("week:{week_start}"),
            kind: "week",
            start_ms: week_start,
            end_ms: week_start + 604800000,
        },
        Window {
            id: format!("month:{month_start}"),
            kind: "month",
            start_ms: month_start,
            end_ms: month_end,
        },
    ])
}
