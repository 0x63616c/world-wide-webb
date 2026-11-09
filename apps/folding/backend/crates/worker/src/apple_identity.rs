//! Verification against a bounded, server-fetched Apple JWKS. Network/cache policy is owned by
//! the runtime; callers must never supply client-controlled keys or trust unverified claims.
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use rsa::{BigUint, Pkcs1v15Sign, RsaPublicKey, traits::PublicKeyParts};
use serde::Deserialize;
use sha2_10::{Digest, Sha256};

pub const JWKS_URL: &str = "https://appleid.apple.com/auth/keys";
const MAX_TOKEN: usize = 16 * 1024;

#[derive(Debug, PartialEq, Eq)]
pub enum IdentityError {
    Malformed,
    UnknownKey,
    InvalidKey,
    InvalidSignature,
    InvalidClaims,
}
#[derive(Deserialize)]
struct Header {
    alg: String,
    kid: String,
    #[serde(default)]
    crit: Option<serde_json::Value>,
}
#[derive(Deserialize)]
struct Claims {
    iss: String,
    aud: String,
    sub: String,
    exp: u64,
    iat: u64,
    nonce: String,
}
#[derive(Deserialize)]
struct Jwks {
    keys: Vec<Jwk>,
}
#[derive(Deserialize)]
struct Jwk {
    kty: String,
    kid: String,
    alg: String,
    #[serde(rename = "use")]
    usage: String,
    n: String,
    e: String,
}

pub struct AppleKeys(Vec<(String, RsaPublicKey)>);
impl AppleKeys {
    /// Only call with the response body obtained from the fixed Apple HTTPS endpoint.
    pub fn from_apple_response(bytes: &[u8]) -> Result<Self, IdentityError> {
        if bytes.len() > 64 * 1024 {
            return Err(IdentityError::Malformed);
        }
        let parsed: Jwks = serde_json::from_slice(bytes).map_err(|_| IdentityError::Malformed)?;
        if parsed.keys.is_empty() || parsed.keys.len() > 16 {
            return Err(IdentityError::InvalidKey);
        }
        let mut keys = Vec::new();
        for jwk in parsed.keys {
            if jwk.kid.is_empty()
                || jwk.kid.len() > 128
                || keys.iter().any(|(kid, _)| kid == &jwk.kid)
            {
                return Err(IdentityError::InvalidKey);
            }
            if jwk.kty != "RSA" || jwk.alg != "RS256" || jwk.usage != "sig" {
                return Err(IdentityError::InvalidKey);
            }
            let n = URL_SAFE_NO_PAD
                .decode(jwk.n)
                .map_err(|_| IdentityError::InvalidKey)?;
            let e = URL_SAFE_NO_PAD
                .decode(jwk.e)
                .map_err(|_| IdentityError::InvalidKey)?;
            if !(256..=512).contains(&n.len())
                || e.is_empty()
                || e.len() > 4
                || n[0] == 0
                || e[0] == 0
            {
                return Err(IdentityError::InvalidKey);
            }
            let key = RsaPublicKey::new(BigUint::from_bytes_be(&n), BigUint::from_bytes_be(&e))
                .map_err(|_| IdentityError::InvalidKey)?;
            if key.n().bits() < 2048 {
                return Err(IdentityError::InvalidKey);
            }
            keys.push((jwk.kid, key));
        }
        Ok(Self(keys))
    }
}

/// Subject is the only identity returned. Name/email and client-provided participant IDs are not
/// identity. Signature verification does not consume a challenge: the caller must atomically do so.
#[derive(Debug, PartialEq, Eq)]
pub struct VerifiedIdentity {
    pub subject: String,
    pub issued_at_seconds: u64,
}
pub fn verify_identity_token(
    token: &str,
    keys: &AppleKeys,
    audience: &str,
    expected_nonce: &str,
    now_seconds: u64,
) -> Result<VerifiedIdentity, IdentityError> {
    if token.len() > MAX_TOKEN || audience.is_empty() || expected_nonce.is_empty() {
        return Err(IdentityError::Malformed);
    }
    let parts: Vec<_> = token.split('.').collect();
    if parts.len() != 3 || parts.iter().any(|part| part.is_empty()) {
        return Err(IdentityError::Malformed);
    }
    let decode = |part: &str| {
        URL_SAFE_NO_PAD
            .decode(part)
            .map_err(|_| IdentityError::Malformed)
    };
    let header: Header =
        serde_json::from_slice(&decode(parts[0])?).map_err(|_| IdentityError::Malformed)?;
    if header.alg != "RS256" || header.crit.is_some() {
        return Err(IdentityError::InvalidKey);
    }
    let key = &keys
        .0
        .iter()
        .find(|(kid, _)| kid == &header.kid)
        .ok_or(IdentityError::UnknownKey)?
        .1;
    let signature = decode(parts[2])?;
    if signature.len() != key.size() {
        return Err(IdentityError::InvalidSignature);
    }
    key.verify(
        Pkcs1v15Sign::new::<Sha256>(),
        &Sha256::digest(format!("{}.{}", parts[0], parts[1])),
        &signature,
    )
    .map_err(|_| IdentityError::InvalidSignature)?;
    let claims: Claims =
        serde_json::from_slice(&decode(parts[1])?).map_err(|_| IdentityError::Malformed)?;
    if claims.iss != "https://appleid.apple.com"
        || claims.aud != audience
        || claims.nonce != expected_nonce
        || claims.sub.is_empty()
        || claims.sub.len() > 255
        || claims.sub.chars().any(char::is_control)
        || claims.exp <= now_seconds
        || claims.iat > now_seconds
        || claims.exp <= claims.iat
    {
        return Err(IdentityError::InvalidClaims);
    }
    Ok(VerifiedIdentity {
        subject: claims.sub,
        issued_at_seconds: claims.iat,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_nonce_contract_is_explicit_utf8_hashing() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../contracts/fixtures/apple-nonce.json"
        ))
        .unwrap();
        assert_eq!(
            crate::assertion::hex(&Sha256::digest(
                fixture["nonce"].as_str().unwrap().as_bytes()
            )),
            fixture["apple_request_nonce"].as_str().unwrap()
        );
    }
    #[test]
    fn independently_signed_tokens_enforce_signature_claims_and_algorithms() {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../../tests/fixtures/apple-jwt.json")).unwrap();
        let keys =
            AppleKeys::from_apple_response(&serde_json::to_vec(&fixture["jwks"]).unwrap()).unwrap();
        let verify = |token| {
            verify_identity_token(
                token,
                &keys,
                "app.getfolding.Folding.Staging",
                "synthetic-nonce",
                1500,
            )
        };
        assert_eq!(
            verify(fixture["valid"].as_str().unwrap()).unwrap().subject,
            "synthetic-subject"
        );
        for token in fixture["rejected"].as_array().unwrap() {
            assert!(verify(token.as_str().unwrap()).is_err());
        }
        assert!(verify("not.a.jwt").is_err());
        assert!(verify(&"a".repeat(16385)).is_err());
        let mut duplicate = fixture["jwks"].clone();
        duplicate["keys"]
            .as_array_mut()
            .unwrap()
            .push(fixture["jwks"]["keys"][0].clone());
        assert!(AppleKeys::from_apple_response(&serde_json::to_vec(&duplicate).unwrap()).is_err());
    }
}
