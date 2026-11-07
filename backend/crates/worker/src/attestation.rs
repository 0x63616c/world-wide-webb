//! App Attest credential validation stages. Output is deliberately NOT an enrolled key: Apple's
//! CMS receipt still requires independent verification before any database enrollment is allowed.
use crate::certificate::verify_apple_credential;
use ciborium::value::Value;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::io::Cursor;

#[derive(Debug, PartialEq, Eq)]
pub enum AttestationError {
    Malformed,
    WrongApplication,
    WrongEnvironment,
    WrongKey,
    InvalidCertificate,
    InvalidExtensions,
    InvalidReceipt,
}
pub struct AppPolicy<'a> {
    pub app_id: &'a str,
    pub development: bool,
    /// Deployment configuration, never client input. Production permits TestFlight/App Store.
    pub allowed_bundle_versions: &'a [&'a str],
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Object {
    fmt: String,
    #[serde(rename = "attStmt")]
    statement: Statement,
    #[serde(rename = "authData", with = "serde_bytes")]
    auth_data: Vec<u8>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Statement {
    x5c: Vec<serde_bytes::ByteBuf>,
    #[serde(with = "serde_bytes")]
    receipt: Vec<u8>,
}
/// Cannot be used as proof of receipt validation or persisted directly as a trusted key.
pub struct CredentialPendingReceipt {
    pub public_key_sec1: Vec<u8>,
    pub receipt: Vec<u8>,
}
fn value_at<'a>(map: &'a [(Value, Value)], name: &str) -> Result<&'a Value, AttestationError> {
    let mut matches = map.iter().filter(|(key, _)| key.as_text() == Some(name));
    let value = &matches.next().ok_or(AttestationError::InvalidExtensions)?.1;
    if matches.next().is_some() {
        return Err(AttestationError::InvalidExtensions);
    }
    Ok(value)
}
pub fn verify_extensions(encoded: &[u8], policy: &AppPolicy<'_>) -> Result<(), AttestationError> {
    let mut reader = Cursor::new(encoded);
    let value: Value =
        ciborium::from_reader(&mut reader).map_err(|_| AttestationError::Malformed)?;
    if reader.position() as usize != encoded.len() {
        return Err(AttestationError::Malformed);
    }
    let map = value.as_map().ok_or(AttestationError::InvalidExtensions)?;
    let category = value_at(map, "apple_validation_category_01")?
        .as_bytes()
        .ok_or(AttestationError::InvalidExtensions)?;
    let category = u32::from_le_bytes(
        category
            .as_slice()
            .try_into()
            .map_err(|_| AttestationError::InvalidExtensions)?,
    );
    let version = value_at(map, "apple_bundle_version_01")?
        .as_text()
        .ok_or(AttestationError::InvalidExtensions)?;
    if !(if policy.development {
        category == 3
    } else {
        category == 2 || category == 4
    }) || !policy.allowed_bundle_versions.contains(&version)
    {
        return Err(AttestationError::InvalidExtensions);
    }
    Ok(())
}
/// Validate flags/extension bytes in a newer assertion. No missing-extension downgrade is enabled.
pub fn verify_assertion_metadata(
    auth: &[u8],
    policy: &AppPolicy<'_>,
) -> Result<(), AttestationError> {
    if auth.len() <= 37 || auth[32] & 0x40 != 0 {
        return Err(AttestationError::InvalidExtensions);
    }
    verify_extensions(&auth[37..], policy)
}
pub fn verify_credential_stage(
    encoded: &[u8],
    key_id: &[u8; 32],
    client_hash: &[u8; 32],
    policy: &AppPolicy<'_>,
    now_seconds: u64,
) -> Result<CredentialPendingReceipt, AttestationError> {
    credential_stage_using(
        encoded,
        key_id,
        client_hash,
        policy,
        now_seconds,
        verify_apple_credential,
    )
}
fn credential_stage_using(
    encoded: &[u8],
    key_id: &[u8; 32],
    client_hash: &[u8; 32],
    policy: &AppPolicy<'_>,
    now_seconds: u64,
    verify_certificate: impl Fn(
        &[Vec<u8>],
        &[u8; 32],
        u64,
    ) -> Result<Vec<u8>, crate::certificate::CertificateError>,
) -> Result<CredentialPendingReceipt, AttestationError> {
    if encoded.len() > 65536 {
        return Err(AttestationError::Malformed);
    }
    let mut reader = Cursor::new(encoded);
    let object: Object =
        ciborium::from_reader(&mut reader).map_err(|_| AttestationError::Malformed)?;
    if reader.position() as usize != encoded.len()
        || object.fmt != "apple-appattest"
        || object.statement.receipt.is_empty()
    {
        return Err(AttestationError::Malformed);
    }
    let auth = &object.auth_data;
    if auth.len() < 87 || auth[32] & 0x40 == 0 || auth[33..37] != [0; 4] {
        return Err(AttestationError::Malformed);
    }
    if auth[..32] != Sha256::digest(policy.app_id.as_bytes())[..] {
        return Err(AttestationError::WrongApplication);
    }
    let aaguid = if policy.development {
        b"appattestdevelop"
    } else {
        b"appattest\0\0\0\0\0\0\0"
    };
    if &auth[37..53] != aaguid {
        return Err(AttestationError::WrongEnvironment);
    }
    if auth[53..55] != [0, 32] || &auth[55..87] != key_id {
        return Err(AttestationError::WrongKey);
    }
    let mut cose_reader = Cursor::new(&auth[87..]);
    let cose: Value =
        ciborium::from_reader(&mut cose_reader).map_err(|_| AttestationError::Malformed)?;
    let map = cose.as_map().ok_or(AttestationError::Malformed)?;
    let field = |label: i64| -> Result<&Value, AttestationError> {
        let mut matches = map
            .iter()
            .filter(|(k, _)| k.as_integer().and_then(|v| i64::try_from(v).ok()) == Some(label));
        let value = &matches.next().ok_or(AttestationError::WrongKey)?.1;
        if matches.next().is_some() {
            return Err(AttestationError::WrongKey);
        }
        Ok(value)
    };
    for (label, expected) in [(1, 2), (3, -7), (-1, 1)] {
        if field(label)?
            .as_integer()
            .and_then(|v| i64::try_from(v).ok())
            != Some(expected)
        {
            return Err(AttestationError::WrongKey);
        }
    }
    let mut cose_key = vec![4];
    for label in [-2, -3] {
        let coordinate = field(label)?.as_bytes().ok_or(AttestationError::WrongKey)?;
        if coordinate.len() != 32 {
            return Err(AttestationError::WrongKey);
        }
        cose_key.extend(coordinate);
    }
    verify_extensions(&auth[87 + cose_reader.position() as usize..], policy)?;
    let mut nonce = Sha256::new();
    nonce.update(auth);
    nonce.update(client_hash);
    let chain: Vec<_> = object
        .statement
        .x5c
        .into_iter()
        .map(|b| b.into_vec())
        .collect();
    let public_key = verify_certificate(&chain, &nonce.finalize().into(), now_seconds)
        .map_err(|_| AttestationError::InvalidCertificate)?;
    if public_key != cose_key || Sha256::digest(&public_key)[..] != key_id[..] {
        return Err(AttestationError::WrongKey);
    }
    Ok(CredentialPendingReceipt {
        public_key_sec1: public_key,
        receipt: object.statement.receipt,
    })
}
/// Constructible only after both certificate/authenticator and CMS receipt validation.
pub struct VerifiedEnrollment {
    public_key: Vec<u8>,
    receipt: Vec<u8>,
    receipt_expires_at_ms: u64,
}
impl VerifiedEnrollment {
    pub fn public_key(&self) -> &[u8] {
        &self.public_key
    }
    pub fn receipt(&self) -> &[u8] {
        &self.receipt
    }
    pub fn receipt_expires_at_ms(&self) -> u64 {
        self.receipt_expires_at_ms
    }
}
pub fn verify_attestation(
    encoded: &[u8],
    key_id: &[u8; 32],
    client_hash: &[u8; 32],
    policy: &AppPolicy<'_>,
    now_ms: u64,
) -> Result<VerifiedEnrollment, AttestationError> {
    let pending = verify_credential_stage(encoded, key_id, client_hash, policy, now_ms / 1000)?;
    let validated = crate::receipt::verify_receipt(
        &pending.receipt,
        policy.app_id,
        &pending.public_key_sec1,
        client_hash,
        now_ms,
    )
    .map_err(|_| AttestationError::InvalidReceipt)?;
    Ok(VerifiedEnrollment {
        public_key: pending.public_key_sec1,
        receipt: pending.receipt,
        receipt_expires_at_ms: validated.expires_at_ms,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn extensions_are_required_and_distribution_and_version_are_server_policy() {
        let policy = AppPolicy {
            app_id: "TEAM.app",
            development: false,
            allowed_bundle_versions: &["1"],
        };
        let encode = |category: i32, version: &str| {
            let value = Value::Map(vec![
                (
                    Value::Text("apple_validation_category_01".into()),
                    Value::Bytes((category as u32).to_le_bytes().to_vec()),
                ),
                (
                    Value::Text("apple_bundle_version_01".into()),
                    Value::Text(version.into()),
                ),
            ]);
            let mut bytes = vec![0; 37];
            bytes[32] = 0x80;
            ciborium::into_writer(&value, &mut bytes).unwrap();
            bytes
        };
        assert!(verify_assertion_metadata(&encode(4, "1"), &policy).is_ok());
        assert!(verify_assertion_metadata(&encode(2, "1"), &policy).is_ok());
        for category in [0, 1, 3, 5, 6, 7, 8, 9, 10] {
            assert!(verify_assertion_metadata(&encode(category, "1"), &policy).is_err());
        }
        assert!(verify_assertion_metadata(&encode(4, "unapproved"), &policy).is_err());
        assert!(verify_assertion_metadata(&[0; 37], &policy).is_err());
    }
}

#[cfg(test)]
mod complete_vectors {
    use super::*;
    use base64::{Engine, engine::general_purpose::STANDARD};
    #[test]
    fn independent_complete_credential_and_receipt_binding() {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../../tests/fixtures/enrollment.json")).unwrap();
        let bytes = |name: &str| STANDARD.decode(fixture[name].as_str().unwrap()).unwrap();
        let root = bytes("attestation_root");
        let receipt_root = bytes("receipt_root");
        let encoded = bytes("attestation");
        let hash: [u8; 32] = bytes("client_hash").try_into().unwrap();
        let key_id: [u8; 32] = bytes("key_id").try_into().unwrap();
        let now = fixture["verification_time_ms"].as_u64().unwrap();
        let mut policy = AppPolicy {
            app_id: fixture["app_id"].as_str().unwrap(),
            development: true,
            allowed_bundle_versions: &["1"],
        };
        let verifier = |chain: &[Vec<u8>], nonce: &[u8; 32], time| {
            crate::certificate::test_credential_root(chain, nonce, time, &root)
        };
        let pending =
            credential_stage_using(&encoded, &key_id, &hash, &policy, now / 1000, verifier)
                .unwrap();
        assert_eq!(pending.public_key_sec1, bytes("public_key_sec1"));
        assert!(
            crate::receipt::test_receipt_root(
                &pending.receipt,
                policy.app_id,
                &pending.public_key_sec1,
                &hash,
                now,
                &receipt_root
            )
            .is_ok()
        );
        assert!(verify_attestation(&encoded, &key_id, &hash, &policy, now).is_err()); // Production roots cannot be replaced.
        assert!(
            credential_stage_using(&encoded, &key_id, &[0; 32], &policy, now / 1000, verifier)
                .is_err()
        );
        assert!(
            credential_stage_using(&encoded, &[0; 32], &hash, &policy, now / 1000, verifier)
                .is_err()
        );
        policy.development = false;
        assert!(matches!(
            credential_stage_using(&encoded, &key_id, &hash, &policy, now / 1000, verifier),
            Err(AttestationError::WrongEnvironment)
        ));
        policy.development = true;
        policy.allowed_bundle_versions = &["other"];
        assert!(matches!(
            credential_stage_using(&encoded, &key_id, &hash, &policy, now / 1000, verifier),
            Err(AttestationError::InvalidExtensions)
        ));
    }
}
