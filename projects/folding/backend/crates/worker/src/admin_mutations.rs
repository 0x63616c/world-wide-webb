//! Revision-guarded admin commands posted from the admin pages.
use crate::{
    admin_auth,
    config::Configuration,
    support::{Failure, blob, now, number, statement, text, uuid},
};
use folding_domain::wire::Id;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use unicode_segmentation::UnicodeSegmentation;
use worker::*;
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Command {
    pub(crate) operation_id: Id,
    pub(crate) csrf_token: String,
    pub(crate) participant_id: Id,
    pub(crate) expected_revision: i64,
    pub(crate) action: String,
    pub(crate) reason: String,
    #[serde(default)]
    pub(crate) until_ms: String,
    #[serde(default)]
    pub(crate) event_id: String,
    #[serde(default)]
    pub(crate) confirmation: String,
}
#[derive(Deserialize, Serialize)]
struct State {
    membership: String,
    restriction: String,
    account_state: String,
    nickname: Option<String>,
    revision: i64,
}
#[derive(Deserialize)]
struct Receipt {
    normalized_hash: Vec<u8>,
}
fn redirect() -> std::result::Result<Response, Failure> {
    let mut response = Response::empty()
        .map_err(|_| Failure::unavailable())?
        .with_status(303);
    response
        .headers_mut()
        .set("Location", "/admin/queue")
        .map_err(|_| Failure::unavailable())?;
    response
        .headers_mut()
        .set("Cache-Control", "no-store")
        .map_err(|_| Failure::unavailable())?;
    Ok(response)
}
pub(crate) async fn mutate(
    request: &Request,
    db: &D1Database,
    config: &Configuration,
    admin: &admin_auth::Administrator,
    body: &[u8],
) -> std::result::Result<Response, Failure> {
    if body.len() > 16384 {
        return Err(Failure::malformed());
    }
    let content = request
        .headers()
        .get("Content-Type")
        .map_err(|_| Failure::malformed())?
        .unwrap_or_default();
    if content.split(';').next().map(str::trim) != Some("application/x-www-form-urlencoded") {
        return Err(Failure::malformed());
    }
    let input: Command = serde_urlencoded::from_bytes(body).map_err(|_| Failure::malformed())?;
    admin.check_csrf(request, &input.csrf_token, config)?;
    if input.expected_revision < 0
        || input.reason.len() > 8192
        || !(10..=500).contains(&input.reason.graphemes(true).count())
        || input.reason.chars().any(|c| c.is_control() && c != '\n')
    {
        return Err(Failure::malformed());
    }
    let path = request.path();
    let avatar_id = path
        .strip_prefix("/admin/avatars/")
        .and_then(|v| v.strip_suffix("/decision"));
    if let Some(id) = avatar_id {
        Id::parse(id).map_err(|_| Failure::malformed())?;
    }
    let report_id = path
        .strip_prefix("/admin/reports/")
        .and_then(|v| v.strip_suffix("/decision"));
    if let Some(id) = report_id {
        Id::parse(id).map_err(|_| Failure::malformed())?;
    }
    let names = path == format!("/admin/names/{}/decision", input.participant_id.as_str());
    if !(avatar_id.is_some() && input.action == "remove"
        || report_id.is_some() && ["close", "reopen"].contains(&input.action.as_str())
        || names && input.action == "remove"
        || path == "/admin/moderation"
            && [
                "suspend",
                "ban",
                "unban",
                "review_ban",
                "close_case",
                "quarantine_submission",
                "reinstate_submission",
            ]
            .contains(&input.action.as_str()))
    {
        return Err(Failure::malformed());
    }
    if [
        "ban",
        "suspend",
        "quarantine_submission",
        "remove",
        "close_case",
    ]
    .contains(&input.action.as_str())
        && input.confirmation != "yes"
    {
        return Err(Failure::malformed());
    }
    let mut business = serde_json::to_value(&input).map_err(|_| Failure::unavailable())?;
    business
        .as_object_mut()
        .ok_or_else(Failure::unavailable)?
        .remove("csrf_token");
    business["route"] = serde_json::Value::String(path.clone());
    let hash = Sha256::digest(serde_json::to_vec(&business).map_err(|_| Failure::unavailable())?);
    if let Some(old) = statement(
        db,
        "SELECT normalized_hash FROM moderation_actions WHERE actor=?1 AND operation_id=?2",
        &[text(&admin.actor), text(input.operation_id.as_str())],
    )?
    .first::<Receipt>(None)
    .await
    .map_err(|_| Failure::unavailable())?
    {
        if old.normalized_hash != hash.as_slice() {
            return Err(Failure::conflict());
        }
        return redirect();
    }
    if let Some(id) = avatar_id {
        return crate::avatar_admin::remove(db, admin, &input, id, &hash).await;
    }
    if let Some(id) = report_id {
        return report_decision(db, admin, &input, id, &hash).await;
    }
    let participant = input.participant_id.as_str();
    let before=statement(db,"SELECT p.membership,p.restriction,p.account_state,f.nickname,r.revision FROM participants p JOIN participant_revisions r ON r.participant_id=p.participant_id LEFT JOIN profiles f ON f.participant_id=p.participant_id WHERE p.participant_id=?1",&[text(participant)])?.first::<State>(None).await.map_err(|_|Failure::unavailable())?.ok_or(Failure{status:404,code:"not_found",retryable:false})?;
    if before.revision != input.expected_revision {
        return Err(Failure::conflict());
    }
    let time = now();
    let guard = uuid()?;
    let mut writes = vec![statement(
        db,
        "INSERT INTO mutation_guards VALUES (?1,CASE WHEN EXISTS(SELECT 1 FROM participant_revisions WHERE participant_id=?2 AND revision=?3) THEN 1 ELSE 0 END)",
        &[
            text(&guard),
            text(participant),
            number(input.expected_revision),
        ],
    )?];
    let after = if names {
        if before.account_state != "active" {
            return Err(Failure::conflict());
        }
        writes.push(statement(db,"UPDATE profiles SET nickname='Folder',nickname_status='approved' WHERE participant_id=?1",&[text(participant)])?);
        serde_json::json!({"nickname":"Folder","nickname_status":"approved"})
    } else {
        match input.action.as_str() {
            "ban" => {
                writes.push(statement(db,"UPDATE participants SET restriction='banned',suspended_until_ms=NULL WHERE participant_id=?1",&[text(participant)])?);
                writes.push(statement(db,"INSERT INTO ban_reviews VALUES (?1,?2,?3,'imposed') ON CONFLICT(participant_id) DO UPDATE SET reviewed_at_ms=excluded.reviewed_at_ms,next_review_at_ms=excluded.next_review_at_ms,outcome='imposed'",&[text(participant),number(time),number(time+31536000000)])?);
                writes.extend(crate::lifecycle_runtime::erase_results(db, participant)?);
                serde_json::json!({"restriction":"banned"})
            }
            "suspend" => {
                let until = input
                    .until_ms
                    .parse::<i64>()
                    .map_err(|_| Failure::malformed())?;
                if until <= time || until > time + 31536000000 {
                    return Err(Failure::malformed());
                }
                writes.push(statement(db,"UPDATE participants SET restriction='suspended',suspended_until_ms=?1 WHERE participant_id=?2",&[number(until),text(participant)])?);
                serde_json::json!({"restriction":"suspended","until_ms":until})
            }
            "review_ban" => {
                if before.restriction != "banned" {
                    return Err(Failure::conflict());
                }
                writes.push(statement(db,"INSERT INTO ban_reviews VALUES (?1,?2,?3,'upheld') ON CONFLICT(participant_id) DO UPDATE SET reviewed_at_ms=excluded.reviewed_at_ms,next_review_at_ms=excluded.next_review_at_ms,outcome='upheld'",&[text(participant),number(time),number(time+31536000000)])?);
                serde_json::json!({"restriction":"banned","review_outcome":"upheld","next_review_at_ms":time+31536000000})
            }
            "close_case" => {
                writes.push(statement(db,"INSERT INTO mutation_guards VALUES (?1,CASE WHEN EXISTS(SELECT 1 FROM moderation_cases WHERE participant_id=?2 AND closed_at_ms IS NULL) THEN 1 ELSE 0 END)",&[text(&format!("{guard}-case")),text(participant)])?);
                serde_json::json!({"case_state":"closed","closed_at_ms":time})
            }
            "unban" => {
                writes.push(statement(
                    db,
                    "DELETE FROM ban_reviews WHERE participant_id=?1",
                    &[text(participant)],
                )?);
                writes.push(statement(db,"UPDATE participants SET restriction='none',suspended_until_ms=NULL WHERE participant_id=?1",&[text(participant)])?);
                serde_json::json!({"restriction":"none"})
            }
            _ => {
                let event = Id::parse(&input.event_id).map_err(|_| Failure::malformed())?;
                let reinstate = input.action == "reinstate_submission";
                let (changes, submission) = crate::moderation_scores::change(
                    db,
                    participant,
                    &event,
                    reinstate,
                    input.expected_revision,
                )
                .await?;
                writes.extend(changes);
                serde_json::json!({"submission_id":submission,"disposition":if reinstate{"accepted"}else{"quarantined"}})
            }
        }
    };
    if names {
        writes.push(statement(
            db,
            "DELETE FROM nickname_requests WHERE participant_id=?1",
            &[text(participant)],
        )?);
    }
    writes.push(statement(
        db,
        "INSERT INTO moderation_actions VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        &[
            text(&admin.actor),
            text(input.operation_id.as_str()),
            text(participant),
            text(&input.action),
            text(&input.reason),
            text(&serde_json::to_string(&before).map_err(|_| Failure::unavailable())?),
            text(&after.to_string()),
            blob(&hash),
            number(time),
            number(time + 7776000000),
        ],
    )?);
    if !names && input.action != "review_ban" {
        if input.action != "close_case" {
            writes.push(statement(db,"INSERT INTO moderation_cases SELECT ?1,?2,?3,NULL WHERE NOT EXISTS(SELECT 1 FROM moderation_cases WHERE participant_id=?2 AND closed_at_ms IS NULL)",&[text(&uuid()?),text(participant),number(time)])?);
        }
        writes.push(statement(db,"INSERT INTO moderation_action_cases SELECT ?1,?2,case_id FROM moderation_cases WHERE participant_id=?3 AND closed_at_ms IS NULL",&[text(&admin.actor),text(input.operation_id.as_str()),text(participant)])?);
        if ["close_case", "unban"].contains(&input.action.as_str()) {
            writes.push(statement(db,"UPDATE moderation_actions SET expires_at_ms=?1 WHERE EXISTS(SELECT 1 FROM moderation_action_cases a JOIN moderation_cases c ON c.case_id=a.case_id WHERE a.actor=moderation_actions.actor AND a.operation_id=moderation_actions.operation_id AND c.participant_id=?2 AND c.closed_at_ms IS NULL)",&[number(time+7776000000),text(participant)])?);
            writes.push(statement(db,"UPDATE moderation_cases SET closed_at_ms=?1 WHERE participant_id=?2 AND closed_at_ms IS NULL",&[number(time),text(participant)])?);
        }
        if input.action == "close_case" {
            writes.push(statement(
                db,
                "DELETE FROM mutation_guards WHERE guard_id=?1",
                &[text(&format!("{guard}-case"))],
            )?);
        }
    }
    writes.push(statement(
        db,
        crate::mutation::ADVANCE_REVISION,
        &[text(participant)],
    )?);
    writes.push(statement(
        db,
        "DELETE FROM mutation_guards WHERE guard_id=?1",
        &[text(&guard)],
    )?);
    db.batch(writes).await.map_err(|_| Failure::conflict())?;
    redirect()
}
async fn report_decision(
    db: &D1Database,
    admin: &admin_auth::Administrator,
    input: &Command,
    report: &str,
    hash: &[u8],
) -> std::result::Result<Response, Failure> {
    #[derive(Deserialize, Serialize)]
    struct Case {
        subject_participant_id: String,
        state: String,
        revision: i64,
    }
    let before = statement(
        db,
        "SELECT subject_participant_id,state,revision FROM reports WHERE report_id=?1",
        &[text(report)],
    )?
    .first::<Case>(None)
    .await
    .map_err(|_| Failure::unavailable())?
    .ok_or(Failure {
        status: 404,
        code: "not_found",
        retryable: false,
    })?;
    if before.subject_participant_id != input.participant_id.as_str()
        || before.revision != input.expected_revision
    {
        return Err(Failure::conflict());
    }
    let state = if input.action == "close" {
        "closed"
    } else {
        "pending"
    };
    let time = now();
    let guard = uuid()?;
    db.batch(vec![statement(db,"INSERT INTO mutation_guards VALUES (?1,CASE WHEN EXISTS(SELECT 1 FROM reports WHERE report_id=?2 AND revision=?3 AND subject_participant_id=?4) THEN 1 ELSE 0 END)",&[text(&guard),text(report),number(input.expected_revision),text(input.participant_id.as_str())])?,statement(db,"UPDATE reports SET state=?1,closed_at_ms=?2,revision=revision+1 WHERE report_id=?3",&[text(state),if state=="closed"{number(time)}else{wasm_bindgen::JsValue::NULL},text(report)])?,statement(db,"INSERT INTO moderation_actions VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",&[text(&admin.actor),text(input.operation_id.as_str()),text(input.participant_id.as_str()),text(&format!("report_{}",input.action)),text(&input.reason),text(&serde_json::to_string(&before).map_err(|_|Failure::unavailable())?),text(&serde_json::json!({"report_id":report,"state":state}).to_string()),blob(hash),number(time),number(time+7776000000)])?,statement(db,"DELETE FROM mutation_guards WHERE guard_id=?1",&[text(&guard)])?]).await.map_err(|_|Failure::conflict())?;
    redirect()
}
