//! Live board snapshots: ranking includes blocked rows; presentation filters them after ranking.
use crate::{
    auth_runtime::{
        Configuration, Failure, community_session, now, number, response, statement, text,
    },
    secrets::{keyed_digest, verify_keyed_digest},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use folding_domain::{competition::rank_scores, wire::Id};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use worker::*;
#[derive(Deserialize)]
struct Membership {
    membership: String,
}
#[derive(Deserialize)]
struct Row {
    participant_id: Id,
    nickname: String,
    avatar_id: Option<Id>,
    folds: u64,
    featured_badge_id: Option<folding_domain::milestones::BadgeId>,
}
#[derive(Deserialize)]
struct Block {
    subject_participant_id: Id,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Cursor {
    participant: String,
    deployment: String,
    period: String,
    limit: usize,
    snapshot: String,
    last_id: Id,
    last_folds: u64,
    expires_at_ms: i64,
}
fn encode(cursor: &Cursor, config: &Configuration) -> std::result::Result<String, Failure> {
    let body =
        URL_SAFE_NO_PAD.encode(serde_json::to_vec(cursor).map_err(|_| Failure::unavailable())?);
    let signature = URL_SAFE_NO_PAD.encode(keyed_digest(
        &config.network_key,
        "leaderboard-cursor",
        &body,
    ));
    Ok(format!("{body}.{signature}"))
}
fn decode(value: &str, config: &Configuration) -> std::result::Result<Cursor, Failure> {
    if value.len() > 4096 {
        return Err(Failure::malformed());
    }
    let (body, signature) = value.split_once('.').ok_or_else(Failure::malformed)?;
    let signature = URL_SAFE_NO_PAD
        .decode(signature)
        .map_err(|_| Failure::malformed())?;
    if !verify_keyed_digest(&config.network_key, "leaderboard-cursor", body, &signature) {
        return Err(Failure::malformed());
    }
    serde_json::from_slice(
        &URL_SAFE_NO_PAD
            .decode(body)
            .map_err(|_| Failure::malformed())?,
    )
    .map_err(|_| Failure::malformed())
}
pub(crate) async fn board(
    request: &Request,
    db: &D1Database,
    config: &Configuration,
    request_id: &Id,
) -> std::result::Result<Response, Failure> {
    let session = community_session(request, db, config).await?;
    let membership = statement(
        db,
        "SELECT membership FROM participants WHERE participant_id=?1",
        &[text(&session.participant_id)],
    )?
    .first::<Membership>(None)
    .await
    .map_err(|_| Failure::unavailable())?
    .ok_or_else(Failure::unauthorized)?;
    if membership.membership != "joined" {
        return Err(Failure {
            status: 403,
            code: "restricted",
            retryable: false,
        });
    }
    let url = request.url().map_err(|_| Failure::malformed())?;
    let mut query = BTreeMap::new();
    for (name, value) in url.query_pairs() {
        if !["kind", "limit", "cursor", "period_id"].contains(&name.as_ref())
            || query
                .insert(name.into_owned(), value.into_owned())
                .is_some()
        {
            return Err(Failure::malformed());
        }
    }
    let kind = query.get("kind").map(String::as_str).unwrap_or("week");
    let limit = query
        .get("limit")
        .map(|v| v.parse::<usize>())
        .transpose()
        .map_err(|_| Failure::malformed())?
        .unwrap_or(50);
    if !["week", "month", "all"].contains(&kind) || !(1..=100).contains(&limit) {
        return Err(Failure::malformed());
    }
    let time = now();
    let windows = crate::periods::current(time as u64).ok_or_else(Failure::unavailable)?;
    let window = windows.iter().find(|w| w.kind == kind);
    let period = window.map(|w| w.id.as_str()).unwrap_or("all");
    if query.get("period_id").is_some_and(|id| id != period) {
        return crate::results_runtime::board(request, db, config, request_id, &query, kind, limit)
            .await;
    }
    let rows=statement(db,"SELECT p.participant_id,f.nickname,f.avatar_id,s.folds,NULL AS featured_badge_id FROM live_scores s JOIN participants p ON p.participant_id=s.participant_id JOIN profiles f ON f.participant_id=p.participant_id WHERE s.period_id=?1 AND s.generation_revision=p.generation_revision AND s.generation_id=p.generation_id AND p.membership='joined' AND p.restriction='none' AND p.account_state='active' AND s.folds>0 ORDER BY p.participant_id",&[text(period)])?.all().await.map_err(|_|Failure::unavailable())?.results::<Row>().map_err(|_|Failure::unavailable())?;
    let blocks = statement(
        db,
        "SELECT subject_participant_id FROM blocks WHERE participant_id=?1",
        &[text(&session.participant_id)],
    )?
    .all()
    .await
    .map_err(|_| Failure::unavailable())?
    .results::<Block>()
    .map_err(|_| Failure::unavailable())?
    .into_iter()
    .map(|b| b.subject_participant_id)
    .collect::<BTreeSet<_>>();
    let scores: Vec<_> = rows
        .iter()
        .map(|r| (r.participant_id.clone(), r.folds))
        .collect();
    let ranks = rank_scores(&scores).map_err(|_| Failure::unavailable())?;
    let population = ranks.len();
    let profiles: BTreeMap<_, _> = rows.iter().map(|r| (&r.participant_id, r)).collect();
    let entries:Vec<_>=ranks.iter().filter(|r|!blocks.contains(&r.participant_id)).map(|r|{let profile=profiles[&r.participant_id];serde_json::json!({"participant_id":r.participant_id,"nickname":profile.nickname,"avatar_id":profile.avatar_id,"folds":r.folds,"rank":r.rank,"percentile":r.percentile,"medal":r.medal,"featured_badge_id":profile.featured_badge_id})}).collect();
    let snapshot = crate::assertion::hex(&Sha256::digest(
        serde_json::to_vec(
            &serde_json::json!({"period":period,"population":population,"entries":entries}),
        )
        .map_err(|_| Failure::unavailable())?,
    ));
    let start = if let Some(value) = query.get("cursor") {
        let cursor = decode(value, config)?;
        if cursor.participant != session.participant_id
            || cursor.deployment != config.deployment
            || cursor.period != period
            || cursor.limit != limit
            || cursor.expires_at_ms <= time
        {
            return Err(Failure::malformed());
        }
        if cursor.snapshot != snapshot {
            return Err(Failure {
                status: 409,
                code: "snapshot_changed",
                retryable: true,
            });
        }
        entries
            .iter()
            .position(|v| {
                v["participant_id"] == cursor.last_id.as_str() && v["folds"] == cursor.last_folds
            })
            .ok_or_else(Failure::malformed)?
            + 1
    } else {
        0
    };
    let end = (start + limit).min(entries.len());
    let items = &entries[start..end];
    let next = if end < entries.len() {
        let last = &entries[end - 1];
        Some(encode(
            &Cursor {
                participant: session.participant_id.clone(),
                deployment: config.deployment.clone(),
                period: period.into(),
                limit,
                snapshot: snapshot.clone(),
                last_id: Id::parse(
                    last["participant_id"]
                        .as_str()
                        .ok_or_else(Failure::unavailable)?,
                )
                .map_err(|_| Failure::unavailable())?,
                last_folds: last["folds"].as_u64().ok_or_else(Failure::unavailable)?,
                expires_at_ms: time + 900000,
            },
            config,
        )?)
    } else {
        None
    };
    let you = entries
        .iter()
        .find(|e| e["participant_id"] == session.participant_id);
    let descriptor = serde_json::json!({"id":period,"kind":kind,"start_ms":window.map(|w|w.start_ms),"end_ms":window.map(|w|w.end_ms),"state":"open"});
    // Recheck current access/revision before disclosing this snapshot.
    let guard = crate::auth_runtime::uuid()?;
    db.batch(vec![
        crate::auth_runtime::session_guard(db, &guard, &session, config, time)?,
        statement(
            db,
            crate::auth_runtime::COMMUNITY_GUARD,
            &[
                text(&format!("{guard}-community")),
                text(&session.participant_id),
                number(session.revision),
            ],
        )?,
        crate::competition_runtime::cleanup(db, &guard)?,
    ])
    .await
    .map_err(|_| Failure::unauthorized())?;
    response(
        &serde_json::json!({"period":descriptor,"page":{"items":items,"next_cursor":next,"snapshot_version":snapshot},"you":you,"population":population,"request_id":request_id}),
    )
}
