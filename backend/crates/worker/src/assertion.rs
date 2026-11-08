//! App Attest assertion primitive. This does NOT enroll or attest a key: callers must load a key
//! already validated against Apple's certificate chain and bind its owner/session/deployment.
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use folding_domain::wire::Id;
use p256::ecdsa::{Signature, VerifyingKey, signature::Verifier};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::Cursor;

#[derive(Debug, PartialEq, Eq)]
pub enum AssertionError {
    Malformed,
    InvalidBinding,
    WrongApplication,
    InvalidMetadata {
        authenticator_bytes: usize,
        flags: u8,
    },
    Replay,
    InvalidSignature,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Assertion {
    #[serde(with = "serde_bytes")]
    signature: Vec<u8>,
    #[serde(rename = "authenticatorData", with = "serde_bytes")]
    authenticator_data: Vec<u8>,
}
pub struct Binding<'a> {
    pub deployment: &'a str,
    pub method: &'a str,
    pub path: &'a str,
    pub challenge_id: &'a Id,
    pub nonce_base64url: &'a str,
    pub exact_body: &'a [u8],
}
pub fn client_data_hash(binding: &Binding<'_>) -> Result<[u8; 32], AssertionError> {
    if !["staging", "production"].contains(&binding.deployment)
        || !["POST", "PUT", "PATCH", "DELETE"].contains(&binding.method)
        || !binding.path.starts_with("/v1/")
        || binding.path.contains(['\n', '\r', '?', '#'])
        || URL_SAFE_NO_PAD
            .decode(binding.nonce_base64url)
            .map(|n| n.len())
            .ok()
            != Some(32)
    {
        return Err(AssertionError::InvalidBinding);
    }
    let body_hash = hex(&Sha256::digest(binding.exact_body));
    let input = format!(
        "Folding-v1\n{}\n{}\n{}\n{}\n{}\n{}",
        binding.deployment,
        binding.method,
        binding.path,
        binding.challenge_id.as_str(),
        binding.nonce_base64url,
        body_hash
    );
    Ok(Sha256::digest(input.as_bytes()).into())
}
pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Returns a *provisional* new counter. The database must still CAS the old counter and consume
/// the purpose-bound challenge in the same transaction as the business mutation/receipt.
pub fn verify_assertion(
    encoded: &[u8],
    public_key_sec1: &[u8],
    app_id: &str,
    previous_counter: u32,
    client_hash: &[u8; 32],
) -> Result<u32, AssertionError> {
    verify_assertion_inner(
        encoded,
        public_key_sec1,
        app_id,
        previous_counter,
        client_hash,
        None,
    )
}
/// Production entry point requires current Apple distribution/version extensions. The legacy
/// primitive above exists for independent historical vectors and must not authorize enrollment.
pub fn verify_assertion_with_policy(
    encoded: &[u8],
    public_key_sec1: &[u8],
    previous_counter: u32,
    client_hash: &[u8; 32],
    policy: &crate::attestation::AppPolicy<'_>,
) -> Result<u32, AssertionError> {
    verify_assertion_inner(
        encoded,
        public_key_sec1,
        policy.app_id,
        previous_counter,
        client_hash,
        Some(policy),
    )
}
fn verify_assertion_inner(
    encoded: &[u8],
    public_key_sec1: &[u8],
    app_id: &str,
    previous_counter: u32,
    client_hash: &[u8; 32],
    policy: Option<&crate::attestation::AppPolicy<'_>>,
) -> Result<u32, AssertionError> {
    if encoded.len() > 16 * 1024 {
        return Err(AssertionError::Malformed);
    }
    let mut reader = Cursor::new(encoded);
    let assertion: Assertion =
        ciborium::from_reader(&mut reader).map_err(|_| AssertionError::Malformed)?;
    if reader.position() as usize != encoded.len() || assertion.authenticator_data.len() < 37 {
        return Err(AssertionError::Malformed);
    }
    match policy {
        Some(policy) => {
            crate::attestation::verify_assertion_metadata(&assertion.authenticator_data, policy)
                .map_err(|_| AssertionError::InvalidMetadata {
                    authenticator_bytes: assertion.authenticator_data.len(),
                    flags: assertion.authenticator_data[32],
                })?
        }
        None if assertion.authenticator_data.len() != 37 => return Err(AssertionError::Malformed),
        None => {}
    }
    if assertion.authenticator_data[..32] != Sha256::digest(app_id.as_bytes())[..] {
        return Err(AssertionError::WrongApplication);
    }
    let counter = u32::from_be_bytes(
        assertion.authenticator_data[33..37]
            .try_into()
            .map_err(|_| AssertionError::Malformed)?,
    );
    if counter <= previous_counter {
        return Err(AssertionError::Replay);
    }
    let key =
        VerifyingKey::from_sec1_bytes(public_key_sec1).map_err(|_| AssertionError::Malformed)?;
    let signature =
        Signature::from_der(&assertion.signature).map_err(|_| AssertionError::Malformed)?;
    let mut digest = Sha256::new();
    digest.update(&assertion.authenticator_data);
    digest.update(client_hash);
    // App Attest signs nonce using ECDSA-with-SHA256. Verifier hashes this nonce once more;
    // treating nonce as an already-final ECDSA prehash accepts a different signature protocol.
    key.verify(&digest.finalize(), &signature)
        .map_err(|_| AssertionError::InvalidSignature)?;
    Ok(counter)
}

