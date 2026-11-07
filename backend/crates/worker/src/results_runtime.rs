//! Only atomically published frozen result versions are exposed. Privacy removal never reranks peers.
use crate::auth_runtime::{
    CommunitySession, Configuration, Failure, community_session, now, number, response, statement,
    text,
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use folding_domain::wire::Id;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use worker::*;
#[derive(Deserialize)]
struct Membership {
    membership: String,
}
#[derive(Deserialize)]
struct Period {
    kind: String,
    start_ms: u64,
    end_ms: u64,
    published_version: u64,
    population: u64,
}
#[derive(Deserialize, Serialize)]
struct Entry {
    participant_id: String,
    nickname: String,
    avatar_id: Option<String>,
    folds: u64,
    rank: u64,
    percentile: Option<u64>,
    medal: Option<String>,
}
#[derive(Deserialize, Serialize)]
struct Award {
    period_id: String,
    kind: String,
    start_ms: u64,
    end_ms: u64,
    version: u64,
    finalized_at_ms: u64,
    folds: u64,
    rank: u64,
    population: u64,
    percentile: Option<u64>,
    medal: Option<String>,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Cursor {
    scope: String,
    viewer: String,
    deployment: String,
    limit: usize,
    snapshot: String,
    last: String,
    expires: i64,
}
async fn authorize(
    request: &Request,
    db: &D1Database,
    config: &Configuration,
) -> std::result::Result<CommunitySession, Failure> {
    let session = community_session(request, db, config).await?;
    let m = statement(
        db,
        "SELECT membership FROM participants WHERE participant_id=?1",
        &[text(&session.participant_id)],
    )?
    .first::<Membership>(None)
    .await
    .map_err(|_| Failure::unavailable())?
    .ok_or_else(Failure::unauthorized)?;
    if m.membership != "joined" {
        return Err(Failure {
            status: 403,
            code: "restricted",
            retryable: false,
        });
    }
    Ok(session)
}
async fn fence(
    db: &D1Database,
    config: &Configuration,
    session: &CommunitySession,
) -> std::result::Result<(), Failure> {
    let guard = crate::auth_runtime::uuid()?;
    db.batch(vec![
        crate::auth_runtime::session_guard(db, &guard, session, config, now())?,
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
    Ok(())
}
fn page(
    entries: &[serde_json::Value],
    key: &str,
    scope: &str,
    limit: usize,
    cursor: Option<&String>,
    session: &CommunitySession,
    config: &Configuration,
) -> std::result::Result<serde_json::Value, Failure> {
    let snapshot = crate::assertion::hex(&Sha256::digest(
        serde_json::to_vec(entries).map_err(|_| Failure::unavailable())?,
    ));
    let time = now();
    let start = if let Some(encoded) = cursor {
        if encoded.len() > 4096 {
            return Err(Failure::malformed());
        }
        let (body, signature) = encoded.split_once('.').ok_or_else(Failure::malformed)?;
        let signature = URL_SAFE_NO_PAD
            .decode(signature)
            .map_err(|_| Failure::malformed())?;
        if !crate::secrets::verify_keyed_digest(
            &config.network_key,
            "results-cursor",
            body,
            &signature,
        ) {
            return Err(Failure::malformed());
        }
        let c: Cursor = serde_json::from_slice(
            &URL_SAFE_NO_PAD
                .decode(body)
                .map_err(|_| Failure::malformed())?,
        )
        .map_err(|_| Failure::malformed())?;
        if c.scope != scope
            || c.viewer != session.participant_id
            || c.deployment != config.deployment
            || c.limit != limit
            || c.expires <= time
        {
            return Err(Failure::malformed());
        }
        if c.snapshot != snapshot {
            return Err(Failure {
                status: 409,
                code: "snapshot_changed",
                retryable: true,
            });
        }
        entries
            .iter()
            .position(|v| v[key] == c.last)
            .ok_or_else(Failure::malformed)?
            + 1
    } else {
        0
    };
    let end = (start + limit).min(entries.len());
    let next = if end < entries.len() {
        let c = Cursor {
            scope: scope.into(),
            viewer: session.participant_id.clone(),
            deployment: config.deployment.clone(),
            limit,
            snapshot: snapshot.clone(),
            last: entries[end - 1][key]
                .as_str()
                .ok_or_else(Failure::unavailable)?
                .into(),
            expires: time + 900000,
        };
        let encoded =
            URL_SAFE_NO_PAD.encode(serde_json::to_vec(&c).map_err(|_| Failure::unavailable())?);
        let signature = URL_SAFE_NO_PAD.encode(crate::secrets::keyed_digest(
            &config.network_key,
            "results-cursor",
            &encoded,
        ));
        Some(format!("{encoded}.{signature}"))
    } else {
        None
    };
    Ok(
        serde_json::json!({"items":&entries[start..end],"next_cursor":next,"snapshot_version":snapshot}),
    )
}
pub(crate) async fn board(
    request: &Request,
    db: &D1Database,
    config: &Configuration,
    request_id: &Id,
    query: &BTreeMap<String, String>,
    kind: &str,
    limit: usize,
) -> std::result::Result<Response, Failure> {
    let session = authorize(request, db, config).await?;
    let id = query.get("period_id").ok_or_else(Failure::malformed)?;
    if id.len() > 100 {
        return Err(Failure::malformed());
    }
    let period=statement(db,"SELECT kind,start_ms,end_ms,published_version,population FROM periods WHERE period_id=?1 AND state='finalized' AND published_version>0",&[text(id)])?.first::<Period>(None).await.map_err(|_|Failure::unavailable())?.ok_or(Failure{status:404,code:"not_found",retryable:false})?;
    if period.kind != kind {
        return Err(Failure::malformed());
    }
    let rows=statement(db,"SELECT r.participant_id,f.nickname,f.avatar_id,r.folds,r.rank,r.percentile,r.medal FROM results r JOIN participants p ON p.participant_id=r.participant_id JOIN profiles f ON f.participant_id=p.participant_id JOIN epochs e ON e.epoch_id=p.epoch_id WHERE r.period_id=?1 AND r.version=?2 AND p.membership='joined' AND p.account_state='active' AND p.restriction='none' AND p.generation_revision=r.generation_revision AND p.generation_id=r.generation_id AND e.joined_at_ms=r.joined_at_ms AND NOT EXISTS(SELECT 1 FROM blocks b WHERE b.participant_id=?3 AND b.subject_participant_id=r.participant_id) ORDER BY r.folds DESC,r.participant_id",&[text(id),number(period.published_version as i64),text(&session.participant_id)])?.all().await.map_err(|_|Failure::unavailable())?.results::<Entry>().map_err(|_|Failure::unavailable())?;
    let entries: Vec<_> = rows
        .iter()
        .map(serde_json::to_value)
        .collect::<std::result::Result<_, _>>()
        .map_err(|_| Failure::unavailable())?;
    let page = page(
        &entries,
        "participant_id",
        &format!("board:{id}:{}", period.published_version),
        limit,
        query.get("cursor"),
        &session,
        config,
    )?;
    let you = entries
        .iter()
        .find(|r| r["participant_id"] == session.participant_id);
    fence(db, config, &session).await?;
    response(
        &serde_json::json!({"period":{"id":id,"kind":kind,"start_ms":period.start_ms,"end_ms":period.end_ms,"state":"finalized"},"page":page,"you":you,"population":period.population,"request_id":request_id}),
    )
}
pub(crate) async fn history(
    request: &Request,
    db: &D1Database,
    config: &Configuration,
    request_id: &Id,
) -> std::result::Result<Response, Failure> {
    let session = authorize(request, db, config).await?;
    let path = request.path();
    let url = request.url().map_err(|_| Failure::malformed())?;
    let mut query = BTreeMap::new();
    for (k, v) in url.query_pairs() {
        if !["kind", "limit", "cursor"].contains(&k.as_ref())
            || query.insert(k.into_owned(), v.into_owned()).is_some()
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
    if !["week", "month"].contains(&kind) || !(1..=100).contains(&limit) {
        return Err(Failure::malformed());
    }
    let encoded_share = path
        .strip_prefix("/v1/results/")
        .and_then(|p| p.strip_suffix("/share"));
    let decoded_share = encoded_share
        .map(|id| {
            percent_encoding::percent_decode_str(id)
                .decode_utf8()
                .map(|v| v.into_owned())
                .map_err(|_| Failure::malformed())
        })
        .transpose()?;
    let share = decoded_share.as_deref();
    if path != "/v1/results" && share.is_none() {
        return Err(Failure::malformed());
    }
    if share.is_some_and(|id| id.len() > 100 || id.is_empty()) {
        return Err(Failure::malformed());
    }
    let rows=statement(db,"SELECT r.period_id,d.kind,d.start_ms,d.end_ms,r.version,d.finalized_at_ms,r.folds,r.rank,r.population,r.percentile,r.medal FROM results r JOIN periods d ON d.period_id=r.period_id AND d.published_version=r.version JOIN participants p ON p.participant_id=r.participant_id JOIN epochs e ON e.epoch_id=p.epoch_id WHERE r.participant_id=?1 AND d.state='finalized' AND p.generation_revision=r.generation_revision AND p.generation_id=r.generation_id AND e.joined_at_ms=r.joined_at_ms AND ((?2 IS NULL AND d.kind=?3) OR r.period_id=?2) ORDER BY d.end_ms DESC,r.period_id",&[text(&session.participant_id),share.map(text).unwrap_or(wasm_bindgen::JsValue::NULL),text(kind)])?.all().await.map_err(|_|Failure::unavailable())?.results::<Award>().map_err(|_|Failure::unavailable())?;
    let entries: Vec<_> = rows
        .iter()
        .map(serde_json::to_value)
        .collect::<std::result::Result<_, _>>()
        .map_err(|_| Failure::unavailable())?;
    let value = if share.is_some() {
        #[derive(Deserialize, Serialize)]
        struct Profile {
            nickname: String,
            avatar_id: Option<String>,
        }
        let result = entries.first().ok_or(Failure {
            status: 404,
            code: "not_found",
            retryable: false,
        })?;
        let profile = statement(
            db,
            "SELECT nickname,avatar_id FROM profiles WHERE participant_id=?1",
            &[text(&session.participant_id)],
        )?
        .first::<Profile>(None)
        .await
        .map_err(|_| Failure::unavailable())?
        .ok_or_else(Failure::unavailable)?;
        serde_json::json!({"result":result,"profile":profile,"request_id":request_id})
    } else {
        let mut result = page(
            &entries,
            "period_id",
            &format!("history:{kind}"),
            limit,
            query.get("cursor"),
            &session,
            config,
        )?;
        result["request_id"] =
            serde_json::to_value(request_id).map_err(|_| Failure::unavailable())?;
        result
    };
    fence(db, config, &session).await?;
    response(&value)
}
