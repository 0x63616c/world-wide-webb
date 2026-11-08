//! Audited operational controls. Deployment acceptance gates remain separate and fail closed.
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
    pub competition_ingestion_enabled: i64,
    pub result_notifications_enabled: i64,
    pub avatar_uploads_enabled: i64,
    pub notification_failure: Option<String>,
    pub minimum_ios_build: i64,
}
pub(crate) async fn controls(db: &D1Database) -> std::result::Result<Controls, Failure> {
    statement(db,"SELECT revision,competition_ingestion_enabled,result_notifications_enabled,avatar_uploads_enabled,notification_failure,minimum_ios_build FROM administrative_configuration WHERE singleton=1",&[])?.first(None).await.map_err(|_|Failure::unavailable())?.ok_or_else(Failure::unavailable)
}
pub(crate) async fn require(db: &D1Database, kind: &str) -> std::result::Result<(), Failure> {
    let c = controls(db).await?;
    let enabled = match kind {
        "ingestion" => c.competition_ingestion_enabled,
        "avatars" => c.avatar_uploads_enabled,
        "notifications" => c.result_notifications_enabled,
        _ => 0,
    };
    if enabled == 1 {
        Ok(())
    } else {
        Err(Failure::unavailable())
    }
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
    competition_ingestion_enabled: i64,
    result_notifications_enabled: i64,
    avatar_uploads_enabled: i64,
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
        || ![
            input.competition_ingestion_enabled,
            input.result_notifications_enabled,
            input.avatar_uploads_enabled,
        ]
        .iter()
        .all(|v| [0, 1].contains(v))
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
        competition_ingestion_enabled: input.competition_ingestion_enabled,
        result_notifications_enabled: input.result_notifications_enabled,
        avatar_uploads_enabled: input.avatar_uploads_enabled,
        notification_failure: None,
        minimum_ios_build: input.minimum_ios_build,
    };
    let guard = uuid()?;
    db.batch(vec![statement(db,"INSERT INTO mutation_guards VALUES (?1,CASE WHEN EXISTS(SELECT 1 FROM administrative_configuration WHERE singleton=1 AND revision=?2) THEN 1 ELSE 0 END)",&[text(&guard),number(before.revision)])?,statement(db,"UPDATE administrative_configuration SET revision=revision+1,competition_ingestion_enabled=?1,result_notifications_enabled=?2,avatar_uploads_enabled=?3,minimum_ios_build=?4,notification_failure=NULL WHERE singleton=1",&[number(after.competition_ingestion_enabled),number(after.result_notifications_enabled),number(after.avatar_uploads_enabled),number(after.minimum_ios_build)])?,statement(db,"INSERT INTO operational_audit VALUES (?1,?2,?3,?4,?5,?6,?7)",&[text(input.operation_id.as_str()),text(&admin.actor),blob(&hash),text(&input.reason),text(&serde_json::to_string(&before).map_err(|_|Failure::unavailable())?),text(&serde_json::to_string(&after).map_err(|_|Failure::unavailable())?),number(now())])?,statement(db,"DELETE FROM mutation_guards WHERE guard_id=?1",&[text(&guard)])?]).await.map_err(|_|Failure::conflict())?;
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
/// Preserve pending jobs and surface the provider failure in the protected management UI.
pub(crate) async fn pause_notifications(
    db: &D1Database,
    reason: &str,
) -> std::result::Result<(), Failure> {
    let before = controls(db).await?;
    if before.result_notifications_enabled == 0 {
        return Ok(());
    }
    let guard = uuid()?;
    let operation = uuid()?;
    let after = serde_json::json!({"revision":before.revision+1,"competition_ingestion_enabled":before.competition_ingestion_enabled,"result_notifications_enabled":0,"avatar_uploads_enabled":before.avatar_uploads_enabled,"notification_failure":reason,"minimum_ios_build":before.minimum_ios_build});
    db.batch(vec![statement(db,"INSERT INTO mutation_guards VALUES (?1,CASE WHEN EXISTS(SELECT 1 FROM administrative_configuration WHERE singleton=1 AND revision=?2) THEN 1 ELSE 0 END)",&[text(&guard),number(before.revision)])?,statement(db,"UPDATE administrative_configuration SET revision=revision+1,result_notifications_enabled=0,notification_failure=?1 WHERE singleton=1",&[text(reason)])?,statement(db,"INSERT INTO operational_audit VALUES (?1,'system:apns',?2,?3,?4,?5,?6)",&[text(&operation),blob(&Sha256::digest(reason.as_bytes())),text(reason),text(&serde_json::to_string(&before).map_err(|_|Failure::unavailable())?),text(&after.to_string()),number(now())])?,statement(db,"DELETE FROM mutation_guards WHERE guard_id=?1",&[text(&guard)])?]).await.map_err(|_|Failure::conflict())?;
    console_error!("apns_category_paused_check_admin_config");
    Ok(())
}
