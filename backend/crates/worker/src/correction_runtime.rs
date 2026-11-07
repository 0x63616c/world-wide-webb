//! Explicit historical correction: frozen new version, preview digest, then audited publication.
use crate::{
    admin_auth::Administrator,
    auth_runtime::{Configuration, Failure, blob, now, number, statement, text, uuid},
    finalization_runtime::Period,
};
use askama::Template;
use folding_domain::wire::Id;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use worker::*;
#[derive(Deserialize, Serialize)]
struct Correction {
    correction_id: String,
    period_id: String,
    base_version: i64,
    version: i64,
    actor: String,
    reason: String,
    normalized_hash: Vec<u8>,
    state: String,
    created_at_ms: i64,
    expires_at_ms: i64,
    decision_watermark: i64,
    preview_hash: Option<String>,
    publish_operation_id: Option<String>,
    published_at_ms: Option<i64>,
}
#[derive(Deserialize, Serialize)]
struct ResultRow {
    participant_id: String,
    generation_revision: i64,
    generation_id: String,
    joined_at_ms: i64,
    folds: i64,
    rank: i64,
    population: i64,
    percentile: Option<i64>,
    medal: Option<String>,
}
#[derive(Deserialize)]
struct Delta {
    participant_id: String,
    old_folds: i64,
    new_folds: i64,
    old_rank: i64,
    new_rank: i64,
}
#[derive(Template)]
#[template(path = "correction.html")]
struct Page {
    period: String,
    path: String,
    version: i64,
    csrf: String,
    operation: String,
    correction_id: String,
    hash: String,
    state: String,
    reason: String,
    rows: Vec<Delta>,
    count: usize,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Command {
    operation_id: Id,
    csrf_token: String,
    expected_version: i64,
    action: String,
    reason: String,
    #[serde(default)]
    correction_id: String,
    #[serde(default)]
    preview_hash: String,
}
fn digest(rows: &[ResultRow]) -> std::result::Result<String, Failure> {
    let bytes = serde_json::to_vec(rows).map_err(|_| Failure::unavailable())?;
    Ok(Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect())
}
async fn rows(
    db: &D1Database,
    period: &str,
    version: i64,
) -> std::result::Result<Vec<ResultRow>, Failure> {
    statement(db,"SELECT r.participant_id,r.generation_revision,r.generation_id,r.joined_at_ms,r.folds,r.rank,r.population,r.percentile,r.medal FROM results r JOIN participants p ON p.participant_id=r.participant_id JOIN epochs e ON e.epoch_id=p.epoch_id WHERE r.period_id=?1 AND r.version=?2 AND p.account_state='active' AND p.membership='joined' AND p.restriction='none' AND p.generation_revision=r.generation_revision AND p.generation_id=r.generation_id AND e.joined_at_ms=r.joined_at_ms AND e.closed_at_ms IS NULL ORDER BY r.participant_id",&[text(period),number(version)])?.all().await.map_err(|_|Failure::unavailable())?.results().map_err(|_|Failure::unavailable())
}
fn path(period: &str) -> String {
    format!(
        "/admin/periods/{}",
        percent_encoding::utf8_percent_encode(period, percent_encoding::NON_ALPHANUMERIC)
    )
}
fn redirect(period: &str) -> std::result::Result<Response, Failure> {
    let mut r = Response::empty()
        .map_err(|_| Failure::unavailable())?
        .with_status(303);
    r.headers_mut()
        .set("Location", &path(period))
        .map_err(|_| Failure::unavailable())?;
    r.headers_mut()
        .set("Cache-Control", "no-store")
        .map_err(|_| Failure::unavailable())?;
    Ok(r)
}
pub(crate) async fn admin(
    request: &Request,
    db: &D1Database,
    config: &Configuration,
    admin: &Administrator,
    body: &[u8],
    period: &str,
) -> std::result::Result<Response, Failure> {
    #[derive(Deserialize)]
    struct Published {
        published_version: i64,
        state: String,
    }
    let published = statement(
        db,
        "SELECT published_version,state FROM periods WHERE period_id=?1",
        &[text(period)],
    )?
    .first::<Published>(None)
    .await
    .map_err(|_| Failure::unavailable())?
    .ok_or(Failure {
        status: 404,
        code: "not_found",
        retryable: false,
    })?;
    if published.state != "finalized" {
        return Err(Failure::conflict());
    }
    if request.method() == Method::Get {
        let correction = statement(
            db,
            "SELECT * FROM period_corrections WHERE period_id=?1 ORDER BY version DESC LIMIT 1",
            &[text(period)],
        )?
        .first::<Correction>(None)
        .await
        .map_err(|_| Failure::unavailable())?;
        let mut page = Page {
            period: period.into(),
            path: format!("{}/corrections", path(period)),
            version: published.published_version,
            csrf: admin.csrf.clone(),
            operation: uuid()?,
            correction_id: String::new(),
            hash: String::new(),
            state: "none".into(),
            reason: String::new(),
            rows: vec![],
            count: 0,
        };
        if let Some(c) = correction {
            page.state = c.state.clone();
            page.reason = c.reason;
            page.correction_id = c.correction_id;
            page.hash = c.preview_hash.unwrap_or_default();
            if c.state == "ready"
                && (c.expires_at_ms <= now()
                    || c.actor != admin.actor
                    || c.base_version != published.published_version)
            {
                page.state = "unavailable".into();
            }
            if c.state == "ready" {
                page.rows=statement(db,"WITH ids AS (SELECT participant_id FROM results WHERE period_id=?1 AND version IN(?2,?3)) SELECT i.participant_id,COALESCE(a.folds,0) AS old_folds,COALESCE(b.folds,0) AS new_folds,COALESCE(a.rank,0) AS old_rank,COALESCE(b.rank,0) AS new_rank FROM ids i LEFT JOIN results a ON a.period_id=?1 AND a.version=?2 AND a.participant_id=i.participant_id LEFT JOIN results b ON b.period_id=?1 AND b.version=?3 AND b.participant_id=i.participant_id WHERE COALESCE(a.folds,0)<>COALESCE(b.folds,0) OR COALESCE(a.rank,0)<>COALESCE(b.rank,0) ORDER BY i.participant_id",&[text(period),number(c.base_version),number(c.version)])?.all().await.map_err(|_|Failure::unavailable())?.results().map_err(|_|Failure::unavailable())?;
                page.count = page.rows.len();
            }
        }
        return crate::admin_runtime::secure_html(
            page.render().map_err(|_| Failure::unavailable())?,
        );
    }
    if request.method() != Method::Post
        || !request.path().ends_with("/corrections")
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
    let mut command: Command =
        serde_urlencoded::from_bytes(body).map_err(|_| Failure::malformed())?;
    admin.check_csrf(request, &command.csrf_token, config)?;
    if command.expected_version < 1
        || !crate::admin_runtime::valid_reason(&command.reason)
        || command.reason.chars().any(|c| c.is_control() && c != '\n')
    {
        return Err(Failure::malformed());
    }
    command.csrf_token.clear();
    let hash = Sha256::digest(serde_json::to_vec(&command).map_err(|_| Failure::unavailable())?);
    match command.action.as_str() {
        "preview" => create(db, admin, period, &command, &hash).await?,
        "publish" => publish(db, admin, period, &command, &hash).await?,
        _ => return Err(Failure::malformed()),
    };
    redirect(period)
}
async fn create(
    db: &D1Database,
    admin: &Administrator,
    period: &str,
    command: &Command,
    hash: &[u8],
) -> std::result::Result<(), Failure> {
    if let Some(old) = statement(
        db,
        "SELECT * FROM period_corrections WHERE correction_id=?1",
        &[text(command.operation_id.as_str())],
    )?
    .first::<Correction>(None)
    .await
    .map_err(|_| Failure::unavailable())?
    {
        if old.actor == admin.actor && old.period_id == period && old.normalized_hash == hash {
            return Ok(());
        }
        return Err(Failure::conflict());
    }
    let guard = uuid()?;
    let time = now();
    // The same transaction captures a new current-decision snapshot from the original eligible roster.
    // A reset/deleted roster cannot be recreated, and post-cutoff uploads stay ineligible.
    db.batch(vec![
 statement(db,"INSERT INTO mutation_guards VALUES (?1,CASE WHEN EXISTS(SELECT 1 FROM periods WHERE period_id=?2 AND state='finalized' AND published_version=?3) THEN 1 ELSE 0 END)",&[text(&guard),text(period),number(command.expected_version)])?,
 statement(db,"UPDATE period_corrections SET state='expired' WHERE period_id=?1 AND state IN('building','ready') AND expires_at_ms<=?2",&[text(period),number(time)])?,
 statement(db,"INSERT INTO period_corrections(correction_id,period_id,base_version,version,actor,reason,normalized_hash,state,created_at_ms,expires_at_ms,decision_watermark) SELECT ?1,?2,?3,MAX(?3,COALESCE((SELECT max(version) FROM period_corrections WHERE period_id=?2),0))+1,?4,?5,?6,'building',?7,?7+3600000,(SELECT version FROM decision_clock WHERE singleton=1)",&[text(command.operation_id.as_str()),text(period),number(command.expected_version),text(&admin.actor),text(&command.reason),blob(hash),number(time)])?,
 statement(db,"INSERT INTO period_roster SELECT r.period_id,c.version,r.participant_id,r.generation_revision,r.generation_id,r.joined_at_ms,'pending' FROM period_roster r JOIN period_corrections c ON c.period_id=r.period_id AND c.correction_id=?1 JOIN participants p ON p.participant_id=r.participant_id JOIN epochs e ON e.epoch_id=p.epoch_id WHERE r.version=c.base_version AND p.account_state='active' AND p.membership='joined' AND p.restriction='none' AND p.generation_revision=r.generation_revision AND p.generation_id=r.generation_id AND e.joined_at_ms=r.joined_at_ms AND e.closed_at_ms IS NULL",&[text(command.operation_id.as_str())])?,
 statement(db,"INSERT INTO finalization_inputs SELECT r.period_id,r.version,r.participant_id,o.event_id,o.event_json,o.decision_version,o.received_at_ms FROM period_roster r JOIN period_corrections c ON c.period_id=r.period_id AND c.version=r.version JOIN periods d ON d.period_id=r.period_id JOIN observations o ON o.participant_id=r.participant_id WHERE c.correction_id=?1 AND o.disposition='accepted' AND o.received_at_ms<d.cutoff_ms AND o.decision_version<=c.decision_watermark AND json_extract(o.event_json,'$.generation.revision')=r.generation_revision AND json_extract(o.event_json,'$.generation.reset_id')=r.generation_id",&[text(command.operation_id.as_str())])?,
 statement(db,"DELETE FROM mutation_guards WHERE guard_id=?1",&[text(&guard)])?
 ]).await.map_err(|_|Failure::conflict())?;
    Ok(())
}
pub(crate) async fn dispatch(db: &D1Database) -> std::result::Result<(), Failure> {
    statement(db,"UPDATE period_corrections SET state='expired' WHERE state IN('building','ready') AND expires_at_ms<=?1",&[number(now())])?.run().await.map_err(|_|Failure::unavailable())?;
    let work=statement(db,"SELECT c.period_id,d.start_ms,d.end_ms,d.cutoff_ms,c.version AS target_version FROM period_corrections c JOIN periods d ON d.period_id=c.period_id WHERE c.state='building' AND c.base_version=d.published_version ORDER BY c.created_at_ms LIMIT 4",&[])?.all().await.map_err(|_|Failure::unavailable())?.results::<Period>().map_err(|_|Failure::unavailable())?;
    for period in work {
        crate::finalization_runtime::stage(db, &period).await?;
        crate::finalization_runtime::suppress(db, &period.period_id, period.target_version).await?;
        #[derive(Deserialize)]
        struct Count {
            count: i64,
        }
        let pending=statement(db,"SELECT count(*) AS count FROM period_roster WHERE period_id=?1 AND version=?2 AND state='pending'",&[text(&period.period_id),number(period.target_version)])?.first::<Count>(None).await.map_err(|_|Failure::unavailable())?.ok_or_else(Failure::unavailable)?;
        if pending.count != 0 {
            continue;
        }
        let guard = uuid()?;
        db.batch(vec![statement(db,"INSERT INTO mutation_guards VALUES (?1,CASE WHEN EXISTS(SELECT 1 FROM period_corrections c JOIN periods p ON p.period_id=c.period_id WHERE c.period_id=?2 AND c.version=?3 AND c.state='building' AND c.base_version=p.published_version AND c.expires_at_ms>?4) AND NOT EXISTS(SELECT 1 FROM period_roster WHERE period_id=?2 AND version=?3 AND state='pending') THEN 1 ELSE 0 END)",&[text(&guard),text(&period.period_id),number(period.target_version),number(now())])?,statement(db,"DELETE FROM results WHERE period_id=?1 AND version=?2",&[text(&period.period_id),number(period.target_version)])?,statement(db,crate::finalization_runtime::PUBLISH_RESULTS,&[text(&period.period_id),number(period.target_version)])?,statement(db,"DELETE FROM mutation_guards WHERE guard_id=?1",&[text(&guard)])?]).await.map_err(|_|Failure::conflict())?;
        let preview = rows(db, &period.period_id, period.target_version).await?;
        statement(db,"UPDATE period_corrections SET state='ready',preview_hash=?1,expires_at_ms=?2 WHERE period_id=?3 AND version=?4 AND state='building'",&[text(&digest(&preview)?),number(now()+600000),text(&period.period_id),number(period.target_version)])?.run().await.map_err(|_|Failure::unavailable())?;
    }
    // Unpublished expired copies have no public historical purpose. Keep only non-content audit metadata.
    db.batch(vec![statement(db,"DELETE FROM results WHERE EXISTS(SELECT 1 FROM period_corrections c WHERE c.period_id=results.period_id AND c.version=results.version AND c.state='expired')",&[])?,statement(db,"DELETE FROM period_roster WHERE EXISTS(SELECT 1 FROM period_corrections c WHERE c.period_id=period_roster.period_id AND c.version=period_roster.version AND c.state='expired')",&[])?]).await.map_err(|_|Failure::unavailable())?;
    Ok(())
}
async fn publish(
    db: &D1Database,
    admin: &Administrator,
    period: &str,
    command: &Command,
    hash: &[u8],
) -> std::result::Result<(), Failure> {
    #[derive(Deserialize)]
    struct Receipt {
        actor: String,
        normalized_hash: Vec<u8>,
    }
    if let Some(old) = statement(
        db,
        "SELECT actor,normalized_hash FROM operational_audit WHERE operation_id=?1",
        &[text(command.operation_id.as_str())],
    )?
    .first::<Receipt>(None)
    .await
    .map_err(|_| Failure::unavailable())?
    {
        if old.actor == admin.actor && old.normalized_hash == hash {
            return Ok(());
        }
        return Err(Failure::conflict());
    }
    let id = Id::parse(&command.correction_id).map_err(|_| Failure::malformed())?;
    let correction = statement(
        db,
        "SELECT * FROM period_corrections WHERE correction_id=?1 AND period_id=?2",
        &[text(id.as_str()), text(period)],
    )?
    .first::<Correction>(None)
    .await
    .map_err(|_| Failure::unavailable())?
    .ok_or_else(Failure::conflict)?;
    if correction.state != "ready"
        || correction.actor != admin.actor
        || correction.expires_at_ms <= now()
        || correction.base_version != command.expected_version
        || correction.preview_hash.as_deref() != Some(command.preview_hash.as_str())
    {
        return Err(Failure::conflict());
    }
    let preview = rows(db, period, correction.version).await?;
    if digest(&preview)? != command.preview_hash {
        return Err(Failure::conflict());
    }
    let guard = uuid()?;
    let time = now();
    let before = serde_json::json!({"period_id":period,"version":correction.base_version});
    let after = serde_json::json!({"period_id":period,"version":correction.version,"correction_id":id,"preview_hash":command.preview_hash});
    db.batch(vec![
 statement(db,"INSERT INTO mutation_guards VALUES (?1,CASE WHEN EXISTS(SELECT 1 FROM period_corrections c JOIN periods p ON p.period_id=c.period_id WHERE c.correction_id=?2 AND c.state='ready' AND c.actor=?3 AND c.expires_at_ms>?4 AND c.base_version=p.published_version AND c.preview_hash=?5) AND (SELECT count(*) FROM results WHERE period_id=?6 AND version=?7)=?8 AND NOT EXISTS(SELECT 1 FROM results r WHERE r.period_id=?6 AND r.version=?7 AND NOT EXISTS(SELECT 1 FROM participants p JOIN epochs e ON e.epoch_id=p.epoch_id WHERE p.participant_id=r.participant_id AND p.account_state='active' AND p.membership='joined' AND p.restriction='none' AND p.generation_revision=r.generation_revision AND p.generation_id=r.generation_id AND e.joined_at_ms=r.joined_at_ms AND e.closed_at_ms IS NULL)) THEN 1 ELSE 0 END)",&[text(&guard),text(id.as_str()),text(&admin.actor),number(time),text(&command.preview_hash),text(period),number(correction.version),number(preview.len() as i64)])?,
 statement(db,"UPDATE periods SET published_version=?1,target_version=?1,population=(SELECT count(*) FROM results WHERE period_id=?2 AND version=?1) WHERE period_id=?2",&[number(correction.version),text(period)])?,
 statement(db,"UPDATE period_corrections SET state='published',publish_operation_id=?1,published_at_ms=?2 WHERE correction_id=?3",&[text(command.operation_id.as_str()),number(time),text(id.as_str())])?,
 statement(db,"INSERT INTO operational_audit VALUES (?1,?2,?3,?4,?5,?6,?7)",&[text(command.operation_id.as_str()),text(&admin.actor),blob(hash),text(&command.reason),text(&before.to_string()),text(&after.to_string()),number(time)])?,
 statement(db,"DELETE FROM mutation_guards WHERE guard_id=?1",&[text(&guard)])?
 ]).await.map_err(|_|Failure::conflict())?;
    // No new original_award job is inserted. Existing unsent jobs recheck the published result.
    Ok(())
}
#[derive(Deserialize)]
struct PeriodItem {
    period_id: String,
    state: String,
    published_version: i64,
    population: i64,
}
struct LinkedPeriod {
    item: PeriodItem,
    path: String,
}
#[derive(Template)]
#[template(path = "periods.html")]
struct PeriodPage {
    rows: Vec<LinkedPeriod>,
    next: String,
}
pub(crate) async fn list(
    request: &Request,
    db: &D1Database,
) -> std::result::Result<Response, Failure> {
    if request.method() != Method::Get {
        return Err(Failure::malformed());
    }
    let url = request.url().map_err(|_| Failure::malformed())?;
    let query: Vec<_> = url.query_pairs().collect();
    if query.len() > 1 || query.iter().any(|(k, v)| k != "after" || v.len() > 128) {
        return Err(Failure::malformed());
    }
    let after = query.first().map(|(_, v)| v.as_ref()).unwrap_or("");
    let rows=statement(db,"SELECT period_id,state,published_version,population FROM periods WHERE (?1='' OR period_id<?1) ORDER BY period_id DESC LIMIT 51",&[text(after)])?.all().await.map_err(|_|Failure::unavailable())?.results::<PeriodItem>().map_err(|_|Failure::unavailable())?;
    let next = if rows.len() > 50 {
        format!(
            "/admin/periods?after={}",
            percent_encoding::utf8_percent_encode(
                &rows[49].period_id,
                percent_encoding::NON_ALPHANUMERIC
            )
        )
    } else {
        String::new()
    };
    let page = PeriodPage {
        rows: rows
            .into_iter()
            .take(50)
            .map(|item| LinkedPeriod {
                path: path(&item.period_id),
                item,
            })
            .collect(),
        next,
    };
    crate::admin_runtime::secure_html(page.render().map_err(|_| Failure::unavailable())?)
}
