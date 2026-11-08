//! Revision-fenced, bounded reward backfill and incremental score projections.
use crate::auth_runtime::{Failure, number, statement, text, uuid};
use crate::{milestone_projection, milestone_sql as sql};
use folding_domain::{
    milestones::{BadgeId, Track, UTC_DAY_MS},
    wire::{Event, Generation, Id, Transition},
};
use serde::Deserialize;
use std::collections::BTreeMap;
use worker::*;

#[derive(Deserialize)]
pub(crate) struct State {
    pub generation_revision: u64,
    pub generation_id: String,
    pub source_revision: i64,
    pub state: String,
    pub folds: u64,
    pub days_used: u64,
    cursor_device_id: Option<String>,
    cursor_sequence: Option<u64>,
    cursor_transition: Option<Transition>,
}
pub(crate) async fn state(db: &D1Database, participant: &str) -> Result<Option<State>, Failure> {
    statement(
        db,
        "SELECT * FROM milestone_state WHERE participant_id=?1",
        &[text(participant)],
    )?
    .first::<State>(None)
    .await
    .map_err(|_| Failure::unavailable())
}

pub(crate) fn purge(
    db: &D1Database,
    participant: &str,
    reset: bool,
) -> Result<Vec<D1PreparedStatement>, Failure> {
    let mut tables = vec![
        "milestone_featured",
        "milestone_grants",
        "milestone_counted_events",
        "milestone_days",
        "milestone_state",
    ];
    if reset {
        tables.push("milestone_acknowledgments");
    }
    tables
        .into_iter()
        .map(|table| {
            statement(
                db,
                &format!("DELETE FROM {table} WHERE participant_id=?1"),
                &[text(participant)],
            )
        })
        .collect()
}
pub(crate) fn initialize(
    db: &D1Database,
    participant: &str,
    generation: &Generation,
    revision: i64,
    ready: bool,
) -> Result<D1PreparedStatement, Failure> {
    statement(
        db,
        sql::INITIALIZE,
        &[
            text(participant),
            number(generation.revision as i64),
            text(generation.reset_id.as_str()),
            number(revision),
            text(if ready { "ready" } else { "building" }),
        ],
    )
}

/// Update grants from the scalar projection. Expensive nth-event date lookup runs
/// only for newly reached awards, not every fold. Six catalog entries bound work.
fn grants(db: &D1Database, participant: &str) -> Result<Vec<D1PreparedStatement>, Failure> {
    let mut writes = vec![];
    for badge in BadgeId::ALL {
        let column = if badge.track() == Track::Folds {
            "folds"
        } else {
            "days_used"
        };
        writes.push(statement(db,&format!("DELETE FROM milestone_grants WHERE participant_id=?1 AND badge_id=?2 AND NOT EXISTS(SELECT 1 FROM milestone_state WHERE participant_id=?1 AND state='ready' AND {column}>=?3)"),&[text(participant),text(badge.as_str()),number(badge.threshold() as i64)])?);
        let date = if badge.track() == Track::Folds {
            "SELECT observed_at_ms FROM milestone_counted_events WHERE participant_id=?1 ORDER BY observed_at_ms,event_id LIMIT 1 OFFSET ?4".to_string()
        } else {
            format!(
                "SELECT utc_day*{UTC_DAY_MS} FROM milestone_days WHERE participant_id=?1 AND folds>0 ORDER BY utc_day LIMIT 1 OFFSET ?4"
            )
        };
        writes.push(statement(db,&format!("INSERT INTO milestone_grants(participant_id,badge_id,earned_at_ms) SELECT ?1,?2,({date}) WHERE EXISTS(SELECT 1 FROM milestone_state WHERE participant_id=?1 AND state='ready' AND {column}>=?3) AND NOT EXISTS(SELECT 1 FROM milestone_grants WHERE participant_id=?1 AND badge_id=?2)"),&[text(participant),text(badge.as_str()),number(badge.threshold() as i64),number(badge.threshold() as i64-1)])?);
    }
    Ok(writes)
}

