//! Cloudflare Access application JWT verifier. Its caller fetches keys only from configured team origin.
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use rsa::{BigUint, Pkcs1v15Sign, RsaPublicKey, traits::PublicKeyParts};
use serde::Deserialize;
use sha2_10::{Digest, Sha256};
#[derive(Deserialize)]
struct Header {
    alg: String,
    kid: String,
    crit: Option<serde_json::Value>,
}
#[derive(Deserialize)]
struct Jwk {
    kty: String,
    kid: String,
    n: String,
    e: String,
    alg: Option<String>,
    #[serde(rename = "use")]
    usage: Option<String>,
}
#[derive(Deserialize)]
struct Keys {
    keys: Vec<Jwk>,
}
#[derive(Deserialize)]
pub struct Identity {
    pub iss: String,
    pub aud: Vec<String>,
    pub sub: String,
    pub email: String,
    pub exp: u64,
    iat: u64,
    nbf: Option<u64>,
    #[serde(rename = "type")]
    token_type: String,
}
#[derive(Debug)]
pub struct InvalidAccess;
/// A few embedded browsers serialize same-origin form navigation as Origin: null.
/// The caller still requires a valid Access JWT and a JWT-bound CSRF token.
#[cfg(any(target_arch = "wasm32", test))]
pub(crate) fn admin_form_origin_allowed(
    origin: Option<&str>,
    expected: &str,
    fetch_site: Option<&str>,
    fetch_mode: Option<&str>,
    fetch_dest: Option<&str>,
    fetch_user: Option<&str>,
) -> bool {
    origin == Some(expected)
        || (origin == Some("null")
            && fetch_site == Some("same-origin")
            && fetch_mode == Some("navigate")
            && fetch_dest == Some("document")
            && fetch_user == Some("?1"))
}
pub fn verify(
    token: &str,
    jwks: &[u8],
    issuer: &str,
    audience: &str,
    allowlist: &[String],
    time: u64,
) -> Result<Identity, InvalidAccess> {
    if token.len() > 16384 || jwks.len() > 65536 {
        return Err(InvalidAccess);
    }
    let pieces: Vec<_> = token.split('.').collect();
    if pieces.len() != 3 {
        return Err(InvalidAccess);
    }
    let header: Header = serde_json::from_slice(
        &URL_SAFE_NO_PAD
            .decode(pieces[0])
            .map_err(|_| InvalidAccess)?,
    )
    .map_err(|_| InvalidAccess)?;
    if header.alg != "RS256" || header.kid.len() > 128 || header.crit.is_some() {
        return Err(InvalidAccess);
    }
    let keys: Keys = serde_json::from_slice(jwks).map_err(|_| InvalidAccess)?;
    if keys.keys.is_empty() || keys.keys.len() > 16 {
        return Err(InvalidAccess);
    }
    let matching: Vec<_> = keys.keys.iter().filter(|k| k.kid == header.kid).collect();
    if matching.len() != 1 {
        return Err(InvalidAccess);
    }
    let key = matching[0];
    if key.kty != "RSA"
        || key.alg.as_deref().is_some_and(|v| v != "RS256")
        || key.usage.as_deref().is_some_and(|v| v != "sig")
    {
        return Err(InvalidAccess);
    }
    let n = URL_SAFE_NO_PAD.decode(&key.n).map_err(|_| InvalidAccess)?;
    let e = URL_SAFE_NO_PAD.decode(&key.e).map_err(|_| InvalidAccess)?;
    if !(256..=512).contains(&n.len()) || e.is_empty() || e.len() > 4 || n[0] == 0 || e[0] == 0 {
        return Err(InvalidAccess);
    }
    let public = RsaPublicKey::new(BigUint::from_bytes_be(&n), BigUint::from_bytes_be(&e))
        .map_err(|_| InvalidAccess)?;
    if public.n().bits() < 2048 {
        return Err(InvalidAccess);
    }
    let signature = URL_SAFE_NO_PAD
        .decode(pieces[2])
        .map_err(|_| InvalidAccess)?;
    public
        .verify(
            Pkcs1v15Sign::new::<Sha256>(),
            &Sha256::digest(format!("{}.{}", pieces[0], pieces[1])),
            &signature,
        )
        .map_err(|_| InvalidAccess)?;
    let mut claims: Identity = serde_json::from_slice(
        &URL_SAFE_NO_PAD
            .decode(pieces[1])
            .map_err(|_| InvalidAccess)?,
    )
    .map_err(|_| InvalidAccess)?;
    claims.email = claims.email.to_lowercase();
    if claims.iss != issuer
        || !claims.aud.iter().any(|v| v == audience)
        || claims.exp <= time
        || claims.iat > time
        || claims.nbf.is_some_and(|v| v > time)
        || claims.sub.is_empty()
        || claims.sub.len() > 255
        || claims.token_type != "app"
        || !allowlist.iter().any(|v| v.to_lowercase() == claims.email)
    {
        return Err(InvalidAccess);
    }
    Ok(claims)
}

#[cfg(test)]
mod origin_tests {
    use super::admin_form_origin_allowed as allowed;

    #[test]
    fn admin_form_accepts_exact_origin_or_user_initiated_same_origin_navigation() {
        let host = "https://admin-staging.getfolding.app";
        assert!(allowed(Some(host), host, None, None, None, None));
        assert!(allowed(
            Some("null"),
            host,
            Some("same-origin"),
            Some("navigate"),
            Some("document"),
            Some("?1")
        ));
        for site in [None, Some("same-site"), Some("cross-site")] {
            assert!(!allowed(
                Some("null"),
                host,
                site,
                Some("navigate"),
                Some("document"),
                Some("?1")
            ));
        }
        assert!(!allowed(
            Some("null"),
            host,
            Some("same-origin"),
            Some("navigate"),
            Some("document"),
            None
        ));
        assert!(!allowed(
            Some("https://evil.example"),
            host,
            Some("same-origin"),
            Some("navigate"),
            Some("document"),
            Some("?1")
        ));
    }
}
