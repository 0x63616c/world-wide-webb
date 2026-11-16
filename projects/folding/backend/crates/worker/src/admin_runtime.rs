//! Small escaped admin tables and admin routing. No client-supplied administrator role.
//! Revision-guarded commands are in `admin_mutations`.
use crate::{
    admin_auth,
    config::Configuration,
    support::{Failure, now, number, statement, text, uuid},
};
use askama::Template;
use folding_domain::wire::Id;
use serde::Deserialize;
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
struct PublicName {
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
pub(crate) fn valid_reason(reason: &str) -> bool {
    reason.len() <= 8192
        && (10..=500).contains(&reason.graphemes(true).count())
        && !reason.chars().any(|c| c.is_control() && c != '\n')
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
pub(crate) async fn dispatch(
    request: &Request,
    env: &Env,
    body: &[u8],
) -> std::result::Result<Response, Failure> {
    let config = Configuration::load(env)?;
    let admin = admin_auth::authorize(request, env, &config).await?;
    let db = env.d1("DB").map_err(|_| Failure::unavailable())?;
    if request.path() == "/admin/bots" {
        return crate::bots_admin::admin(request, env, &db, &config, &admin, body).await;
    }
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
        return crate::admin_mutations::mutate(request, &db, &config, &admin, body).await;
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
            state: String,
            avatar_id: String,
            participant_id: String,
            revision: i64,
        }
        let rows=statement(&db,"SELECT avatar_id,participant_id,revision,state FROM avatar_objects WHERE state IN ('pending','approved') AND avatar_id>?1 ORDER BY avatar_id LIMIT 51",&[text(after)])?.all().await.map_err(|_|Failure::unavailable())?.results::<PendingAvatar>().map_err(|_|Failure::unavailable())?;
        for row in rows.iter().take(50) {
            page.rows.push(Row {
                image: format!("/admin/avatars/{}/image", row.avatar_id),
                participant: row.participant_id.clone(),
                label: row.avatar_id.clone(),
                details: format!("{} photo", row.state),
                path: format!("/admin/avatars/{}/decision", row.avatar_id),
                revision: row.revision,
                event_id: String::new(),
                operation: uuid()?,
                actions: vec!["remove".into()],
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
                actions: if matches!(
                    row.reason_code.as_deref(),
                    Some("moderator_quarantine" | "future_timestamp" | "clock_reversal")
                ) {
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
        page.title = "Names".into();
        let rows=statement(&db,"SELECT f.participant_id,f.nickname AS requested_nickname,r.revision FROM profiles f JOIN participant_revisions r ON r.participant_id=f.participant_id JOIN participants p ON p.participant_id=f.participant_id WHERE f.participant_id>?1 AND p.account_state='active' ORDER BY f.participant_id LIMIT 51",&[text(after)])?.all().await.map_err(|_|Failure::unavailable())?.results::<PublicName>().map_err(|_|Failure::unavailable())?;
        for row in rows.iter().take(50) {
            page.rows.push(Row {
                image: String::new(),
                participant: row.participant_id.clone(),
                label: row.requested_nickname.clone(),
                details: "Public name".into(),
                path: format!("/admin/names/{}/decision", row.participant_id),
                revision: row.revision,
                event_id: String::new(),
                operation: uuid()?,
                actions: vec!["remove".into()],
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