#[derive(Deserialize)]
struct Day {
    utc_day: u64,
    folds: i64,
}
async fn day_change(
    db: &D1Database,
    participant: &str,
    changes: &BTreeMap<u64, i64>,
) -> Result<i64, Failure> {
    let keys: Vec<_> = changes.keys().collect();
    let keys = serde_json::to_string(&keys).map_err(|_| Failure::unavailable())?;
    let old=statement(db,"SELECT utc_day,folds FROM milestone_days WHERE participant_id=?1 AND utc_day IN(SELECT value FROM json_each(?2))",&[text(participant),text(&keys)])?.all().await.map_err(|_|Failure::unavailable())?.results::<Day>().map_err(|_|Failure::unavailable())?;
    let old: BTreeMap<_, _> = old
        .into_iter()
        .map(|day| (day.utc_day, day.folds))
        .collect();
    let mut delta = 0;
    for (day, change) in changes {
        let before = *old.get(day).unwrap_or(&0);
        let after = before + change;
        if after < 0 {
            return Err(Failure::conflict());
        }
        delta += i64::from(after > 0) - i64::from(before > 0);
    }
    Ok(delta)
}
fn contributions(
    db: &D1Database,
    participant: &str,
    change: &milestone_projection::Delta,
) -> Result<Vec<D1PreparedStatement>, Failure> {
    let removed = serde_json::to_string(&change.removed).map_err(|_| Failure::unavailable())?;
    let added = serde_json::to_string(&change.added).map_err(|_| Failure::unavailable())?;
    let days = serde_json::to_string(&change.days).map_err(|_| Failure::unavailable())?;
    Ok(vec![
        statement(db, sql::REMOVE_EVENTS, &[text(participant), text(&removed)])?,
        statement(db, sql::ADD_EVENTS, &[text(participant), text(&added)])?,
        statement(db, sql::DAY_DELTAS, &[text(participant), text(&days)])?,
        statement(
            db,
            "DELETE FROM milestone_days WHERE participant_id=?1 AND folds=0",
            &[text(participant)],
        )?,
    ])
}

/// Appended to the same CAS batch as live-score changes. Common neighbor
/// contributions cancel, so truncated causal boundaries cannot fabricate awards.
pub(crate) async fn incremental(
    db: &D1Database,
    participant: &str,
    generation: &Generation,
    revision: i64,
    before: &[(Id, u64)],
    after: &[(Id, u64)],
) -> Result<Vec<D1PreparedStatement>, Failure> {
    let old = state(db, participant).await?;
    if !old.as_ref().is_some_and(|s| {
        s.state == "ready"
            && s.generation_revision == generation.revision
            && s.generation_id == generation.reset_id.as_str()
    }) {
        let mut writes = purge(db, participant, false)?;
        writes.push(initialize(db, participant, generation, revision, false)?);
        return Ok(writes);
    }
    let change = milestone_projection::delta(before, after).map_err(|_| Failure::unavailable())?;
    let days = day_change(db, participant, &change.days).await?;
    let mut writes = contributions(db, participant, &change)?;
    writes.push(statement(
        db,
        sql::UPDATE_STATE,
        &[
            text(participant),
            number(change.added.len() as i64 - change.removed.len() as i64),
            number(days),
            number(revision),
        ],
    )?);
    writes.extend(grants(db, participant)?);
    Ok(writes)
}

