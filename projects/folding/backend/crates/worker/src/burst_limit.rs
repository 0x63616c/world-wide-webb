//! Cheap, per-location burst protection. These counters are not global account quotas.
use crate::auth_runtime::Failure;
use sha2::{Digest, Sha256};
use worker::{Env, Request};

async fn check(env: &Env, binding: &str, key: String) -> Result<(), Failure> {
    let outcome = env
        .rate_limiter(binding)
        .map_err(|_| Failure::unavailable())?
        .limit(key)
        .await
        .map_err(|_| Failure::unavailable())?;
    if !outcome.success {
        return Err(Failure {
            status: 429,
            code: "rate_limited",
            retryable: true,
        });
    }
    Ok(())
}

pub(crate) async fn enforce(request: &Request, env: &Env) -> Result<(), Failure> {
    // Local integration harnesses omit deployment configuration. Configured deployments
    // must have all bindings: a missing/broken limiter fails closed rather than bypassing it.
    if env.var("DEPLOYMENT").is_err() {
        return Ok(());
    }
    let address = request
        .headers()
        .get("CF-Connecting-IP")
        .map_err(|_| Failure::unavailable())?
        .and_then(|value| value.parse::<std::net::IpAddr>().ok())
        .map(|value| value.to_string())
        .unwrap_or_else(|| "unknown-network".into());
    // Cloudflare supplies this header; never trust X-Forwarded-For or a client device ID.
    // Keys stay in ephemeral limiter counters, never in logs or D1.
    check(env, "API_NETWORK_BURST", address.clone()).await?;
    let path = request.path();
    if path.starts_with("/v1/auth/") {
        check(env, "AUTH_NETWORK_BURST", address).await?;
    }
    if let Some(authorization) = request
        .headers()
        .get("Authorization")
        .map_err(|_| Failure::unavailable())?
    {
        if authorization.len() > 4096 {
            return Err(Failure::unauthorized());
        }
        // Token hashing is for a bounded limiter key, not authentication. Forged or
        // rotated tokens remain subject to the network counter and real session checks.
        let digest = Sha256::digest(authorization.as_bytes());
        let key = digest.iter().map(|b| format!("{b:02x}")).collect();
        check(env, "API_CREDENTIAL_BURST", key).await?;
    }
    Ok(())
}
