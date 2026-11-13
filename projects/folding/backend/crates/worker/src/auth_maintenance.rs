//! Retention cleanup is idempotent. Use the shared five-minute dispatcher; authorization still checks exact expiry.
use worker::*;
pub async fn cleanup(db: &D1Database, timestamp: i64) -> Result<()> {
    let time = wasm_bindgen::JsValue::from_f64(timestamp as f64);
    let older = wasm_bindgen::JsValue::from_f64((timestamp - 120000) as f64);
    db.batch(vec![
        db.prepare("DELETE FROM moderation_cases WHERE closed_at_ms<=?1-7776000000").bind(std::slice::from_ref(&time))?,
        db.prepare("DELETE FROM reports WHERE state='closed' AND closed_at_ms<=?1-7776000000").bind(std::slice::from_ref(&time))?,
        db.prepare("DELETE FROM rate_limits WHERE expires_at_ms<=?1").bind(std::slice::from_ref(&time))?,
        db.prepare("DELETE FROM moderation_actions WHERE expires_at_ms<=?1 AND NOT EXISTS(SELECT 1 FROM moderation_action_cases a JOIN moderation_cases c ON c.case_id=a.case_id WHERE a.actor=moderation_actions.actor AND a.operation_id=moderation_actions.operation_id AND c.closed_at_ms IS NULL)").bind(std::slice::from_ref(&time))?,
        db.prepare("UPDATE participant_revisions SET revision=revision+1 WHERE participant_id IN(SELECT participant_id FROM participants WHERE restriction='suspended' AND suspended_until_ms<=?1)").bind(std::slice::from_ref(&time))?,
        db.prepare("UPDATE moderation_actions SET expires_at_ms=?1+7776000000 WHERE EXISTS(SELECT 1 FROM moderation_action_cases a JOIN moderation_cases c ON c.case_id=a.case_id JOIN participants p ON p.participant_id=c.participant_id WHERE a.actor=moderation_actions.actor AND a.operation_id=moderation_actions.operation_id AND c.closed_at_ms IS NULL AND p.restriction='suspended' AND p.suspended_until_ms<=?1)").bind(std::slice::from_ref(&time))?,
        db.prepare("UPDATE moderation_cases SET closed_at_ms=?1 WHERE closed_at_ms IS NULL AND participant_id IN(SELECT participant_id FROM participants WHERE restriction='suspended' AND suspended_until_ms<=?1)").bind(std::slice::from_ref(&time))?,
        db.prepare("UPDATE participants SET restriction='none',suspended_until_ms=NULL WHERE restriction='suspended' AND suspended_until_ms<=?1").bind(std::slice::from_ref(&time))?,
        db.prepare("DELETE FROM deletion_recovery_receipts WHERE expires_at_ms<=?1").bind(std::slice::from_ref(&time))?,
        db.prepare("DELETE FROM reauthentications WHERE expires_at_ms<=?1 OR used=1").bind(std::slice::from_ref(&time))?,
        db.prepare("DELETE FROM deletion_polling_tokens WHERE expires_at_ms<=?1").bind(std::slice::from_ref(&time))?,
        db.prepare("DELETE FROM deletion_operations WHERE recover_until_ms<=?1").bind(std::slice::from_ref(&time))?,
        db.prepare("DELETE FROM deletion_recovery_claims WHERE participant_id IN (SELECT participant_id FROM participants WHERE account_state='deleted') AND NOT EXISTS(SELECT 1 FROM deletion_operations d WHERE d.participant_id=deletion_recovery_claims.participant_id)").bind(&[])?,
        db.prepare("UPDATE moderation_actions SET expires_at_ms=?1+7776000000 WHERE EXISTS(SELECT 1 FROM moderation_action_cases a JOIN moderation_cases c ON c.case_id=a.case_id JOIN participants p ON p.participant_id=c.participant_id WHERE a.actor=moderation_actions.actor AND a.operation_id=moderation_actions.operation_id AND c.closed_at_ms IS NULL AND p.account_state='deleted')").bind(std::slice::from_ref(&time))?,
        db.prepare("UPDATE moderation_cases SET closed_at_ms=?1 WHERE closed_at_ms IS NULL AND participant_id IN(SELECT participant_id FROM participants WHERE account_state='deleted')").bind(std::slice::from_ref(&time))?,
        db.prepare("DELETE FROM participants WHERE account_state='deleted' AND restriction='none' AND NOT EXISTS(SELECT 1 FROM deletion_operations d WHERE d.participant_id=participants.participant_id)").bind(&[])? ,
        db.prepare("DELETE FROM refresh_receipts WHERE expires_at_ms<=?1").bind(std::slice::from_ref(&time))?,
        db.prepare("DELETE FROM sign_in_receipts WHERE expires_at_ms<=?1").bind(std::slice::from_ref(&time))?,
        db.prepare("DELETE FROM access_tokens WHERE expires_at_ms<=?1").bind(std::slice::from_ref(&time))?,
        db.prepare("DELETE FROM sessions WHERE absolute_expires_at_ms<=?1 OR idle_expires_at_ms<=?1").bind(std::slice::from_ref(&time))?,
        db.prepare("DELETE FROM challenges WHERE expires_at_ms<=?1 AND NOT EXISTS (SELECT 1 FROM sign_in_receipts r WHERE r.challenge_id=challenges.challenge_id)").bind(std::slice::from_ref(&time))?,
        db.prepare("DELETE FROM auth_rate_windows WHERE window_ms<?1").bind(&[older])?,
    ]).await?;
    Ok(())
}
#[event(scheduled)]
pub async fn scheduled(_event: ScheduledEvent, env: Env, _context: ScheduleContext) {
    let result = match env.d1("DB") {
        Ok(db) => crate::jobs_runtime::schedule(&env, &db).await,
        Err(_) => Err(crate::auth_runtime::Failure::unavailable()),
    };
    if result.is_err() {
        console_error!("background_dispatch_failed");
    }
}
