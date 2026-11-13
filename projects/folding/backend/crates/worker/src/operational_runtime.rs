//! Audited minimum-build policy and operational failure reporting.
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
pub(crate) struct Controls {
    pub revision: i64,
    pub notification_failure: Option<String>,
    pub minimum_ios_build: i64,
}
pub(crate) async fn controls(db: &D1Database) -> std::result::Result<Controls, Failure> {
    statement(db,"SELECT revision,notification_failure,minimum_ios_build FROM administrative_configuration WHERE singleton=1",&[])?.first(None).await.map_err(|_|Failure::unavailable())?.ok_or_else(Failure::unavailable)
}
#[derive(Template)]
#[template(path = "operations.html")]
struct Page {
    csrf: String,
    operation: String,
    controls: Controls,
    history: Vec<Audit>,
    alerts: Vec<crate::monitoring_runtime::Alert>,
}
#[derive(Deserialize)]
struct Audit {
    actor: String,
    reason: String,
    created_at_ms: i64,
    after_json: String,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Change {
    operation_id: Id,
    csrf_token: String,
    expected_revision: i64,
    reason: String,
    minimum_ios_build: i64,
}
pub(crate) async fn admin(
    request: &Request,
    db: &D1Database,
    config: &Configuration,
    admin: &Administrator,
    body: &[u8],
) -> std::result::Result<Response, Failure> {
    if request.method() == Method::Get {
        let history=statement(db,"SELECT actor,reason,created_at_ms,after_json FROM operational_audit ORDER BY created_at_ms DESC LIMIT 50",&[])?.all().await.map_err(|_|Failure::unavailable())?.results().map_err(|_|Failure::unavailable())?;
        let page = Page {
            csrf: admin.csrf.clone(),
            operation: uuid()?,
            controls: controls(db).await?,
            history,
            alerts: crate::monitoring_runtime::alerts(db).await?,
        };
        return crate::admin_runtime::secure_html(
            page.render().map_err(|_| Failure::unavailable())?,
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
    let mut input: Change = serde_urlencoded::from_bytes(body).map_err(|_| Failure::malformed())?;
    admin.check_csrf(request, &input.csrf_token, config)?;
    if input.expected_revision < 0
        || !(0..=i64::from(i32::MAX)).contains(&input.minimum_ios_build)
        || !crate::admin_runtime::valid_reason(&input.reason)
        || input.reason.chars().any(|c| c.is_control() && c != '\n')
    {
        return Err(Failure::malformed());
    }
    input.csrf_token.clear();
    let hash = Sha256::digest(serde_json::to_vec(&input).map_err(|_| Failure::unavailable())?);
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
        if old.actor != admin.actor || old.normalized_hash != hash.as_slice() {
            return Err(Failure::conflict());
        }
        crate::client_policy_runtime::invalidate();
        return redirect();
    }
    let before = controls(db).await?;
    if before.revision != input.expected_revision {
        return Err(Failure::conflict());
    }
    let after = Controls {
        revision: before.revision + 1,
        notification_failure: before.notification_failure.clone(),
        minimum_ios_build: input.minimum_ios_build,
    };
    let guard = uuid()?;
    db.batch(vec![statement(db,"INSERT INTO mutation_guards VALUES (?1,CASE WHEN EXISTS(SELECT 1 FROM administrative_configuration WHERE singleton=1 AND revision=?2) THEN 1 ELSE 0 END)",&[text(&guard),number(before.revision)])?,statement(db,"UPDATE administrative_configuration SET revision=revision+1,minimum_ios_build=?1 WHERE singleton=1",&[number(after.minimum_ios_build)])?,statement(db,"INSERT INTO operational_audit VALUES (?1,?2,?3,?4,?5,?6,?7)",&[text(input.operation_id.as_str()),text(&admin.actor),blob(&hash),text(&input.reason),text(&serde_json::to_string(&before).map_err(|_|Failure::unavailable())?),text(&serde_json::to_string(&after).map_err(|_|Failure::unavailable())?),number(now())])?,statement(db,"DELETE FROM mutation_guards WHERE guard_id=?1",&[text(&guard)])?]).await.map_err(|_|Failure::conflict())?;
    crate::client_policy_runtime::invalidate();
    redirect()
}
fn redirect() -> std::result::Result<Response, Failure> {
    let mut r = Response::empty()
        .map_err(|_| Failure::unavailable())?
        .with_status(303);
    r.headers_mut()
        .set("Location", "/admin/config")
        .map_err(|_| Failure::unavailable())?;
    r.headers_mut()
        .set("Cache-Control", "no-store")
        .map_err(|_| Failure::unavailable())?;
    Ok(r)
}
/// Report provider failures without disabling the feature or changing the update policy.
pub(crate) async fn record_notification_failure(
    db: &D1Database,
    reason: &str,
) -> std::result::Result<(), Failure> {
    statement(db, "UPDATE administrative_configuration SET notification_failure=?1 WHERE singleton=1 AND (notification_failure IS NULL OR notification_failure<>?1)", &[text(reason)])?
        .run().await.map_err(|_| Failure::unavailable())?;
    console_error!("apns_provider_failure_check_admin_config");
    Ok(())
}