/// Reuse full authoritative replay already performed by deletion/moderation.
pub(crate) fn replay(
    db: &D1Database,
    participant: &str,
    generation: &Generation,
    revision: i64,
    counted: &[(Id, u64)],
) -> Result<Vec<D1PreparedStatement>, Failure> {
    let times: Vec<_> = counted.iter().map(|(_, time)| *time).collect();
    let progress = folding_domain::milestones::from_counted_timestamps(&times)
        .map_err(|_| Failure::unavailable())?;
    // Preserve acknowledgments and valid selections through corrections. Grants
    // are reconciled after rebuilding, so a still-earned featured badge survives.
    let mut writes = vec![];
    for table in ["milestone_counted_events", "milestone_days"] {
        writes.push(statement(
            db,
            &format!("DELETE FROM {table} WHERE participant_id=?1"),
            &[text(participant)],
        )?);
    }
    // Bound each D1 argument rather than serializing an entire large history
    // into one parameter. The caller's revision fence covers the whole batch.
    for chunk in counted.chunks(256) {
        let json = serde_json::to_string(chunk).map_err(|_| Failure::unavailable())?;
        writes.push(statement(
            db,
            sql::ADD_EVENTS,
            &[text(participant), text(&json)],
        )?);
    }
    writes.push(statement(db,&format!("INSERT INTO milestone_days SELECT participant_id,observed_at_ms/{UTC_DAY_MS},count(*) FROM milestone_counted_events WHERE participant_id=?1 GROUP BY participant_id,observed_at_ms/{UTC_DAY_MS}"),&[text(participant)])?);
    writes.push(initialize(db, participant, generation, revision, true)?);
    writes.push(statement(
        db,
        "UPDATE milestone_state SET folds=?2,days_used=?3 WHERE participant_id=?1",
        &[
            text(participant),
            number(progress.folds as i64),
            number(progress.days_used as i64),
        ],
    )?);
    writes.extend(grants(db, participant)?);
    Ok(writes)
}

#[derive(Deserialize)]
struct Source {
    generation_revision: u64,
    generation_id: String,
    revision: i64,
    folds: u64,
}
#[derive(Deserialize)]
struct BackfillRow {
    event_json: String,
    deleted: i64,
}

