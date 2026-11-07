//! Per-category preferences and encrypted APNs installation ownership.
use crate::auth_runtime::{
    COMMUNITY_GUARD, Configuration, Failure, authenticated_session, blob, decode, now, number,
    random, response, session_guard, statement, text, uuid,
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use folding_domain::wire::Id;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use worker::*;
#[derive(Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Preference {
    Off,
    All,
    Podium,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Preferences {
    pub weekly: Preference,
    pub monthly: Preference,
    pub home_timezone: String,
    pub locale: String,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            weekly: Preference::Off,
            monthly: Preference::Off,
            home_timezone: "UTC".into(),
            locale: "en".into(),
        }
    }
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Change {
    operation_id: Id,
    preferences: Preferences,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Register {
    operation_id: Id,
    token_hex: String,
    environment: String,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Remove {
    operation_id: Id,
}
pub(crate) async fn preferences(
    db: &D1Database,
    participant: &str,
) -> std::result::Result<Preferences, Failure> {
    Ok(statement(db,"SELECT weekly,monthly,home_timezone,locale FROM notification_preferences WHERE participant_id=?1",&[text(participant)])?.first::<Preferences>(None).await.map_err(|_|Failure::unavailable())?.unwrap_or_default())
}
fn valid(prefs: &Preferences) -> bool {
    prefs.home_timezone.len() <= 128
        && prefs.home_timezone.parse::<chrono_tz::Tz>().is_ok()
        && [
            "en", "en-US", "de", "fr", "es", "es-419", "ja", "ko", "pt-BR", "zh-Hans", "zh-Hant",
        ]
        .contains(&prefs.locale.as_str())
}
fn name(preference: &Preference) -> &'static str {
    match preference {
        Preference::Off => "off",
        Preference::All => "all",
        Preference::Podium => "podium",
    }
}
pub(crate) fn token_context(
    config: &Configuration,
    participant: &str,
    device: &str,
    topic: &str,
    environment: &str,
) -> String {
    format!(
        "Folding-v1/{}/apns/{participant}/{device}/{topic}/{environment}",
        config.deployment
    )
}
pub(crate) fn push_configuration(
    env: &Env,
) -> std::result::Result<(String, String, [u8; 32]), Failure> {
    let topic = env
        .var("APNS_TOPIC")
        .map_err(|_| Failure::unavailable())?
        .to_string();
    let environment = env
        .var("APNS_ENVIRONMENT")
        .map_err(|_| Failure::unavailable())?
        .to_string();
    if topic.is_empty()
        || topic.len() > 255
        || !topic
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'.' || c == b'-')
        || !["sandbox", "production"].contains(&environment.as_str())
    {
        return Err(Failure::unavailable());
    }
    if env
        .var("DEPLOYMENT")
        .is_ok_and(|v| v.to_string() == "production")
        && environment != "production"
    {
        return Err(Failure::unavailable());
    }
    let key: [u8; 32] = URL_SAFE_NO_PAD
        .decode(
            env.secret("APNS_TOKEN_HMAC_KEY")
                .map_err(|_| Failure::unavailable())?
                .to_string(),
        )
        .map_err(|_| Failure::unavailable())?
        .try_into()
        .map_err(|_| Failure::unavailable())?;
    Ok((topic, environment, key))
}
pub(crate) async fn mutate(
    request: &Request,
    env: &Env,
    db: &D1Database,
    config: &Configuration,
    body: &[u8],
    request_id: &Id,
) -> std::result::Result<Response, Failure> {
    let path = request.path();
    let removing = request.method() == Method::Delete;
    let session = authenticated_session(request, db, config, !removing).await?;
    let (operation, normalized) = if path == "/v1/preferences" {
        let input: Change = decode(body)?;
        (
            input.operation_id.clone(),
            serde_json::to_vec(&input).map_err(|_| Failure::unavailable())?,
        )
    } else if removing {
        let input: Remove = decode(body)?;
        (
            input.operation_id.clone(),
            serde_json::to_vec(&input).map_err(|_| Failure::unavailable())?,
        )
    } else {
        let input: Register = decode(body)?;
        (
            input.operation_id.clone(),
            serde_json::to_vec(&input).map_err(|_| Failure::unavailable())?,
        )
    };
    let route = format!("{} {path}", request.method());
    let hash = Sha256::digest(normalized);
    let time = now();
    let guard = uuid()?;
    let mut writes = vec![
        session_guard(db, &guard, &session, config, time)?,
        statement(
            db,
            if removing {
                crate::lifecycle_runtime::PRIVACY_GUARD
            } else {
                COMMUNITY_GUARD
            },
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
    crate::rate_limit::enforce(
        db,
        config,
        "notification-settings",
        &session.participant_id,
        60000,
        60,
    )
    .await?;
    let value = if path == "/v1/preferences" {
        if request.method() != Method::Put {
            return Err(Failure::malformed());
        }
        let input: Change = decode(body)?;
        if !valid(&input.preferences) {
            return Err(Failure::malformed());
        }
        let prefs = input.preferences;
        writes.push(statement(db,"INSERT INTO notification_preferences VALUES (?1,?2,?3,?4,?5) ON CONFLICT(participant_id) DO UPDATE SET weekly=excluded.weekly,monthly=excluded.monthly,home_timezone=excluded.home_timezone,locale=excluded.locale",&[text(&session.participant_id),text(name(&prefs.weekly)),text(name(&prefs.monthly)),text(&prefs.home_timezone),text(&prefs.locale)])?);
        writes.push(statement(db,"UPDATE award_jobs SET due_ms=NULL,next_attempt_ms=0 WHERE participant_id=?1 AND state='pending'",&[text(&session.participant_id)])?);
        serde_json::json!({"preferences":prefs,"operation_id":operation,"request_id":request_id})
    } else {
        let device = Id::parse(
            path.strip_prefix("/v1/push-installations/")
                .ok_or_else(Failure::malformed)?,
        )
        .map_err(|_| Failure::malformed())?;
        if device.as_str() != session.device_id {
            return Err(Failure::unauthorized());
        }
        if removing {
            writes.push(statement(db,"DELETE FROM push_installations WHERE participant_id=?1 AND device_id=?2 AND deployment=?3",&[text(&session.participant_id),text(device.as_str()),text(&config.deployment)])?);
        } else {
            if request.method() != Method::Put {
                return Err(Failure::malformed());
            }
            let input: Register = decode(body)?;
            let (topic, environment, key) = push_configuration(env)?;
            if input.environment != environment
                || input.token_hex.is_empty()
                || input.token_hex.len() > 1024
                || input.token_hex.len() % 2 != 0
                || !input.token_hex.bytes().all(|c| c.is_ascii_hexdigit())
            {
                return Err(Failure::malformed());
            }
            let token = input.token_hex.to_ascii_lowercase();
            let token_hash = crate::secrets::keyed_digest(
                &key,
                &format!("apns-token/{topic}/{environment}"),
                &token,
            );
            let cipher = config
                .keys
                .seal(
                    random::<12>()?,
                    &token_context(
                        config,
                        &session.participant_id,
                        device.as_str(),
                        &topic,
                        &environment,
                    ),
                    token.as_bytes(),
                )
                .map_err(|_| Failure::unavailable())?;
            // Ownership follows the current signed-in installation even if the previous account was offline.
            writes.push(statement(db,"DELETE FROM push_installations WHERE topic=?1 AND environment=?2 AND token_hash=?3",&[text(&topic),text(&environment),blob(&token_hash)])?);
            writes.push(statement(db,"INSERT INTO push_installations(device_id,participant_id,session_id,deployment,environment,token_ciphertext,key_version,topic,enabled,token_hash,registered_at_ms) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,1,?9,?10) ON CONFLICT(participant_id,device_id,deployment) DO UPDATE SET session_id=excluded.session_id,environment=excluded.environment,token_ciphertext=excluded.token_ciphertext,key_version=excluded.key_version,topic=excluded.topic,enabled=1,token_hash=excluded.token_hash,registered_at_ms=excluded.registered_at_ms",&[text(device.as_str()),text(&session.participant_id),text(&session.session_id),text(&config.deployment),text(&environment),blob(&cipher),text(config.keys.version()),text(&topic),blob(&token_hash),number(time)])?);
        }
        serde_json::json!({"registered":!removing,"operation_id":operation,"request_id":request_id})
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