#[cfg(test)]
mod tests {
    use super::*;
    use p256::ecdsa::{SigningKey, signature::Signer};
    #[test]
    fn join_accepts_signed_assertion_with_apple_documented_extension_names() {
        use ciborium::value::Value;
        let key = SigningKey::from_bytes((&[7u8; 32]).into()).unwrap();
        let policy = crate::attestation::AppPolicy {
            app_id: "TEAM.app.getfolding.Folding",
            development: false,
            allowed_bundle_versions: &["9"],
        };
        let binding = client_data_hash(&Binding {
            deployment: "production",
            method: "POST",
            path: "/v1/enrollment/join",
            challenge_id: &Id::nil(),
            nonce_base64url: &URL_SAFE_NO_PAD.encode([1u8; 32]),
            exact_body: b"{\"nickname\":\"Folder\"}",
        })
        .unwrap();
        let mut auth = Sha256::digest(policy.app_id.as_bytes()).to_vec();
        auth.push(0x80);
        auth.extend(1u32.to_be_bytes());
        let extensions = Value::Map(vec![
            (
                Value::Text("validationCategory".into()),
                Value::Bytes(2u32.to_le_bytes().to_vec()),
            ),
            (Value::Text("bundleVersion".into()), Value::Text("9".into())),
        ]);
        ciborium::into_writer(&extensions, &mut auth).unwrap();
        let nonce = Sha256::digest([auth.as_slice(), &binding].concat());
        let signature: Signature = key.sign(&nonce);
        let assertion = Assertion {
            signature: signature.to_der().as_bytes().to_vec(),
            authenticator_data: auth,
        };
        let mut encoded = Vec::new();
        ciborium::into_writer(&assertion, &mut encoded).unwrap();
        assert_eq!(
            verify_assertion_with_policy(
                &encoded,
                &key.verifying_key().to_sec1_bytes(),
                0,
                &binding,
                &policy
            ),
            Ok(1)
        );
    }
    fn signed(hash: &[u8; 32], app: &str, counter: u32) -> (Vec<u8>, Vec<u8>) {
        let key = SigningKey::from_bytes((&[7u8; 32]).into()).unwrap();
        let mut auth = Sha256::digest(app.as_bytes()).to_vec();
        auth.push(0);
        auth.extend(counter.to_be_bytes());
        let mut digest = Sha256::new();
        digest.update(&auth);
        digest.update(hash);
        let signature: Signature = key.sign(&digest.finalize());
        let assertion = Assertion {
            signature: signature.to_der().as_bytes().to_vec(),
            authenticator_data: auth,
        };
        let mut encoded = Vec::new();
        ciborium::into_writer(&assertion, &mut encoded).unwrap();
        (encoded, key.verifying_key().to_sec1_bytes().to_vec())
    }
    #[test]
    fn independently_signed_cryptokit_nonce_fixture() {
        use base64::engine::general_purpose::STANDARD;
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../tests/fixtures/cryptokit-assertion.json"
        ))
        .unwrap();
        let bytes = |name: &str| STANDARD.decode(fixture[name].as_str().unwrap()).unwrap();
        let assertion = Assertion {
            signature: bytes("signature_der"),
            authenticator_data: bytes("authenticator_data"),
        };
        let mut encoded = Vec::new();
        ciborium::into_writer(&assertion, &mut encoded).unwrap();
        let hash: [u8; 32] = bytes("client_hash").try_into().unwrap();
        assert_eq!(
            verify_assertion(
                &encoded,
                &bytes("public_key_sec1"),
                fixture["app_id"].as_str().unwrap(),
                0,
                &hash
            ),
            Ok(1)
        );
    }

    #[test]
    fn signed_request_rejects_body_app_counter_and_trailing_data_changes() {
        let id = Id::nil();
        let nonce = URL_SAFE_NO_PAD.encode([1u8; 32]);
        let mut binding = Binding {
            deployment: "staging",
            method: "POST",
            path: "/v1/event-batches",
            challenge_id: &id,
            nonce_base64url: &nonce,
            exact_body: b"{}",
        };
        let original = client_data_hash(&binding).unwrap();
        let (encoded, key) = signed(&original, "TEAM.app.getfolding.Folding.Staging", 1);
        assert_eq!(
            verify_assertion(
                &encoded,
                &key,
                "TEAM.app.getfolding.Folding.Staging",
                0,
                &original
            ),
            Ok(1)
        );
        binding.exact_body = b"{ }";
        assert_eq!(
            verify_assertion(
                &encoded,
                &key,
                "TEAM.app.getfolding.Folding.Staging",
                0,
                &client_data_hash(&binding).unwrap()
            ),
            Err(AssertionError::InvalidSignature)
        );
        assert_eq!(
            verify_assertion(&encoded, &key, "OTHER.app", 0, &original),
            Err(AssertionError::WrongApplication)
        );
        assert_eq!(
            verify_assertion(
                &encoded,
                &key,
                "TEAM.app.getfolding.Folding.Staging",
                1,
                &original
            ),
            Err(AssertionError::Replay)
        );
        let mut extra = encoded;
        extra.push(0);
        assert_eq!(
            verify_assertion(
                &extra,
                &key,
                "TEAM.app.getfolding.Folding.Staging",
                0,
                &original
            ),
            Err(AssertionError::Malformed)
        );
        binding.path = "/v1/event-batches?bypass=yes";
        assert!(client_data_hash(&binding).is_err());
    }
}

#[cfg(test)]
mod apple_device_vector {
    use super::*;
    use base64::engine::general_purpose::STANDARD;
    #[test]
    fn historical_real_device_assertion_protocol() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../tests/fixtures/apple-ios14/vector.json"
        ))
        .unwrap();
        let bytes = |name: &str| STANDARD.decode(fixture[name].as_str().unwrap()).unwrap();
        assert_eq!(
            verify_assertion(
                &bytes("assertion"),
                &bytes("public_key_sec1"),
                fixture["app_id"].as_str().unwrap(),
                0,
                &bytes("client_hash").try_into().unwrap()
            ),
            Ok(1)
        );
    }
}
