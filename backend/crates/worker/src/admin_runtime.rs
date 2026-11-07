//! Small escaped admin tables and revision-guarded commands. No client-supplied administrator role.
use crate::{
    admin_auth,
    auth_runtime::{Configuration, Failure, blob, now, number, statement, text, uuid},
};
use askama::Template;
use folding_domain::wire::Id;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use unicode_segmentation::UnicodeSegmentation;
use worker::*;
#[derive(Template)]
#[template(path = "admin.html")]
struct Page {
    title: String,
    rows: Vec<Row>,
    csrf: String,
    next: String,
}
struct Row {
    image: String,
    participant: String,
    label: String,
    details: String,
    path: String,
    revision: i64,
    event_id: String,
    operation: String,
    actions: Vec<String>,
}
#[derive(Deserialize)]
struct Person {
    participant_id: String,
    nickname: String,
    membership: String,
    restriction: String,
    revision: i64,
}
#[derive(Deserialize)]
struct Pending {
    participant_id: String,
    requested_nickname: String,
    revision: i64,
}
#[derive(Deserialize)]
struct Evidence {
    event_id: String,
    event_json: String,
    disposition: String,
    reason_code: Option<String>,
    received_at_ms: i64,
}
#[derive(Deserialize)]
struct Audit {
    cursor: i64,
    participant_id: String,
    actor: String,
    action: String,
    reason: String,
    created_at_ms: i64,
}
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
    requested_nickname: Option<String>,
    revision: i64,
}
#[derive(Deserialize)]
struct Receipt {
    normalized_hash: Vec<u8>,
}
fn html(page: Page) -> std::result::Result<Response, Failure> {
    secure_html(page.render().map_err(|_| Failure::unavailable())?)
}
pub(crate) fn secure_html(html: String) -> std::result::Result<Response, Failure> {
    let mut response = Response::from_html(html).map_err(|_| Failure::unavailable())?;
    for (name, value) in [
        ("Cache-Control", "no-store"),
        ("X-Content-Type-Options", "nosniff"),
        ("Referrer-Policy", "no-referrer"),
        (
            "Content-Security-Policy",
            "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
        ),
    ] {
        response
            .headers_mut()
            .set(name, value)
            .map_err(|_| Failure::unavailable())?;
    }
    Ok(response)
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
pub(crate) async fn dispatch(
    request: &Request,
    env: &Env,
    body: &[u8],
) -> std::result::Result<Response, Failure> {
    let config = Configuration::load(env)?;
    let admin = admin_auth::authorize(request, env, &config).await?;
    let db = env.d1("DB").map_err(|_| Failure::unavailable())?;
    if request.path() == "/admin/jobs" || request.path().starts_with("/admin/jobs/") {
        return crate::jobs_admin::admin(request, &db, &config, &admin, body).await;
    }
    if request.path() == "/admin/periods" {
        return crate::correction_runtime::list(request, &db).await;
    }
    if let Some(raw) = request.path().strip_prefix("/admin/periods/") {
        let raw = raw.strip_suffix("/corrections").unwrap_or(raw);
        let period = percent_encoding::percent_decode_str(raw)
            .decode_utf8()
            .map_err(|_| Failure::malformed())?;
        if period.len() > 128 || period.contains('/') {
            return Err(Failure::malformed());
        }
        return crate::correction_runtime::admin(request, &db, &config, &admin, body, &period)
            .await;
    }
    if request.path() == "/admin/config" {
        return crate::operational_runtime::admin(request, &db, &config, &admin, body).await;
    }
    if request.method() == Method::Post {
        return mutate(request, &db, &config, &admin, body).await;
    }
    if request.method() != Method::Get {
        return Err(Failure::malformed());
    }
    let path = request.path();
    if let Some(id) = path
        .strip_prefix("/admin/avatars/")
        .and_then(|v| v.strip_suffix("/image"))
    {
        return crate::avatar_admin::image(env, &db, id).await;
    }
    let mut page = Page {
        title: "People".into(),
        rows: vec![],
        csrf: admin.csrf,
        next: String::new(),
    };
    let url = request.url().map_err(|_| Failure::malformed())?;
    let query: Vec<_> = url.query_pairs().collect();
    if query.len() > 2
        || query
            .iter()
            .any(|(key, _)| !["after", "kind"].contains(&key.as_ref()))
    {
        return Err(Failure::malformed());
    }
    let after = query
        .iter()
        .find(|(key, _)| key == "after")
        .map(|(_, value)| value.as_ref())
        .unwrap_or("");
    let queue_kind = query
        .iter()
        .find(|(key, _)| key == "kind")
        .map(|(_, value)| value.as_ref())
        .unwrap_or("names");
    if ![
        "names",
        "reports",
        "quarantine",
        "avatars",
        "ban_reviews",
        "cases",
    ]
    .contains(&queue_kind)
    {
        return Err(Failure::malformed());
    }
    if after.len() > 128 {
        return Err(Failure::malformed());
    }
    if !after.is_empty() && path != "/admin/audit" && queue_kind != "quarantine" {
        Id::parse(after).map_err(|_| Failure::malformed())?;
    }
    if !after.is_empty() && queue_kind == "quarantine" {
        let (event, participant) = after.split_once('.').ok_or_else(Failure::malformed)?;
        Id::parse(event).map_err(|_| Failure::malformed())?;
        Id::parse(participant).map_err(|_| Failure::malformed())?;
    }
    if path == "/admin" || path == "/admin/participants" {
        let rows=statement(&db,"SELECT p.participant_id,coalesce(f.nickname,'Deleted') AS nickname,p.membership,p.restriction,r.revision FROM participants p JOIN participant_revisions r ON r.participant_id=p.participant_id LEFT JOIN profiles f ON f.participant_id=p.participant_id WHERE p.participant_id>?1 ORDER BY p.participant_id LIMIT 51",&[text(after)])?.all().await.map_err(|_|Failure::unavailable())?.results::<Person>().map_err(|_|Failure::unavailable())?;
        for row in rows.iter().take(50) {
            page.rows.push(Row {
                image: String::new(),
                participant: row.participant_id.clone(),
                label: row.nickname.clone(),
                details: format!("{} · {}", row.membership, row.restriction),
                path: "/admin/moderation".into(),
                revision: row.revision,
                event_id: String::new(),
                operation: uuid()?,
                actions: vec![
                    "suspend".into(),
                    "ban".into(),
                    "unban".into(),
                    "review_ban".into(),
                    "close_case".into(),
                ],
            });
        }
        if rows.len() > 50 {
            page.next = format!("/admin/participants?after={}", rows[49].participant_id);
        }
    } else if path == "/admin/queue" && ["ban_reviews", "cases"].contains(&queue_kind) {
        page.title = if queue_kind == "cases" {
            "Open cases"
        } else {
            "Ban reviews"
        }
        .into();
        #[derive(Deserialize)]
        struct Review {
            participant_id: String,
            revision: i64,
            due_ms: i64,
        }
        let sql = if queue_kind == "cases" {
            "SELECT c.participant_id,r.revision,c.opened_at_ms AS due_ms FROM moderation_cases c JOIN participant_revisions r ON r.participant_id=c.participant_id WHERE c.closed_at_ms IS NULL AND c.participant_id>?1 ORDER BY c.participant_id LIMIT 51"
        } else {
            "SELECT b.participant_id,r.revision,b.next_review_at_ms AS due_ms FROM ban_reviews b JOIN participant_revisions r ON r.participant_id=b.participant_id JOIN participants p ON p.participant_id=b.participant_id WHERE p.restriction='banned' AND b.next_review_at_ms<=?2 AND b.participant_id>?1 ORDER BY b.participant_id LIMIT 51"
        };
        let values = if queue_kind == "cases" {
            vec![text(after)]
        } else {
            vec![text(after), number(now())]
        };
        let rows = statement(&db, sql, &values)?
            .all()
            .await
            .map_err(|_| Failure::unavailable())?
            .results::<Review>()
            .map_err(|_| Failure::unavailable())?;
        for row in rows.iter().take(50) {
            page.rows.push(Row {
                image: String::new(),
                participant: row.participant_id.clone(),
                label: row.participant_id.clone(),
                details: format!("{}", row.due_ms),
                path: "/admin/moderation".into(),
                revision: row.revision,
                event_id: String::new(),
                operation: uuid()?,
                actions: if queue_kind == "cases" {
                    vec!["close_case".into()]
                } else {
                    vec!["review_ban".into(), "unban".into()]
                },
            });
        }
        if rows.len() > 50 {
            page.next = format!(
                "/admin/queue?kind={queue_kind}&after={}",
                rows[49].participant_id
            );
        }
    } else if path == "/admin/queue" && queue_kind == "avatars" {
        page.title = "Avatars".into();
        #[derive(Deserialize)]
        struct PendingAvatar {
            avatar_id: String,
            participant_id: String,
            revision: i64,
        }
        let rows=statement(&db,"SELECT avatar_id,participant_id,revision FROM avatar_objects WHERE state='pending' AND avatar_id>?1 ORDER BY avatar_id LIMIT 51",&[text(after)])?.all().await.map_err(|_|Failure::unavailable())?.results::<PendingAvatar>().map_err(|_|Failure::unavailable())?;
        for row in rows.iter().take(50) {
            page.rows.push(Row {
                image: format!("/admin/avatars/{}/image", row.avatar_id),
                participant: row.participant_id.clone(),
                label: row.avatar_id.clone(),
                details: "Pending avatar".into(),
                path: format!("/admin/avatars/{}/decision", row.avatar_id),
                revision: row.revision,
                event_id: String::new(),
                operation: uuid()?,
                actions: vec!["approve".into(), "reject".into(), "remove".into()],
            });
        }
        if rows.len() > 50 {
            page.next = format!("/admin/queue?kind=avatars&after={}", rows[49].avatar_id);
        }
    } else if path == "/admin/queue" && queue_kind == "reports" {
        page.title = "Reports".into();
        #[derive(Deserialize)]
        struct ReportRow {
            report_id: String,
            participant_id: String,
            subject_participant_id: String,
            reason: String,
            comment: Option<String>,
            state: String,
            revision: i64,
        }
        let rows=statement(&db,"SELECT report_id,participant_id,subject_participant_id,reason,comment,state,revision FROM reports WHERE report_id>?1 ORDER BY report_id LIMIT 51",&[text(after)])?.all().await.map_err(|_|Failure::unavailable())?.results::<ReportRow>().map_err(|_|Failure::unavailable())?;
        for row in rows.iter().take(50) {
            page.rows.push(Row {
                image: String::new(),
                participant: row.subject_participant_id.clone(),
                label: row.reason.clone(),
                details: format!(
                    "{} · {}\nReporter: {}\n{}",
                    row.report_id,
                    row.state,
                    row.participant_id,
                    row.comment.as_deref().unwrap_or("")
                ),
                path: format!("/admin/reports/{}/decision", row.report_id),
                revision: row.revision,
                event_id: String::new(),
                operation: uuid()?,
                actions: vec!["close".into(), "reopen".into()],
            });
        }
        if rows.len() > 50 {
            page.next = format!("/admin/queue?kind=reports&after={}", rows[49].report_id);
        }
    } else if path == "/admin/queue" && queue_kind == "quarantine" {
        page.title = "Quarantine".into();
        #[derive(Deserialize)]
        struct Quarantine {
            participant_id: String,
            event_id: String,
            reason_code: Option<String>,
            event_json: String,
            revision: i64,
        }
        let rows=statement(&db,"SELECT o.participant_id,o.event_id,o.reason_code,o.event_json,r.revision FROM observations o JOIN participant_revisions r ON r.participant_id=o.participant_id WHERE o.disposition='quarantined' AND o.event_id||'.'||o.participant_id>?1 ORDER BY o.event_id,o.participant_id LIMIT 51",&[text(after)])?.all().await.map_err(|_|Failure::unavailable())?.results::<Quarantine>().map_err(|_|Failure::unavailable())?;
        for row in rows.iter().take(50) {
            page.rows.push(Row {
                image: String::new(),
                participant: row.participant_id.clone(),
                label: row.event_id.clone(),
                details: format!(
                    "{}\n{}",
                    row.reason_code.as_deref().unwrap_or("quarantined"),
                    row.event_json
                ),
                path: "/admin/moderation".into(),
                revision: row.revision,
                event_id: row.event_id.clone(),
                operation: uuid()?,
                actions: if row.reason_code.as_deref() == Some("moderator_quarantine") {
                    vec!["reinstate_submission".into()]
                } else {
                    vec![]
                },
            });
        }
        if rows.len() > 50 {
            page.next = format!(
                "/admin/queue?kind=quarantine&after={}.{}",
                rows[49].event_id, rows[49].participant_id
            );
        }
    } else if path == "/admin/queue" {
        page.title = "Queue".into();
        let rows=statement(&db,"SELECT n.participant_id,n.requested_nickname,r.revision FROM nickname_requests n JOIN participant_revisions r ON r.participant_id=n.participant_id WHERE n.participant_id>?1 ORDER BY n.participant_id LIMIT 51",&[text(after)])?.all().await.map_err(|_|Failure::unavailable())?.results::<Pending>().map_err(|_|Failure::unavailable())?;
        for row in rows.iter().take(50) {
            page.rows.push(Row {
                image: String::new(),
                participant: row.participant_id.clone(),
                label: row.requested_nickname.clone(),
                details: "Pending name".into(),
                path: format!("/admin/names/{}/decision", row.participant_id),
                revision: row.revision,
                event_id: String::new(),
                operation: uuid()?,
                actions: vec!["approve".into(), "reject".into(), "remove".into()],
            });
        }
        if rows.len() > 50 {
            page.next = format!("/admin/queue?after={}", rows[49].participant_id);
        }
    } else if path == "/admin/audit" {
        page.title = "Audit".into();
        let cursor = if after.is_empty() {
            i64::MAX
        } else {
            after.parse::<i64>().map_err(|_| Failure::malformed())?
        };
        let rows=statement(&db,"SELECT rowid AS cursor,participant_id,actor,action,reason,created_at_ms FROM moderation_actions WHERE rowid<?1 ORDER BY rowid DESC LIMIT 51",&[number(cursor)])?.all().await.map_err(|_|Failure::unavailable())?.results::<Audit>().map_err(|_|Failure::unavailable())?;
        if rows.len() > 50 {
            page.next = format!("/admin/audit?after={}", rows[49].cursor);
        }
        for row in rows.into_iter().take(50) {
            page.rows.push(Row {
                image: String::new(),
                participant: row.participant_id,
                label: row.action,
                details: format!("{}\n{}\n{}", row.actor, row.created_at_ms, row.reason),
                path: String::new(),
                revision: 0,
                event_id: String::new(),
                operation: String::new(),
                actions: vec![],
            });
        }
    } else if let Some(id) = path.strip_prefix("/admin/participants/") {
        let id = Id::parse(id).map_err(|_| Failure::malformed())?;
        page.title = "Participant".into();
        let person=statement(&db,"SELECT p.participant_id,coalesce(f.nickname,'Deleted') AS nickname,p.membership,p.restriction,r.revision FROM participants p JOIN participant_revisions r ON r.participant_id=p.participant_id LEFT JOIN profiles f ON f.participant_id=p.participant_id WHERE p.participant_id=?1",&[text(id.as_str())])?.first::<Person>(None).await.map_err(|_|Failure::unavailable())?.ok_or(Failure{status:404,code:"not_found",retryable:false})?;
        page.rows.push(Row {
            image: String::new(),
            participant: person.participant_id.clone(),
            label: person.nickname,
            details: format!("{} · {}", person.membership, person.restriction),
            path: "/admin/moderation".into(),
            revision: person.revision,
            event_id: String::new(),
            operation: uuid()?,
            actions: vec![
                "suspend".into(),
                "ban".into(),
                "unban".into(),
                "review_ban".into(),
                "close_case".into(),
            ],
        });
        let events=statement(&db,"SELECT event_id,event_json,disposition,reason_code,received_at_ms FROM observations WHERE participant_id=?1 AND event_id>?2 ORDER BY event_id LIMIT 51",&[text(id.as_str()),text(after)])?.all().await.map_err(|_|Failure::unavailable())?.results::<Evidence>().map_err(|_|Failure::unavailable())?;
        if events.len() > 50 {
            page.next = format!(
                "/admin/participants/{}?after={}",
                id.as_str(),
                events[49].event_id
            );
        }
        for event in events.into_iter().take(50) {
            page.rows.push(Row {
                image: String::new(),
                participant: person.participant_id.clone(),
                label: event.event_id.clone(),
                details: format!(
                    "{} · {:?} · {}\n{}",
                    event.disposition, event.reason_code, event.received_at_ms, event.event_json
                ),
                path: "/admin/moderation".into(),
                revision: person.revision,
                event_id: event.event_id,
                operation: uuid()?,
                actions: vec![
                    "quarantine_submission".into(),
                    "reinstate_submission".into(),
                ],
            });
        }
    } else {
        return Err(Failure {
            status: 404,
            code: "not_found",
            retryable: false,
        });
    }
    html(page)
}
async fn mutate(
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
    if !(avatar_id.is_some() && ["approve", "reject", "remove"].contains(&input.action.as_str())
        || report_id.is_some() && ["close", "reopen"].contains(&input.action.as_str())
        || names && ["approve", "reject", "remove"].contains(&input.action.as_str())
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
        return crate::avatar_admin::decision(db, admin, &input, id, &hash).await;
    }
    if let Some(id) = report_id {
        return report_decision(db, admin, &input, id, &hash).await;
    }
    let participant = input.participant_id.as_str();
    let before=statement(db,"SELECT p.membership,p.restriction,p.account_state,f.nickname,n.requested_nickname,r.revision FROM participants p JOIN participant_revisions r ON r.participant_id=p.participant_id LEFT JOIN profiles f ON f.participant_id=p.participant_id LEFT JOIN nickname_requests n ON n.participant_id=p.participant_id WHERE p.participant_id=?1",&[text(participant)])?.first::<State>(None).await.map_err(|_|Failure::unavailable())?.ok_or(Failure{status:404,code:"not_found",retryable:false})?;
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
        match input.action.as_str() {
            "approve" => {
                let name = before
                    .requested_nickname
                    .as_ref()
                    .ok_or_else(Failure::conflict)?;
                let name = crate::name_policy::validate(name)
                    .map_err(|_| Failure::malformed())?
                    .display;
                writes.push(statement(db,"UPDATE profiles SET nickname=?1,nickname_status='approved' WHERE participant_id=?2",&[text(&name),text(participant)])?);
                serde_json::json!({"nickname":name,"nickname_status":"approved"})
            }
            "reject" => {
                writes.push(statement(
                    db,
                    "UPDATE profiles SET nickname_status='approved' WHERE participant_id=?1",
                    &[text(participant)],
                )?);
                serde_json::json!({"nickname_status":"approved"})
            }
            _ => {
                writes.push(statement(db,"UPDATE profiles SET nickname='Folder',nickname_status='approved' WHERE participant_id=?1",&[text(participant)])?);
                serde_json::json!({"nickname":"Folder","nickname_status":"approved"})
            }
        }
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
