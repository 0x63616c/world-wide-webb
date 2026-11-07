//! Private staged R2 uploads with bounded re-encoding, transactional visibility and durable purges.
use crate::{
    auth_runtime::{
        Configuration, Failure, authenticated_session, blob, now, number, response, statement,
        text, uuid,
    },
    competition_runtime::{cleanup, guards, receipt},
    protected_request,
};
use folding_domain::wire::Id;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use worker::*;
#[derive(Deserialize)]
struct Asset {
    avatar_id: String,
    participant_id: String,
    state: String,
    original_key: String,
    derivative_key: String,
    created_at_ms: i64,
    normalized_hash: Vec<u8>,
    reason_code: Option<String>,
}
pub(crate) async fn upload(
    request: &Request,
    env: &Env,
    db: &D1Database,
    config: &Configuration,
    body: &[u8],
    request_id: &Id,
) -> std::result::Result<Response, Failure> {
    crate::operational_runtime::require(db, "avatars").await?;
    if env
        .var("AVATAR_UPLOADS_ENABLED")
        .map(|v| v.to_string())
        .ok()
        .as_deref()
        != Some("true")
    {
        return Err(Failure::unavailable());
    }
    let operation = Id::parse(
        request
            .path()
            .strip_prefix("/v1/avatars/")
            .ok_or_else(Failure::malformed)?,
    )
    .map_err(|_| Failure::malformed())?;
    let content = request
        .headers()
        .get("Content-Type")
        .map_err(|_| Failure::malformed())?
        .ok_or_else(Failure::malformed)?;
    if !["image/jpeg", "image/png"].contains(&content.as_str())
        || body.len() > crate::avatar::MAX_INPUT_BYTES
    {
        return Err(Failure::malformed());
    }
    let verified =
        protected_request::verify(request, env, db, config, body, "avatar_upload").await?;
    let session = &verified.session;
    let hash = Sha256::digest(body);
    let route = format!("PUT {}", request.path());
    let time = now();
    let guard = uuid()?;
    let mut writes = guards(db, config, &verified, &guard, time)?;
    if let Some(old) = receipt(db, &session.participant_id, &operation).await? {
        if old.route != route || old.normalized_hash != hash.as_slice() {
            return Err(Failure::conflict());
        }
        let value: serde_json::Value =
            serde_json::from_str(&old.response_json).map_err(|_| Failure::unavailable())?;
        let avatar = value["avatar_id"]
            .as_str()
            .ok_or_else(Failure::unavailable)?;
        writes.push(statement(db,"INSERT INTO mutation_guards VALUES (?1,CASE WHEN EXISTS(SELECT 1 FROM avatar_objects WHERE avatar_id=?2 AND participant_id=?3 AND state IN ('pending','approved')) THEN 1 ELSE 0 END)",&[text(&format!("{guard}-business")),text(avatar),text(&session.participant_id)])?);
        writes.extend(verified.consume(db)?);
        writes.push(cleanup(db, &guard)?);
        db.batch(writes).await.map_err(|_| Failure::conflict())?;
        return response(&value);
    }
    crate::rate_limit::enforce(
        db,
        config,
        "avatar-uploads",
        &session.participant_id,
        3600000,
        5,
    )
    .await?;
    // Validate/decode only after session + assertion verification. CPU/memory acceptance remains gated.
    let derivative = crate::avatar::derivative(body, &content).map_err(|_| Failure::malformed())?;
    let existing=statement(db,"SELECT avatar_id,participant_id,state,original_key,derivative_key,created_at_ms,normalized_hash,reason_code FROM avatar_objects WHERE participant_id=?1 AND operation_id=?2",&[text(&session.participant_id),text(operation.as_str())])?.first::<Asset>(None).await.map_err(|_|Failure::unavailable())?;
    let asset = if let Some(asset) = existing {
        if asset.normalized_hash != hash.as_slice()
            || asset.state != "uploading"
            || asset.created_at_ms + 3600000 <= time
        {
            return Err(Failure::conflict());
        }
        asset
    } else {
        let asset = Asset {
            avatar_id: uuid()?,
            participant_id: session.participant_id.clone(),
            state: "uploading".into(),
            original_key: format!("private/original/{}", uuid()?),
            derivative_key: format!("private/derivative/{}", uuid()?),
            created_at_ms: time,
            normalized_hash: hash.to_vec(),
            reason_code: None,
        };
        let reservation = uuid()?;
        let mut reserved = guards(db, config, &verified, &reservation, time)?;
        reserved.push(statement(db,"INSERT INTO avatar_objects(avatar_id,participant_id,operation_id,normalized_hash,state,original_key,derivative_key,created_at_ms) VALUES (?1,?2,?3,?4,'uploading',?5,?6,?7)",&[text(&asset.avatar_id),text(&asset.participant_id),text(operation.as_str()),blob(&hash),text(&asset.original_key),text(&asset.derivative_key),number(time)])?);
        reserved.push(cleanup(db, &reservation)?);
        db.batch(reserved).await.map_err(|_| Failure::conflict())?;
        asset
    };
    let bucket = env.bucket("AVATARS").map_err(|_| Failure::unavailable())?;
    put_once(&bucket, &asset.original_key, body.to_vec(), &content).await?;
    put_once(&bucket, &asset.derivative_key, derivative, "image/jpeg").await?;
    writes = guards(db, config, &verified, &guard, now())?;
    // Reservation makes orphan cleanup possible if execution stops after either object write.
    writes.push(statement(db,"INSERT INTO mutation_guards VALUES (?1,CASE WHEN EXISTS(SELECT 1 FROM avatar_objects WHERE avatar_id=?2 AND participant_id=?3 AND state='uploading' AND normalized_hash=?4 AND created_at_ms>?5) THEN 1 ELSE 0 END)",&[text(&format!("{guard}-business")),text(&asset.avatar_id),text(&session.participant_id),blob(&hash),number(now()-3600000)])?);
    writes.extend(verified.consume(db)?);
    writes.push(statement(db,"INSERT INTO avatar_purge_jobs(object_key,participant_id) SELECT original_key,participant_id FROM avatar_objects WHERE participant_id=?1 AND state='pending' UNION SELECT derivative_key,participant_id FROM avatar_objects WHERE participant_id=?1 AND state='pending' ON CONFLICT(object_key) DO NOTHING",&[text(&session.participant_id)])?);
    writes.push(statement(db,"UPDATE avatar_objects SET state='rejected',reason_code='superseded',revision=revision+1 WHERE participant_id=?1 AND state='pending'",&[text(&session.participant_id)])?);
    writes.push(statement(
        db,
        "UPDATE avatar_objects SET state='pending',revision=revision+1 WHERE avatar_id=?1",
        &[text(&asset.avatar_id)],
    )?);
    writes.push(statement(
        db,
        "UPDATE profiles SET avatar_status='pending' WHERE participant_id=?1",
        &[text(&session.participant_id)],
    )?);
    writes.push(statement(
        db,
        "INSERT INTO avatar_alerts(avatar_id,state) VALUES (?1,'pending')",
        &[text(&asset.avatar_id)],
    )?);
    let value = serde_json::json!({"avatar_id":asset.avatar_id,"state":"pending","operation_id":operation,"request_id":request_id});
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
    writes.push(cleanup(db, &guard)?);
    db.batch(writes).await.map_err(|_| Failure::conflict())?;
    response(&value)
}
pub(crate) async fn read(
    request: &Request,
    env: &Env,
    db: &D1Database,
    config: &Configuration,
    request_id: &Id,
) -> std::result::Result<Response, Failure> {
    let path = request.path();
    let segment = path
        .strip_prefix("/v1/avatars/")
        .ok_or_else(Failure::malformed)?;
    let (id, kind) = segment.split_once('/').ok_or_else(Failure::malformed)?;
    let id = Id::parse(id).map_err(|_| Failure::malformed())?;
    let session = authenticated_session(request, db, config, kind == "image").await?;
    let asset=statement(db,"SELECT avatar_id,participant_id,state,original_key,derivative_key,created_at_ms,normalized_hash,reason_code FROM avatar_objects WHERE avatar_id=?1",&[text(id.as_str())])?.first::<Asset>(None).await.map_err(|_|Failure::unavailable())?.ok_or(Failure{status:404,code:"not_found",retryable:false})?;
    if kind == "status" {
        if asset.participant_id != session.participant_id {
            return Err(Failure {
                status: 404,
                code: "not_found",
                retryable: false,
            });
        }
        return response(
            &serde_json::json!({"state":match asset.state.as_str(){"approved"=>"approved","rejected"|"removed"=>"rejected",_=>"pending"},"reason_code":asset.reason_code,"request_id":request_id}),
        );
    }
    if kind != "image" || asset.state != "approved" {
        return Err(Failure {
            status: 404,
            code: "not_found",
            retryable: false,
        });
    }
    let bucket = env.bucket("AVATARS").map_err(|_| Failure::unavailable())?;
    let object = bucket
        .get(&asset.derivative_key)
        .execute()
        .await
        .map_err(|_| Failure::unavailable())?
        .ok_or_else(Failure::unavailable)?;
    if object.size() == 0 {
        return Err(Failure {
            status: 404,
            code: "not_found",
            retryable: false,
        });
    }
    let bytes = object
        .body()
        .ok_or_else(Failure::unavailable)?
        .bytes()
        .await
        .map_err(|_| Failure::unavailable())?;
    let guard = uuid()?;
    db.batch(vec![
        crate::auth_runtime::session_guard(db, &guard, &session, config, now())?,
        statement(
            db,
            IMAGE_GUARD,
            &[
                text(&format!("{guard}-community")),
                text(&session.participant_id),
                text(&asset.avatar_id),
            ],
        )?,
        cleanup(db, &guard)?,
    ])
    .await
    .map_err(|_| Failure {
        status: 404,
        code: "not_found",
        retryable: false,
    })?;
    let mut result = Response::from_bytes(bytes).map_err(|_| Failure::unavailable())?;
    result
        .headers_mut()
        .set("Content-Type", "image/jpeg")
        .map_err(|_| Failure::unavailable())?;
    result
        .headers_mut()
        .set("Cache-Control", "private, max-age=300")
        .map_err(|_| Failure::unavailable())?;
    result
        .headers_mut()
        .set("X-Content-Type-Options", "nosniff")
        .map_err(|_| Failure::unavailable())?;
    result
        .headers_mut()
        .set("X-Request-ID", request_id.as_str())
        .map_err(|_| Failure::unavailable())?;
    Ok(result)
}
const IMAGE_GUARD: &str = r#"
INSERT INTO mutation_guards VALUES (?1,CASE WHEN EXISTS(
 SELECT 1 FROM participants viewer,avatar_objects a JOIN participants owner ON owner.participant_id=a.participant_id JOIN profiles f ON f.participant_id=owner.participant_id
 WHERE viewer.participant_id=?2 AND viewer.account_state='active' AND viewer.membership='joined' AND viewer.restriction='none'
 AND a.avatar_id=?3 AND a.state='approved' AND f.avatar_id=a.avatar_id AND owner.account_state='active' AND owner.membership='joined' AND owner.restriction='none'
 AND NOT EXISTS(SELECT 1 FROM blocks b WHERE b.participant_id=?2 AND b.subject_participant_id=owner.participant_id)
) THEN 1 ELSE 0 END)
"#;
pub(crate) fn purge_owned(
    db: &D1Database,
    participant: &str,
) -> std::result::Result<Vec<D1PreparedStatement>, Failure> {
    Ok(vec![
        statement(
            db,
            "INSERT INTO avatar_purge_jobs(object_key,participant_id) SELECT original_key,participant_id FROM avatar_objects WHERE participant_id=?1 UNION SELECT derivative_key,participant_id FROM avatar_objects WHERE participant_id=?1 ON CONFLICT(object_key) DO NOTHING",
            &[text(participant)],
        )?,
        statement(
            db,
            "UPDATE avatar_objects SET state='removed',reason_code='removed',revision=revision+1 WHERE participant_id=?1",
            &[text(participant)],
        )?,
        statement(
            db,
            "UPDATE profiles SET avatar_id=NULL,avatar_status='none' WHERE participant_id=?1",
            &[text(participant)],
        )?,
        statement(
            db,
            "UPDATE avatar_alerts SET state='reviewed' WHERE avatar_id IN(SELECT avatar_id FROM avatar_objects WHERE participant_id=?1)",
            &[text(participant)],
        )?,
    ])
}
async fn put_once(
    bucket: &Bucket,
    key: &str,
    bytes: Vec<u8>,
    content_type: &str,
) -> std::result::Result<(), Failure> {
    let digest = crate::assertion::hex(&Sha256::digest(&bytes));
    let mut metadata = std::collections::HashMap::new();
    metadata.insert("sha256".into(), digest.clone());
    let written = bucket
        .put(key, bytes)
        .only_if(Conditional {
            etag_does_not_match: Some("*".into()),
            ..Default::default()
        })
        .custom_metadata(metadata)
        .http_metadata(HttpMetadata {
            content_type: Some(content_type.into()),
            cache_control: Some("no-store".into()),
            ..Default::default()
        })
        .execute()
        .await
        .map_err(|_| Failure::unavailable())?;
    if written.is_none() {
        let existing = bucket
            .head(key)
            .await
            .map_err(|_| Failure::unavailable())?
            .ok_or_else(Failure::conflict)?;
        if existing.size() == 0
            || existing
                .custom_metadata()
                .map_err(|_| Failure::unavailable())?
                .get("sha256")
                != Some(&digest)
        {
            return Err(Failure::conflict());
        }
    }
    Ok(())
}
pub(crate) async fn remove(
    request: &Request,
    db: &D1Database,
    config: &Configuration,
    request_id: &Id,
) -> std::result::Result<Response, Failure> {
    let path = request.path();
    let avatar = Id::parse(
        path.strip_prefix("/v1/avatars/")
            .ok_or_else(Failure::malformed)?,
    )
    .map_err(|_| Failure::malformed())?;
    let url = request.url().map_err(|_| Failure::malformed())?;
    let query: Vec<_> = url.query_pairs().collect();
    if query.len() != 1 || query[0].0 != "operation_id" {
        return Err(Failure::malformed());
    }
    let operation = Id::parse(&query[0].1).map_err(|_| Failure::malformed())?;
    let session = authenticated_session(request, db, config, false).await?;
    let time = now();
    let guard = uuid()?;
    let route = format!("DELETE {path}");
    let hash = Sha256::digest(route.as_bytes());
    let mut writes = vec![
        crate::auth_runtime::session_guard(db, &guard, &session, config, time)?,
        statement(
            db,
            crate::lifecycle_runtime::PRIVACY_GUARD,
            &[
                text(&format!("{guard}-community")),
                text(&session.participant_id),
                number(session.revision),
            ],
        )?,
    ];
    if let Some(old) = receipt(db, &session.participant_id, &operation).await? {
        if old.route != route || old.normalized_hash != hash.as_slice() {
            return Err(Failure::conflict());
        }
        writes.push(cleanup(db, &guard)?);
        db.batch(writes).await.map_err(|_| Failure::conflict())?;
        let value: serde_json::Value =
            serde_json::from_str(&old.response_json).map_err(|_| Failure::unavailable())?;
        return response(&value);
    }
    writes.push(statement(db,"INSERT INTO mutation_guards VALUES (?1,CASE WHEN EXISTS(SELECT 1 FROM avatar_objects WHERE avatar_id=?2 AND participant_id=?3) THEN 1 ELSE 0 END)",&[text(&format!("{guard}-business")),text(avatar.as_str()),text(&session.participant_id)])?);
    writes.push(statement(db,"INSERT INTO avatar_purge_jobs(object_key,participant_id) SELECT original_key,participant_id FROM avatar_objects WHERE avatar_id=?1 AND participant_id=?2 UNION SELECT derivative_key,participant_id FROM avatar_objects WHERE avatar_id=?1 AND participant_id=?2 ON CONFLICT(object_key) DO NOTHING",&[text(avatar.as_str()),text(&session.participant_id)])?);
    writes.push(statement(db,"UPDATE avatar_objects SET state='removed',reason_code='removed',revision=revision+1 WHERE avatar_id=?1 AND participant_id=?2",&[text(avatar.as_str()),text(&session.participant_id)])?);
    writes.push(statement(db,"UPDATE profiles SET avatar_id=CASE WHEN avatar_id=?1 THEN NULL ELSE avatar_id END,avatar_status=CASE WHEN EXISTS(SELECT 1 FROM avatar_objects WHERE participant_id=?2 AND state='pending') THEN 'pending' WHEN avatar_id IS NOT NULL AND avatar_id<>?1 THEN 'approved' ELSE 'none' END WHERE participant_id=?2",&[text(avatar.as_str()),text(&session.participant_id)])?);
    writes.push(statement(
        db,
        "UPDATE avatar_alerts SET state='reviewed' WHERE avatar_id=?1",
        &[text(avatar.as_str())],
    )?);
    let value =
        serde_json::json!({"operation_id":operation,"state":"completed","request_id":request_id});
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
    writes.push(cleanup(db, &guard)?);
    db.batch(writes).await.map_err(|_| Failure::conflict())?;
    response(&value)
}
#[derive(Deserialize)]
struct Purge {
    object_key: String,
}
pub(crate) async fn cleanup_objects(
    env: &Env,
    db: &D1Database,
) -> std::result::Result<(), Failure> {
    let time = now();
    db.batch(vec![
 statement(db,"INSERT INTO avatar_purge_jobs(object_key,participant_id) SELECT original_key,participant_id FROM avatar_objects WHERE (state='uploading' AND created_at_ms<=?1-3600000) OR (state='pending' AND created_at_ms<=?1-604800000) UNION SELECT derivative_key,participant_id FROM avatar_objects WHERE (state='uploading' AND created_at_ms<=?1-3600000) OR (state='pending' AND created_at_ms<=?1-604800000) ON CONFLICT(object_key) DO NOTHING",&[number(time)])?,
 statement(db,"UPDATE avatar_objects SET state='rejected',reason_code='expired',revision=revision+1 WHERE (state='uploading' AND created_at_ms<=?1-3600000) OR (state='pending' AND created_at_ms<=?1-604800000)",&[number(time)])?,
 statement(db,"UPDATE profiles SET avatar_status=CASE WHEN avatar_id IS NULL THEN 'rejected' ELSE 'approved' END WHERE avatar_status='pending' AND NOT EXISTS(SELECT 1 FROM avatar_objects a WHERE a.participant_id=profiles.participant_id AND a.state='pending')",&[])?,
 ]).await.map_err(|_|Failure::unavailable())?;
    let jobs=statement(db,"SELECT object_key FROM avatar_purge_jobs WHERE lease_until_ms<=?1 ORDER BY object_key LIMIT 50",&[number(time)])?.all().await.map_err(|_|Failure::unavailable())?.results::<Purge>().map_err(|_|Failure::unavailable())?;
    if jobs.is_empty() {
        finish_cleanup(db).await?;
        return Ok(());
    }
    let bucket = env.bucket("AVATARS").map_err(|_| Failure::unavailable())?;
    for job in jobs {
        let lease = time + 120000;
        let claimed=statement(db,"UPDATE avatar_purge_jobs SET lease_until_ms=?1,attempts=attempts+1 WHERE object_key=?2 AND lease_until_ms<=?3 RETURNING object_key",&[number(lease),text(&job.object_key),number(time)])?.first::<Purge>(None).await.map_err(|_|Failure::unavailable())?;
        if claimed.is_none() {
            continue;
        }
        // A content-free permanent marker fences an in-flight conditional upload after privacy erasure.
        let purged = bucket
            .put(&job.object_key, Vec::<u8>::new())
            .custom_metadata(std::collections::HashMap::<String, String>::new())
            .http_metadata(HttpMetadata {
                content_type: Some("application/octet-stream".into()),
                cache_control: Some("no-store".into()),
                ..Default::default()
            })
            .execute()
            .await;
        if purged.is_ok() {
            statement(
                db,
                "DELETE FROM avatar_purge_jobs WHERE object_key=?1 AND lease_until_ms=?2",
                &[text(&job.object_key), number(lease)],
            )?
            .run()
            .await
            .map_err(|_| Failure::unavailable())?;
        }
    }
    finish_cleanup(db).await?;
    Ok(())
}

async fn finish_cleanup(db: &D1Database) -> std::result::Result<(), Failure> {
    db.batch(vec![statement(db,"UPDATE competition_operations SET response_json=json_set(response_json,'$.state','completed') WHERE route='/v1/enrollment/leave' AND json_extract(response_json,'$.state')='pending' AND NOT EXISTS(SELECT 1 FROM avatar_purge_jobs j WHERE j.participant_id=competition_operations.participant_id)",&[])?,statement(db,"DELETE FROM avatar_objects WHERE state='removed' AND NOT EXISTS(SELECT 1 FROM avatar_purge_jobs j WHERE j.object_key=avatar_objects.original_key OR j.object_key=avatar_objects.derivative_key)",&[])?]).await.map_err(|_|Failure::unavailable())?;
    Ok(())
}
