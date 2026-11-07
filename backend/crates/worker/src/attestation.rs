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
        .as_integer()
        .and_then(|v| u32::try_from(v).ok())
        .ok_or(AttestationError::InvalidExtensions)?;
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
    if auth.len() <= 37 || auth[32] & 0xc0 != 0x80 {
        return Err(AttestationError::InvalidExtensions);
    }
    verify_extensions(&auth[37..], policy)
}
pub fn verify_credential_stage(
    encoded: &[u8],
    key_id: &[u8; 32],
    challenge: &[u8; 32],
    policy: &AppPolicy<'_>,
    now_seconds: u64,
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
    if auth.len() < 87 || auth[32] & 0xc0 != 0xc0 || auth[33..37] != [0; 4] {
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
    let client_hash = Sha256::digest(challenge);
    let mut nonce = Sha256::new();
    nonce.update(auth);
    nonce.update(client_hash);
    let chain: Vec<_> = object
        .statement
        .x5c
        .into_iter()
        .map(|b| b.into_vec())
        .collect();
    let public_key = verify_apple_credential(&chain, &nonce.finalize().into(), now_seconds)
        .map_err(|_| AttestationError::InvalidCertificate)?;
    if public_key != cose_key || Sha256::digest(&public_key)[..] != key_id[..] {
        return Err(AttestationError::WrongKey);
    }
    Ok(CredentialPendingReceipt {
        public_key_sec1: public_key,
        receipt: object.statement.receipt,
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
                    Value::Integer(category.into()),
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
