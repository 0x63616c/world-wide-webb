//! Explicit failed-job retries preserve logical identity and all downstream eligibility fences.
use crate::{
    admin_auth::Administrator,
    auth_runtime::{Configuration, Failure, blob, now, number, statement, text, uuid},
};
use askama::Template;
use folding_domain::wire::Id;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use worker::*;
#[derive(Deserialize, Serialize)]
struct Failed {
    kind: String,
    id: String,
    period_id: String,
    attempts: i64,
    last_error: Option<String>,
}
struct Row {
    job: Failed,
    operation: String,
    path: String,
}
#[derive(Template)]
#[template(path = "jobs.html")]
struct Page {
    csrf: String,
    rows: Vec<Row>,
    next: String,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Retry {
    operation_id: Id,
    csrf_token: String,
    kind: String,
    period_id: String,
    expected_attempts: i64,
    reason: String,
    confirmation: String,
}
pub(crate) async fn admin(
    request: &Request,
    db: &D1Database,
    config: &Configuration,
    admin: &Administrator,
    body: &[u8],
) -> std::result::Result<Response, Failure> {
    if request.method() == Method::Get && request.path() == "/admin/jobs" {
        let url = request.url().map_err(|_| Failure::malformed())?;
        let query: Vec<_> = url.query_pairs().collect();
        if query.len() > 1 || query.iter().any(|(k, v)| k != "after" || v.len() > 300) {
            return Err(Failure::malformed());
        }
        let after = query.first().map(|(_, v)| v.as_ref()).unwrap_or("");
        let jobs=statement(db,"SELECT kind,id,period_id,attempts,last_error FROM (SELECT 'dispatch' AS kind,job_id AS id,'' AS period_id,attempts,last_error FROM jobs WHERE state='failed' UNION ALL SELECT 'award' AS kind,participant_id AS id,period_id,attempts,last_error FROM award_jobs WHERE state='failed' UNION ALL SELECT 'external' AS kind,retry_id AS id,kind AS period_id,attempts,last_error FROM external_retry_state WHERE state IN('failed','paused')) WHERE kind||'/'||id||'/'||period_id>?1 ORDER BY kind,id,period_id LIMIT 51",&[text(after)])?.all().await.map_err(|_|Failure::unavailable())?.results::<Failed>().map_err(|_|Failure::unavailable())?;
        let next = if jobs.len() > 50 {
            let row = &jobs[49];
            format!(
                "/admin/jobs?after={}",
                percent_encoding::utf8_percent_encode(
                    &format!("{}/{}/{}", row.kind, row.id, row.period_id),
                    percent_encoding::NON_ALPHANUMERIC
                )
            )
        } else {
            String::new()
        };
        let rows = jobs
            .into_iter()
            .take(50)
            .map(|job| {
                Ok(Row {
                    path: format!("/admin/jobs/{}/retry", job.id),
                    job,
                    operation: uuid()?,
                })
            })
            .collect::<std::result::Result<_, Failure>>()?;
        return crate::admin_runtime::secure_html(
            Page {
                csrf: admin.csrf.clone(),
                rows,
                next,
            }
            .render()
            .map_err(|_| Failure::unavailable())?,
        );
    }
    if request.method() != Method::Post
        || body.len() > 16384
        || request
            .headers()
            .get("Content-Type")
            .map_err(|_| Failure::malformed())?
            .unwrap_or_default()
            .split(';')
            .next()
            .map(str::trim)
            != Some("application/x-www-form-urlencoded")
    {
        return Err(Failure::malformed());
    }
    let path = request.path();
    let id = Id::parse(
        path.strip_prefix("/admin/jobs/")
            .and_then(|v| v.strip_suffix("/retry"))
            .ok_or_else(Failure::malformed)?,
    )
    .map_err(|_| Failure::malformed())?;
    let mut input: Retry = serde_urlencoded::from_bytes(body).map_err(|_| Failure::malformed())?;
    admin.check_csrf(request, &input.csrf_token, config)?;
    if input.confirmation != "yes"
        || !["dispatch", "award", "external"].contains(&input.kind.as_str())
        || input.period_id.len() > 128
        || input.expected_attempts < 0
        || !crate::admin_runtime::valid_reason(&input.reason)
        || input.reason.chars().any(|c| c.is_control() && c != '\n')
    {
        return Err(Failure::malformed());
    }
    input.csrf_token.clear();
    let hash = Sha256::digest(
        serde_json::to_vec(&(id.clone(), &input)).map_err(|_| Failure::unavailable())?,
    );
    #[derive(Deserialize)]
    struct Receipt {
        actor: String,
        normalized_hash: Vec<u8>,
    }
    if let Some(old) = statement(
        db,
        "SELECT actor,normalized_hash FROM operational_audit WHERE operation_id=?1",
        &[text(input.operation_id.as_str())],
    )?
    .first::<Receipt>(None)
    .await
    .map_err(|_| Failure::unavailable())?
    {
        if old.actor == admin.actor && old.normalized_hash == hash.as_slice() {
            return redirect();
        }
        return Err(Failure::conflict());
    }
    let guard = uuid()?;
    let mut writes = vec![];
    if input.kind == "dispatch" {
        if !input.period_id.is_empty() {
            return Err(Failure::malformed());
        }
        writes.push(statement(db,"INSERT INTO mutation_guards VALUES (?1,CASE WHEN EXISTS(SELECT 1 FROM jobs WHERE job_id=?2 AND state='failed' AND attempts=?3) THEN 1 ELSE 0 END)",&[text(&guard),text(id.as_str()),number(input.expected_attempts)])?);
        writes.push(statement(db,"UPDATE jobs SET state='pending',attempts=0,due_ms=?1,lease_until_ms=0,published_at_ms=NULL,last_error=NULL WHERE job_id=?2",&[number(now()),text(id.as_str())])?);
    } else if input.kind == "external" {
        writes.push(statement(db,"INSERT INTO mutation_guards VALUES (?1,CASE WHEN EXISTS(SELECT 1 FROM external_retry_state WHERE retry_id=?2 AND kind=?3 AND state IN('failed','paused') AND attempts=?4) THEN 1 ELSE 0 END)",&[text(&guard),text(id.as_str()),text(&input.period_id),number(input.expected_attempts)])?);
        writes.push(statement(db,"UPDATE external_retry_state SET state='pending',attempts=0,next_attempt_ms=0,updated_at_ms=?1,last_error=NULL WHERE retry_id=?2",&[number(now()),text(id.as_str())])?);
    } else {
        writes.push(statement(db,"INSERT INTO mutation_guards VALUES (?1,CASE WHEN EXISTS(SELECT 1 FROM award_jobs WHERE participant_id=?2 AND period_id=?3 AND state='failed' AND attempts=?4) THEN 1 ELSE 0 END)",&[text(&guard),text(id.as_str()),text(&input.period_id),number(input.expected_attempts)])?);
        writes.push(statement(db,"UPDATE award_jobs SET state='pending',attempts=0,due_ms=NULL,lease_until_ms=0,next_attempt_ms=0,last_error=NULL WHERE participant_id=?1 AND period_id=?2 AND state='failed'",&[text(id.as_str()),text(&input.period_id)])?);
    }
    let before = serde_json::json!({"kind":input.kind,"id":id,"period_id":input.period_id,"state":"failed","attempts":input.expected_attempts});
    let after = serde_json::json!({"state":"pending","attempts":0});
    writes.push(statement(
        db,
        "INSERT INTO operational_audit VALUES (?1,?2,?3,?4,?5,?6,?7)",
        &[
            text(input.operation_id.as_str()),
            text(&admin.actor),
            blob(&hash),
            text(&input.reason),
            text(&before.to_string()),
            text(&after.to_string()),
            number(now()),
        ],
    )?);
    writes.push(statement(
        db,
        "DELETE FROM mutation_guards WHERE guard_id=?1",
        &[text(&guard)],
    )?);
    db.batch(writes).await.map_err(|_| Failure::conflict())?;
    redirect()
}
fn redirect() -> std::result::Result<Response, Failure> {
    let mut r = Response::empty()
        .map_err(|_| Failure::unavailable())?
        .with_status(303);
    r.headers_mut()
        .set("Location", "/admin/jobs")
        .map_err(|_| Failure::unavailable())?;
    r.headers_mut()
        .set("Cache-Control", "no-store")
        .map_err(|_| Failure::unavailable())?;
    Ok(r)
}