/// One durable keyset page. Hidden building projections are never returned to
/// profiles; every page and final publish rechecks identity/generation/revision.
pub(crate) async fn backfill(db: &D1Database, participant: &str) -> Result<bool, Failure> {
    let source=statement(db,"SELECT p.generation_revision,p.generation_id,r.revision,COALESCE(s.folds,0) AS folds FROM participants p JOIN participant_revisions r ON r.participant_id=p.participant_id LEFT JOIN live_scores s ON s.participant_id=p.participant_id AND s.period_id='all' AND s.generation_revision=p.generation_revision AND s.generation_id=p.generation_id WHERE p.participant_id=?1 AND p.account_state='active' AND p.membership='joined' AND p.restriction='none'",&[text(participant)])?.first::<Source>(None).await.map_err(|_|Failure::unavailable())?;
    let Some(source) = source else {
        return Ok(true);
    };
    let generation = Generation {
        revision: source.generation_revision,
        reset_id: Id::parse(&source.generation_id).map_err(|_| Failure::unavailable())?,
    };
    let existing = state(db, participant).await?;
    if existing.as_ref().is_some_and(|s| {
        s.state == "ready"
            && s.generation_revision == generation.revision
            && s.generation_id == source.generation_id
    }) {
        return Ok(true);
    };
    let resume = existing.as_ref().filter(|s| {
        s.generation_revision == generation.revision
            && s.generation_id == source.generation_id
            && s.source_revision == source.revision
    });
    let device = resume
        .and_then(|s| s.cursor_device_id.as_deref())
        .unwrap_or("");
    let sequence = resume
        .and_then(|s| s.cursor_sequence)
        .map(|s| s as i64)
        .unwrap_or(-1);
    let rows = statement(
        db,
        sql::BACKFILL_ROWS,
        &[
            text(participant),
            text(device),
            number(sequence),
            number(generation.revision as i64),
            text(&source.generation_id),
        ],
    )?
    .all()
    .await
    .map_err(|_| Failure::unavailable())?
    .results::<BackfillRow>()
    .map_err(|_| Failure::unavailable())?;
    let complete = rows.len() < 256;
    let mut last_device = device.to_string();
    let mut last_sequence = sequence;
    let mut transition = resume.and_then(|s| s.cursor_transition);
    let mut counted = vec![];
    let mut changes = BTreeMap::new();
    for row in rows {
        let event: Event =
            serde_json::from_str(&row.event_json).map_err(|_| Failure::unavailable())?;
        if event.device_id.as_str() != last_device {
            transition = None;
        }
        if transition != Some(event.transition) && row.deleted == 0 {
            counted.push((event.event_id.clone(), event.observed_at_ms));
            *changes
                .entry(event.observed_at_ms / UTC_DAY_MS)
                .or_insert(0) += 1;
        }
        last_device = event.device_id.as_str().to_string();
        last_sequence = event.sequence as i64;
        transition = Some(event.transition);
    }
    let guard = uuid()?;
    let mut writes = vec![statement(
        db,
        sql::SOURCE_GUARD,
        &[
            text(&guard),
            text(participant),
            number(source.revision),
            number(generation.revision as i64),
            text(&source.generation_id),
        ],
    )?];
    let (old_folds, old_days, day_delta) = if let Some(resume) = resume {
        (
            resume.folds,
            resume.days_used,
            day_change(db, participant, &changes).await?,
        )
    } else {
        (0, 0, changes.len() as i64)
    };
    if resume.is_none() {
        writes.extend(purge(db, participant, false)?);
        writes.push(initialize(
            db,
            participant,
            &generation,
            source.revision,
            false,
        )?);
    }
    let folds = old_folds + counted.len() as u64;
    let days = old_days + day_delta as u64;
    if complete && folds != source.folds {
        return Err(Failure::conflict());
    }
    let change = milestone_projection::Delta {
        removed: vec![],
        added: counted,
        days: changes,
    };
    writes.extend(contributions(db, participant, &change)?);
    let transition = transition
        .map(|t| {
            if t == Transition::Open {
                text("open")
            } else {
                text("close")
            }
        })
        .unwrap_or(wasm_bindgen::JsValue::NULL);
    writes.push(statement(db,"UPDATE milestone_state SET folds=?2,days_used=?3,state=?4,cursor_device_id=?5,cursor_sequence=?6,cursor_transition=?7 WHERE participant_id=?1",&[text(participant),number(folds as i64),number(days as i64),text(if complete {"ready"}else{"building"}),if last_sequence<0 {wasm_bindgen::JsValue::NULL}else{text(&last_device)},if last_sequence<0 {wasm_bindgen::JsValue::NULL}else{number(last_sequence)},transition])?);
    if complete {
        writes.extend(grants(db, participant)?);
    }
    writes.push(statement(
        db,
        "DELETE FROM mutation_guards WHERE guard_id=?1",
        &[text(&guard)],
    )?);
    db.batch(writes).await.map_err(|_| Failure::conflict())?;
    Ok(complete)
}

pub(crate) async fn dispatch(db: &D1Database) -> Result<(), Failure> {
    #[derive(Deserialize)]
    struct Pending {
        participant_id: String,
    }
    let rows=statement(db,"SELECT p.participant_id FROM participants p LEFT JOIN milestone_state s ON s.participant_id=p.participant_id WHERE p.account_state='active' AND p.membership='joined' AND p.restriction='none' AND EXISTS(SELECT 1 FROM epochs e WHERE e.epoch_id=p.epoch_id AND e.participant_id=p.participant_id AND e.closed_at_ms IS NULL) AND (s.participant_id IS NULL OR s.state='building') ORDER BY p.participant_id LIMIT 1",&[])?.all().await.map_err(|_|Failure::unavailable())?.results::<Pending>().map_err(|_|Failure::unavailable())?;
    for row in rows {
        for _ in 0..8 {
            if backfill(db, &row.participant_id).await? {
                break;
            }
        }
    }
    Ok(())
}
