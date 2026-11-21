//! Anonymous usage analytics ingest: envelope validation and local-time derivation.
//! The wire contract is `contracts/schemas/analytics-batch.schema.json`.
use chrono::{Datelike, Timelike};
use folding_domain::wire::{Id, MAX_BATCH_EVENTS, MAX_JSON_BYTES, MAX_SAFE_INTEGER};
use serde::Deserialize;

/// Kinds the server stores. Anything else is dropped so newer clients keep working.
pub const KNOWN_KINDS: &[&str] = &[
    "fold_open",
    "fold_close",
    "reset",
    "entry_deleted",
    "interruption",
    "app_opened",
    "tab_viewed",
    "setup",
    "competition_sign_in",
    "leaderboard_viewed",
    "badges_viewed",
    "export",
    "daily_limit_set",
    "daily_limit_exceeded",
    "notification_opened",
    "error",
];
const MAX_TEXT: usize = 64;
const MAX_REFS: usize = 2;

#[derive(Debug, PartialEq, Eq)]
pub struct Malformed;

#[derive(Deserialize)]
struct Envelope {
    schema_version: u32,
    analytics_id: Id,
    context: Context,
    events: Vec<RawEvent>,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct Context {
    pub app_version: String,
    pub build: u32,
    pub channel: String,
    pub os_version: String,
    pub device_model: String,
    pub region: Option<String>,
    pub locale: String,
    pub competition: bool,
}
#[derive(Deserialize)]
struct RawEvent {
    event_id: Id,
    kind: String,
    at_ms: u64,
    timezone_id: String,
    backfill: bool,
    detail: Option<String>,
    refs: Option<Vec<Id>>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalTime {
    /// `YYYY-MM-DD` in the event's zone.
    pub day: String,
    pub hour: u32,
    /// 0 = Monday … 6 = Sunday.
    pub weekday: u32,
    pub minute_of_day: u32,
}
#[derive(Debug, PartialEq, Eq)]
pub struct PreparedEvent {
    pub event_id: String,
    pub kind: &'static str,
    pub at_ms: i64,
    /// The submitted zone, or `UTC` when it is not a known IANA zone.
    pub timezone_id: String,
    pub local: LocalTime,
    pub backfill: bool,
    pub detail: Option<String>,
    /// Deleted fold event IDs; only kept for `entry_deleted`.
    pub refs: Vec<String>,
}
#[derive(Debug)]
pub struct Prepared {
    pub analytics_id: String,
    pub context: Context,
    /// Earliest non-backfill event time in this batch, never later than receipt.
    pub first_seen_ms: i64,
    pub events: Vec<PreparedEvent>,
}

fn short(value: &str) -> bool {
    value.chars().count() <= MAX_TEXT && !value.chars().any(char::is_control)
}
fn valid_detail(value: &str) -> bool {
    (1..=MAX_TEXT).contains(&value.len())
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'.')
}
fn zone(id: &str) -> Option<chrono_tz::Tz> {
    if id.len() > MAX_TEXT {
        return None;
    }
    id.parse().ok()
}

/// Local calendar fields for an instant; an unknown zone is treated as UTC.
pub fn local_time(at_ms: i64, timezone_id: &str) -> Option<LocalTime> {
    let instant = chrono::DateTime::from_timestamp_millis(at_ms)?;
    let local = instant.with_timezone(&zone(timezone_id).unwrap_or(chrono_tz::UTC));
    Some(LocalTime {
        day: local.format("%Y-%m-%d").to_string(),
        hour: local.hour(),
        weekday: local.weekday().num_days_from_monday(),
        minute_of_day: local.hour() * 60 + local.minute(),
    })
}

pub fn prepare(body: &[u8], received_ms: i64) -> Result<Prepared, Malformed> {
    if body.len() > MAX_JSON_BYTES {
        return Err(Malformed);
    }
    let envelope: Envelope = serde_json::from_slice(body).map_err(|_| Malformed)?;
    let context = envelope.context;
    if envelope.schema_version != 1
        || !(1..=MAX_BATCH_EVENTS).contains(&envelope.events.len())
        || context.build > i32::MAX as u32
        || !["app_store", "testflight", "debug"].contains(&context.channel.as_str())
        || ![
            &context.app_version,
            &context.os_version,
            &context.device_model,
            &context.locale,
        ]
        .into_iter()
        .chain(context.region.as_ref())
        .all(|value| short(value))
    {
        return Err(Malformed);
    }
    let mut first_seen_ms = received_ms;
    let mut events = Vec::with_capacity(envelope.events.len());
    for raw in envelope.events {
        let refs = raw.refs.unwrap_or_default();
        if raw.kind.is_empty()
            || raw.kind.len() > MAX_TEXT
            || raw.at_ms > MAX_SAFE_INTEGER
            || raw.detail.as_deref().is_some_and(|d| !valid_detail(d))
            || refs.len() > MAX_REFS
        {
            return Err(Malformed);
        }
        let at_ms = raw.at_ms as i64;
        let timezone_id = if zone(&raw.timezone_id).is_some() {
            raw.timezone_id
        } else {
            "UTC".to_owned()
        };
        let local = local_time(at_ms, &timezone_id).ok_or(Malformed)?;
        let Some(kind) = KNOWN_KINDS.iter().copied().find(|k| *k == raw.kind) else {
            continue;
        };
        if !raw.backfill {
            first_seen_ms = first_seen_ms.min(at_ms);
        }
        events.push(PreparedEvent {
            event_id: raw.event_id.as_str().to_owned(),
            kind,
            at_ms,
            timezone_id,
            local,
            backfill: raw.backfill,
            detail: raw.detail,
            refs: if kind == "entry_deleted" {
                refs.iter().map(|id| id.as_str().to_owned()).collect()
            } else {
                vec![]
            },
        });
    }
    Ok(Prepared {
        analytics_id: envelope.analytics_id.as_str().to_owned(),
        context,
        first_seen_ms,
        events,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn fixture() -> Value {
        serde_json::from_str(include_str!(
            "../../../../contracts/fixtures/analytics-batch.json"
        ))
        .unwrap()
    }
    fn run(value: &Value) -> Result<Prepared, Malformed> {
        prepare(value.to_string().as_bytes(), 1_763_800_000_000)
    }

    #[test]
    fn contract_fixture_is_accepted_with_local_fields() {
        let prepared = run(&fixture()).unwrap();
        assert_eq!(prepared.events.len(), 5);
        // 2025-11-21T04:40:00Z is 04:40 on a Friday in London (GMT).
        assert_eq!(
            prepared.events[0].local,
            LocalTime {
                day: "2025-11-21".into(),
                hour: 4,
                weekday: 4,
                minute_of_day: 280
            }
        );
        assert_eq!(prepared.events[3].refs.len(), 2);
        assert_eq!(prepared.first_seen_ms, 1_763_700_000_000);
    }

    #[test]
    fn summer_time_and_unknown_zones() {
        // 2026-07-01T23:30:00Z is 00:30 on Thursday 2 July in London (BST).
        let london = local_time(1_782_948_600_000, "Europe/London").unwrap();
        assert_eq!(
            (london.day.as_str(), london.hour, london.weekday),
            ("2026-07-02", 0, 3)
        );
        let mut body = fixture();
        body["events"][0]["timezone_id"] = json!("Mars/Olympus_Mons");
        body["events"][0]["at_ms"] = json!(1_782_948_600_000_i64);
        let event = &run(&body).unwrap().events[0];
        assert_eq!(event.timezone_id, "UTC");
        assert_eq!(
            (event.local.day.as_str(), event.local.hour),
            ("2026-07-01", 23)
        );
    }

    #[test]
    fn unknown_kinds_are_dropped_and_refs_kept_only_for_deletions() {
        let mut body = fixture();
        body["events"][0]["kind"] = json!("future_kind");
        body["events"][1]["refs"] = json!([body["events"][2]["event_id"]]);
        let prepared = run(&body).unwrap();
        assert_eq!(prepared.events.len(), 4);
        assert_eq!(prepared.events[0].kind, "fold_close");
        assert!(prepared.events[0].refs.is_empty());
    }

    #[test]
    fn backfill_does_not_move_first_seen() {
        let mut body = fixture();
        for event in body["events"].as_array_mut().unwrap() {
            event["backfill"] = json!(true);
        }
        assert_eq!(run(&body).unwrap().first_seen_ms, 1_763_800_000_000);
    }

    #[test]
    fn malformed_envelopes_are_rejected() {
        let cases: Vec<fn(&mut Value)> = vec![
            |b| b["schema_version"] = json!(2),
            |b| b["events"] = json!([]),
            |b| {
                let one = b["events"][0].clone();
                b["events"] = Value::Array(vec![one; 257]);
            },
            |b| b["analytics_id"] = json!("6F1C2B0A-4D3E-4F5A-8B9C-0D1E2F3A4B5C"),
            |b| b["context"]["channel"] = json!("beta"),
            |b| b["context"]["app_version"] = json!("x".repeat(65)),
            |b| b["context"]["region"] = json!("x".repeat(65)),
            |b| b["events"][0]["detail"] = json!("Upload 500"),
            |b| b["events"][0]["at_ms"] = json!(-1),
            |b| {
                let refs = b["events"][3]["refs"].clone();
                b["events"][3]["refs"] = json!([refs[0], refs[1], refs[0]]);
            },
            |b| {
                b["events"][0]
                    .as_object_mut()
                    .unwrap()
                    .remove("backfill")
                    .map(drop)
                    .unwrap()
            },
        ];
        for (index, mutate) in cases.into_iter().enumerate() {
            let mut body = fixture();
            mutate(&mut body);
            assert!(run(&body).is_err(), "case {index} was accepted");
        }
        assert!(prepare(b"{", 0).is_err());
    }
}
