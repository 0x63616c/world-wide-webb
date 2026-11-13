//! Session-authorized profile, report and presentation-only block commands.
use crate::auth_runtime::{
    COMMUNITY_GUARD, Configuration, Failure, blob, community_session, decode, now, number,
    response, session_guard, statement, text, uuid,
};
use folding_domain::wire::Id;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use unicode_segmentation::UnicodeSegmentation;
use worker::*;
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ProfileChange {
    operation_id: Id,
    nickname: String,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Report {
    operation_id: Id,
    subject_participant_id: Id,
    #[serde(deserialize_with = "nullable")]
    content_id: Option<Id>,
    reason: Reason,
    #[serde(deserialize_with = "nullable")]
    comment: Option<String>,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum Reason {
    AbusiveName,
    AbusiveAvatar,
    SuspectedCheating,
    Other,
}
fn nullable<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> Result<Option<T>, D::Error> {
    Option::deserialize(d)
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Operation {
    operation_id: Id,
}
#[derive(Deserialize, Serialize)]
struct Profile {
    participant_id: String,
    nickname: String,
    avatar_id: Option<String>,
    membership: String,
    restriction: String,
    nickname_status: String,
    avatar_status: String,
    pending_avatar_id: Option<String>,
}
pub(crate) async fn mutate(
    request: &Request,
    db: &D1Database,
    config: &Configuration,
    body: &[u8],
    request_id: &Id,
) -> std::result::Result<Response, Failure> {
    let session = community_session(request, db, config).await?;
    let path = request.path();
    let (operation, normalized) = match path.as_str() {
        "/v1/profile" => {
            let input: ProfileChange = decode(body)?;
            (
                input.operation_id.clone(),
                serde_json::to_vec(&input).map_err(|_| Failure::unavailable())?,
            )
        }
        "/v1/reports" => {
            let input: Report = decode(body)?;
            (
                input.operation_id.clone(),
                serde_json::to_vec(&input).map_err(|_| Failure::unavailable())?,
            )
        }
        _ if path.starts_with("/v1/blocks/") => {
            let input: Operation = decode(body)?;
            (
                input.operation_id.clone(),
                serde_json::to_vec(&input).map_err(|_| Failure::unavailable())?,
            )
        }
        _ => return Err(Failure::malformed()),
    };
    let route = format!("{} {path}", request.method());
    let hash = Sha256::digest(normalized);
    let guard = uuid()?;
    let time = now();
    let mut writes = vec![
        session_guard(db, &guard, &session, config, time)?,
        statement(
            db,
            COMMUNITY_GUARD,
            &[
                text(&format!("{guard}-community")),
                text(&session.participant_id),
                number(session.revision),
            ],
        )?,
    ];
    if let Some(old) =
        crate::competition_runtime::receipt(db, &session.participant_id, &operation).await?
    {
        if old.route != route || old.normalized_hash != hash.as_slice() {
            return Err(Failure::conflict());
        }
        writes.push(crate::competition_runtime::cleanup(db, &guard)?);
        db.batch(writes).await.map_err(|_| Failure::conflict())?;
        let value: serde_json::Value =
            serde_json::from_str(&old.response_json).map_err(|_| Failure::unavailable())?;
        return response(&value);
    }
    let value = if path == "/v1/profile" {
        if request.method() != Method::Patch {
            return Err(Failure::malformed());
        }
        let input: ProfileChange = decode(body)?;
        let validated =
            crate::name_policy::validate(&input.nickname).map_err(|_| Failure::malformed())?;
        crate::rate_limit::enforce(
            db,
            config,
            "profile-edits",
            &session.participant_id,
            3600000,
            5,
        )
        .await?;
        let mut profile=statement(db,"SELECT p.participant_id,f.nickname,f.avatar_id,p.membership,p.restriction,f.nickname_status,f.avatar_status,(SELECT a.avatar_id FROM avatar_objects a WHERE a.participant_id=p.participant_id AND a.state IN ('uploading','pending') ORDER BY a.created_at_ms DESC,a.avatar_id DESC LIMIT 1) AS pending_avatar_id FROM participants p JOIN profiles f ON f.participant_id=p.participant_id WHERE p.participant_id=?1",&[text(&session.participant_id)])?.first::<Profile>(None).await.map_err(|_|Failure::unavailable())?.ok_or_else(Failure::unavailable)?;
        if validated.display != profile.nickname || profile.nickname_status != "approved" {
            writes.push(statement(
                db,
                "DELETE FROM nickname_requests WHERE participant_id=?1",
                &[text(&session.participant_id)],
            )?);
            writes.push(statement(
                db,
                "UPDATE profiles SET nickname=?1,nickname_status='approved' WHERE participant_id=?2",
                &[text(&validated.display),text(&session.participant_id)],
            )?);
            profile.nickname = validated.display;
            profile.nickname_status = "approved".into();
        }
        serde_json::json!({"operation_id":operation,"profile":profile,"request_id":request_id})
    } else if path == "/v1/reports" {
        if request.method() != Method::Post {
            return Err(Failure::malformed());
        }
        let input: Report = decode(body)?;
        if input.subject_participant_id.as_str() == session.participant_id
            || input.comment.as_ref().is_some_and(|c| {
                c.len() > 8192
                    || c.graphemes(true).count() > 500
                    || c.chars().any(|ch| ch.is_control() && ch != '\n')
            })
        {
            return Err(Failure::malformed());
        }
        crate::rate_limit::enforce(db, config, "reports", &session.participant_id, 86400000, 5)
            .await?;
        writes.push(statement(db,"INSERT INTO mutation_guards VALUES (?1,CASE WHEN EXISTS(SELECT 1 FROM participants WHERE participant_id=?2 AND account_state='active') THEN 1 ELSE 0 END)",&[text(&format!("{guard}-business")),text(input.subject_participant_id.as_str())])?);
        let report = uuid()?;
        let reason = serde_json::to_value(&input.reason).map_err(|_| Failure::unavailable())?;
        writes.push(statement(
            db,
            "INSERT INTO reports(report_id,participant_id,subject_participant_id,content_id,reason,comment,created_at_ms,state) VALUES (?1,?2,?3,?4,?5,?6,?7,'pending')",
            &[
                text(&report),
                text(&session.participant_id),
                text(input.subject_participant_id.as_str()),
                input
                    .content_id
                    .as_ref()
                    .map(|id| text(id.as_str()))
                    .unwrap_or(wasm_bindgen::JsValue::NULL),
                text(reason.as_str().ok_or_else(Failure::unavailable)?),
                input
                    .comment
                    .as_deref()
                    .map(text)
                    .unwrap_or(wasm_bindgen::JsValue::NULL),
                number(time),
            ],
        )?);
        serde_json::json!({"report_id":report,"state":"received","operation_id":operation,"request_id":request_id})
    } else {
        if ![Method::Put, Method::Delete].contains(&request.method()) {
            return Err(Failure::malformed());
        }
        let subject = Id::parse(
            path.strip_prefix("/v1/blocks/")
                .ok_or_else(Failure::malformed)?,
        )
        .map_err(|_| Failure::malformed())?;
        if subject.as_str() == session.participant_id {
            return Err(Failure::malformed());
        }
        crate::rate_limit::enforce(
            db,
            config,
            "block-edits",
            &session.participant_id,
            60000,
            60,
        )
        .await?;
        let blocked = request.method() == Method::Put;
        writes.push(statement(db,if blocked{"INSERT INTO blocks VALUES (?1,?2) ON CONFLICT(participant_id,subject_participant_id) DO NOTHING"}else{"DELETE FROM blocks WHERE participant_id=?1 AND subject_participant_id=?2"},&[text(&session.participant_id),text(subject.as_str())])?);
        serde_json::json!({"operation_id":operation,"blocked":blocked,"request_id":request_id})
    };
    writes.push(statement(
        db,
        "INSERT INTO competition_operations VALUES (?1,?2,?3,?4,?5)",
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

pub(crate) async fn blocks(
    request: &Request,
    db: &D1Database,
    config: &Configuration,
    request_id: &Id,
) -> Result<Response, Failure> {
    let session = community_session(request, db, config).await?;
    let url = request.url().map_err(|_| Failure::malformed())?;
    let mut query = std::collections::BTreeMap::new();
    for (k, v) in url.query_pairs() {
        if !["limit", "cursor"].contains(&k.as_ref())
            || query.insert(k.into_owned(), v.into_owned()).is_some()
        {
            return Err(Failure::malformed());
        }
    }
    let limit = query
        .get("limit")
        .map(|v| v.parse::<usize>())
        .transpose()
        .map_err(|_| Failure::malformed())?
        .unwrap_or(50);
    if !(1..=100).contains(&limit) {
        return Err(Failure::malformed());
    }
    #[derive(Deserialize, Serialize)]
    struct Block {
        participant_id: String,
    }
    let rows=statement(db,"SELECT subject_participant_id AS participant_id FROM blocks WHERE participant_id=?1 ORDER BY subject_participant_id",&[text(&session.participant_id)])?.all().await.map_err(|_|Failure::unavailable())?.results::<Block>().map_err(|_|Failure::unavailable())?;
    let entries: Vec<_> = rows
        .iter()
        .map(serde_json::to_value)
        .collect::<Result<_, _>>()
        .map_err(|_| Failure::unavailable())?;
    let mut page = crate::results_runtime::page(
        &entries,
        "participant_id",
        "blocks",
        limit,
        query.get("cursor"),
        &session,
        config,
    )?;
    page["request_id"] = serde_json::to_value(request_id).map_err(|_| Failure::unavailable())?;
    crate::results_runtime::fence(db, config, &session).await?;
    response(&page)
}
