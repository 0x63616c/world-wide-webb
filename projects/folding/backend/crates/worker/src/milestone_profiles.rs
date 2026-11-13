//! Explicit public/owner projections and session-authorized badge commands.
use crate::auth_runtime::{
    CommunitySession, Configuration, Failure, blob, community_session, decode, now, number,
    response, session_guard, statement, text, uuid,
};
use folding_domain::{
    milestones::{BadgeId, progress},
    wire::{Generation, Id},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use worker::*;

#[derive(Deserialize)]
struct Participant {
    participant_id: String,
    nickname: String,
    avatar_id: Option<String>,
    generation_revision: u64,
    generation_id: String,
    revision: i64,
}
#[derive(Deserialize, Serialize)]
struct Grant {
    badge_id: BadgeId,
    earned_at_ms: Option<u64>,
    #[serde(deserialize_with = "sqlite_bool")]
    acknowledged: bool,
}
#[derive(Deserialize)]
struct Featured {
    badge_id: BadgeId,
}
fn sqlite_bool<'de, D: serde::Deserializer<'de>>(d: D) -> Result<bool, D::Error> {
    let value = i64::deserialize(d)?;
    match value {
        0 => Ok(false),
        1 => Ok(true),
        _ => Err(serde::de::Error::custom("invalid boolean")),
    }
}
fn missing() -> Failure {
    Failure {
        status: 404,
        code: "not_found",
        retryable: false,
    }
}

async fn participant(db: &D1Database, id: &str) -> Result<Participant, Failure> {
    statement(db,"SELECT p.participant_id,f.nickname,f.avatar_id,p.generation_revision,p.generation_id,r.revision FROM participants p JOIN profiles f ON f.participant_id=p.participant_id JOIN participant_revisions r ON r.participant_id=p.participant_id WHERE p.participant_id=?1 AND p.account_state='active' AND p.membership='joined' AND p.restriction='none'",&[text(id)])?.first::<Participant>(None).await.map_err(|_|Failure::unavailable())?.ok_or_else(missing)
}
fn guards(
    db: &D1Database,
    config: &Configuration,
    session: &CommunitySession,
    target: &Participant,
    id: &str,
) -> Result<Vec<D1PreparedStatement>, Failure> {
    Ok(vec![
        session_guard(db, id, session, config, now())?,
        statement(
            db,
            "INSERT INTO mutation_guards VALUES (?1,CASE WHEN EXISTS(SELECT 1 FROM participants p JOIN participant_revisions r ON r.participant_id=p.participant_id WHERE p.participant_id=?2 AND p.account_state='active' AND p.membership='joined' AND p.restriction='none' AND r.revision=?3) THEN 1 ELSE 0 END)",
            &[
                text(&format!("{id}-community")),
                text(&session.participant_id),
                number(session.revision),
            ],
        )?,
        statement(
            db,
            crate::milestone_sql::SOURCE_GUARD,
            &[
                text(&format!("{id}-business")),
                text(&target.participant_id),
                number(target.revision),
                number(target.generation_revision as i64),
                text(&target.generation_id),
            ],
        )?,
    ])
}
async fn ready(
    db: &D1Database,
    env: &Env,
    target: &Participant,
) -> Result<crate::milestone_runtime::State, Failure> {
    if !crate::milestone_runtime::backfill(db, &target.participant_id).await? {
        crate::jobs_runtime::schedule(env, db).await?;
        return Err(Failure::unavailable());
    }
    crate::milestone_runtime::state(db, &target.participant_id)
        .await?
        .filter(|s| {
            s.state == "ready"
                && s.generation_revision == target.generation_revision
                && s.generation_id == target.generation_id
        })
        .ok_or_else(Failure::conflict)
}
async fn grants(db: &D1Database, id: &str) -> Result<Vec<Grant>, Failure> {
    statement(db,"SELECT g.badge_id,g.earned_at_ms,EXISTS(SELECT 1 FROM milestone_acknowledgments a WHERE a.participant_id=g.participant_id AND a.badge_id=g.badge_id) AS acknowledged FROM milestone_grants g WHERE g.participant_id=?1 ORDER BY g.earned_at_ms DESC,CASE g.badge_id WHEN 'folds_1' THEN 0 WHEN 'folds_100' THEN 1 WHEN 'folds_1000' THEN 2 WHEN 'folds_10000' THEN 3 WHEN 'days_7' THEN 4 ELSE 5 END",&[text(id)])?.all().await.map_err(|_|Failure::unavailable())?.results::<Grant>().map_err(|_|Failure::unavailable())
}
async fn featured(db: &D1Database, id: &str) -> Result<Option<BadgeId>, Failure> {
    Ok(statement(
        db,
        "SELECT badge_id FROM milestone_featured WHERE participant_id=?1",
        &[text(id)],
    )?
    .first::<Featured>(None)
    .await
    .map_err(|_| Failure::unavailable())?
    .map(|f| f.badge_id))
}

pub(crate) async fn read(
    request: &Request,
    env: &Env,
    db: &D1Database,
    config: &Configuration,
    request_id: &Id,
) -> Result<Response, Failure> {
    let session = community_session(request, db, config).await?;
    // Joining, rather than merely having completed native sign-in, is required.
    participant(db, &session.participant_id).await?;
    let path = request.path();
    let owner = path == "/v1/milestones";
    let id = if owner {
        session.participant_id.clone()
    } else {
        Id::parse(
            path.strip_prefix("/v1/participants/")
                .ok_or_else(Failure::malformed)?,
        )
        .map_err(|_| Failure::malformed())?
        .as_str()
        .to_string()
    };
    if request
        .url()
        .map_err(|_| Failure::malformed())?
        .query()
        .is_some()
    {
        return Err(Failure::malformed());
    }
    let block_guard = "INSERT INTO mutation_guards VALUES (?1,CASE WHEN NOT EXISTS(SELECT 1 FROM blocks WHERE participant_id=?2 AND subject_participant_id=?3) THEN 1 ELSE 0 END)";
    // Check before loading identity, then fence again atomically with the final access checks.
    #[derive(Deserialize)]
    struct BlockCount {
        count: i64,
    }
    let blocked = statement(db, "SELECT count(*) AS count FROM blocks WHERE participant_id=?1 AND subject_participant_id=?2", &[text(&session.participant_id), text(&id)])?
        .first::<BlockCount>(None).await.map_err(|_| Failure::unavailable())?.ok_or_else(Failure::unavailable)?;
    if blocked.count != 0 {
        return Err(missing());
    }
    let target = participant(db, &id).await?;
    let state = ready(db, env, &target).await?;
    let value = if owner {
        let awards = grants(db, &id).await?;
        let feature = featured(db, &id).await?;
        serde_json::json!({"generation":{"revision":target.generation_revision,"reset_id":target.generation_id},"revision":target.revision,"progress":progress(state.folds,state.days_used).map_err(|_|Failure::unavailable())?,"grants":awards,"featured_badge_id":feature,"request_id":request_id})
    } else {
        // Keep the established DTO shape for older clients, with no member-visible awards.
        serde_json::json!({"profile":{"participant_id":target.participant_id,"nickname":target.nickname,"avatar_id":target.avatar_id,"folds":state.folds,"earned_badges":[],"featured_badge_id":null},"revision":target.revision,"request_id":request_id})
    };
    let guard = uuid()?;
    let mut fence = guards(db, config, &session, &target, &guard)?;
    fence.push(statement(
        db,
        block_guard,
        &[
            text(&format!("{guard}-block")),
            text(&session.participant_id),
            text(&id),
        ],
    )?);
    fence.push(statement(
        db,
        "DELETE FROM mutation_guards WHERE guard_id=?1",
        &[text(&format!("{guard}-block"))],
    )?);
    fence.push(crate::competition_runtime::cleanup(db, &guard)?);
    db.batch(fence).await.map_err(|_| Failure::conflict())?;
    response(&value)
}

fn nullable<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> Result<Option<T>, D::Error> {
    Option::deserialize(d)
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct FeatureChange {
    operation_id: Id,
    generation: Generation,
    #[serde(deserialize_with = "nullable")]
    badge_id: Option<BadgeId>,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Acknowledgment {
    operation_id: Id,
    generation: Generation,
    badge_ids: Vec<BadgeId>,
}

pub(crate) async fn mutate(
    request: &Request,
    env: &Env,
    db: &D1Database,
    config: &Configuration,
    body: &[u8],
    request_id: &Id,
) -> Result<Response, Failure> {
    let session = community_session(request, db, config).await?;
    let target = participant(db, &session.participant_id).await?;
    let feature = request.path() == "/v1/profile/badge";
    // Featuring is paused. Preserve stored legacy selections for a possible future release.
    if feature {
        return Err(missing());
    }
    let (operation, generation, selected, ids, normalized) = if feature {
        let input: FeatureChange = decode(body)?;
        let json = serde_json::to_vec(&input).map_err(|_| Failure::unavailable())?;
        (
            input.operation_id,
            input.generation,
            input.badge_id,
            vec![],
            json,
        )
    } else {
        let input: Acknowledgment = decode(body)?;
        let unique: BTreeSet<_> = input.badge_ids.iter().copied().collect();
        if input.badge_ids.is_empty()
            || input.badge_ids.len() > 6
            || unique.len() != input.badge_ids.len()
        {
            return Err(Failure::malformed());
        }
        let json = serde_json::to_vec(&input).map_err(|_| Failure::unavailable())?;
        (
            input.operation_id,
            input.generation,
            None,
            input.badge_ids,
            json,
        )
    };
    generation.validate().map_err(|_| Failure::malformed())?;
    if generation.revision != target.generation_revision
        || generation.reset_id.as_str() != target.generation_id
    {
        return Err(Failure {
            status: 409,
            code: "generation_stale",
            retryable: false,
        });
    }
    let route = format!("{} {}", request.method(), request.path());
    let hash = Sha256::digest(normalized);
    let guard = uuid()?;
    let mut writes = guards(db, config, &session, &target, &guard)?;
    if let Some(old) =
        crate::competition_runtime::receipt(db, &session.participant_id, &operation).await?
    {
        if old.route != route || old.normalized_hash != hash.as_slice() {
            return Err(Failure::conflict());
        }
        writes.push(crate::competition_runtime::cleanup(db, &guard)?);
        db.batch(writes).await.map_err(|_| Failure::conflict())?;
        return response(
            &serde_json::from_str::<serde_json::Value>(&old.response_json)
                .map_err(|_| Failure::unavailable())?,
        );
    }
    ready(db, env, &target).await?;
    let earned: BTreeSet<_> = grants(db, &session.participant_id)
        .await?
        .into_iter()
        .map(|g| g.badge_id)
        .collect();
    if selected.is_some_and(|badge| !earned.contains(&badge))
        || ids.iter().any(|id| !earned.contains(id))
    {
        return Err(Failure::malformed());
    }
    let value = if feature {
        crate::rate_limit::enforce(
            db,
            config,
            "profile-edits",
            &session.participant_id,
            3600000,
            5,
        )
        .await?;
        writes.push(statement(
            db,
            "DELETE FROM milestone_featured WHERE participant_id=?1",
            &[text(&session.participant_id)],
        )?);
        if let Some(badge) = selected {
            writes.push(statement(
                db,
                "INSERT INTO milestone_featured VALUES(?1,?2)",
                &[text(&session.participant_id), text(badge.as_str())],
            )?);
        }
        serde_json::json!({"operation_id":operation,"featured_badge_id":selected,"request_id":request_id})
    } else {
        crate::rate_limit::enforce(
            db,
            config,
            "milestone-acks",
            &session.participant_id,
            60000,
            60,
        )
        .await?;
        let ids = serde_json::to_string(&ids).map_err(|_| Failure::unavailable())?;
        writes.push(statement(db,"UPDATE badge_notification_jobs SET state='suppressed',lease_until_ms=0 WHERE participant_id=?1 AND generation_revision=?2 AND generation_id=?3 AND badge_id IN(SELECT value FROM json_each(?4)) AND state='pending'",&[text(&session.participant_id),number(generation.revision as i64),text(generation.reset_id.as_str()),text(&ids)])?);
        writes.push(statement(db,"INSERT INTO milestone_acknowledgments SELECT ?1,value FROM json_each(?2) WHERE true ON CONFLICT(participant_id,badge_id) DO NOTHING",&[text(&session.participant_id),text(&ids)])?);
        serde_json::json!({"operation_id":operation,"state":"completed","request_id":request_id})
    };
    writes.push(statement(
        db,
        "INSERT INTO competition_operations VALUES(?1,?2,?3,?4,?5)",
        &[
            text(&session.participant_id),
            text(operation.as_str()),
            text(&route),
            blob(&hash),
            text(&value.to_string()),
        ],
    )?);
    writes.push(statement(
        db,
        crate::mutation::ADVANCE_REVISION,
        &[text(&session.participant_id)],
    )?);
    writes.push(crate::competition_runtime::cleanup(db, &guard)?);
    db.batch(writes).await.map_err(|_| Failure::conflict())?;
    response(&value)
}
