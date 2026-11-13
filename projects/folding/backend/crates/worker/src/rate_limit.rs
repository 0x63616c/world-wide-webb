use crate::auth_runtime::{Configuration, Failure, blob, now, number, statement};
use serde::Deserialize;
use worker::D1Database;
#[derive(Deserialize)]
struct Count {
    count: u32,
}
pub(crate) async fn enforce(
    db: &D1Database,
    config: &Configuration,
    purpose: &str,
    owner: &str,
    window_ms: i64,
    limit: u32,
) -> Result<(), Failure> {
    let time = now();
    let start = time / window_ms * window_ms;
    let key = crate::secrets::keyed_digest(&config.network_key, purpose, owner);
    let row=statement(db,"INSERT INTO rate_limits VALUES (?1,?2,1,?3) ON CONFLICT(key_hash,window_ms) DO UPDATE SET count=count+1 RETURNING count",&[blob(&key),number(start),number(start+window_ms)])?.first::<Count>(None).await.map_err(|_|Failure::unavailable())?.ok_or_else(Failure::unavailable)?;
    if row.count > limit {
        return Err(Failure {
            status: 429,
            code: "rate_limited",
            retryable: true,
        });
    }
    Ok(())
}
