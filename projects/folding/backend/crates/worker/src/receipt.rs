//! App Attest CMS receipts: bounded BER parsing, DER signed-attribute canonicalization, pinned
//! Apple G3 signer path, then receipt/key/challenge/freshness binding. No trust from decoding alone.
use p256::ecdsa::{Signature, VerifyingKey, signature::hazmat::PrehashVerifier};
use rasn::{
    AsnType, Decode, Decoder, Encode,
    types::{ObjectIdentifier, OctetString, SetOf},
};
use rasn_cms::{CertificateChoices, ContentInfo, SignedData, SignerIdentifier};
use sha2::{Digest, Sha256, Sha384};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, PartialEq, Eq)]
pub enum ReceiptError {
    Malformed,
    InvalidChain,
    InvalidSignature,
    InvalidBinding,
    Expired,
}
#[derive(AsnType, Decode, Encode, Debug, Clone, PartialEq, Eq, Hash)]
struct Attribute {
    kind: u32,
    version: u32,
    value: OctetString,
}
#[derive(Debug, PartialEq, Eq)]
pub struct VerifiedReceipt {
    pub created_at_ms: u64,
    pub expires_at_ms: u64,
}
fn ber<T: Decode>(bytes: &[u8]) -> Result<T, ReceiptError> {
    let (value, rest) =
        rasn::ber::decode_with_remainder(bytes).map_err(|_| ReceiptError::Malformed)?;
    if !rest.is_empty() {
        return Err(ReceiptError::Malformed);
    }
    Ok(value)
}
fn digest_oid(oid: &ObjectIdentifier) -> Option<bool> {
    if oid.as_ref() == [2, 16, 840, 1, 101, 3, 4, 2, 1] {
        Some(false)
    } else if oid.as_ref() == [2, 16, 840, 1, 101, 3, 4, 2, 2] {
        Some(true)
    } else {
        None
    }
}
fn digest(bytes: &[u8], sha384: bool) -> Vec<u8> {
    if sha384 {
        Sha384::digest(bytes).to_vec()
    } else {
        Sha256::digest(bytes).to_vec()
    }
}
/// Signature/certificate trust precedes any payload trust. Returns an immutable validated result.
pub fn verify_receipt(
    encoded: &[u8],
    app_id: &str,
    public_key: &[u8],
    client_hash: &[u8; 32],
    now_ms: u64,
) -> Result<VerifiedReceipt, ReceiptError> {
    verify_receipt_using(
        encoded,
        app_id,
        public_key,
        client_hash,
        now_ms,
        crate::certificate::verify_receipt_signer,
    )
}
fn verify_receipt_using(
    encoded: &[u8],
    app_id: &str,
    public_key: &[u8],
    client_hash: &[u8; 32],
    now_ms: u64,
    verify_chain: impl Fn(&[Vec<u8>], u64) -> Result<Vec<u8>, crate::certificate::CertificateError>,
) -> Result<VerifiedReceipt, ReceiptError> {
    if encoded.len() > 65536 || encoded.is_empty() {
        return Err(ReceiptError::Malformed);
    }
    let container: ContentInfo = ber(encoded)?;
    if container.content_type != rasn_cms::CONTENT_SIGNED_DATA {
        return Err(ReceiptError::Malformed);
    }
    let signed: SignedData = ber(container.content.as_bytes())?;
    if signed.version != 1.into()
        || signed.signer_infos.len() != 1
        || signed.digest_algorithms.len() != 1
        || signed.crls.is_some()
        || signed.encap_content_info.content_type != rasn_cms::CONTENT_DATA
    {
        return Err(ReceiptError::Malformed);
    }
    let signer = signed.signer_infos.to_vec()[0];
    if signer.version != 1.into() {
        return Err(ReceiptError::Malformed);
    }
    let sha384 = digest_oid(&signer.digest_algorithm.algorithm).ok_or(ReceiptError::Malformed)?;
    if signed.digest_algorithms.to_vec()[0] != &signer.digest_algorithm
        || signer
            .digest_algorithm
            .parameters
            .as_ref()
            .is_some_and(|value| value.as_bytes() != [5, 0])
    {
        return Err(ReceiptError::Malformed);
    }
    let algorithm = if sha384 {
        &[1, 2, 840, 10045, 4, 3, 3][..]
    } else {
        &[1, 2, 840, 10045, 4, 3, 2][..]
    };
    if signer.signature_algorithm.algorithm.as_ref() != algorithm
        || signer.signature_algorithm.parameters.is_some()
    {
        return Err(ReceiptError::Malformed);
    }
    let certificates = signed
        .certificates
        .as_ref()
        .ok_or(ReceiptError::Malformed)?;
    if certificates.is_empty() || certificates.len() > 5 {
        return Err(ReceiptError::Malformed);
    }
    let SignerIdentifier::IssuerAndSerialNumber(identity) = &signer.sid else {
        return Err(ReceiptError::Malformed);
    };
    let mut chain = Vec::new();
    let mut matches = 0;
    for choice in certificates.to_vec() {
        let CertificateChoices::Certificate(certificate) = choice else {
            return Err(ReceiptError::Malformed);
        };
        let encoded =
            rasn::der::encode(certificate.as_ref()).map_err(|_| ReceiptError::Malformed)?;
        if certificate.tbs_certificate.issuer == identity.issuer
            && certificate.tbs_certificate.serial_number == identity.serial_number
        {
            matches += 1;
            chain.insert(0, encoded);
        } else {
            chain.push(encoded);
        }
    }
    if matches != 1 {
        return Err(ReceiptError::Malformed);
    }
    let signer_key = verify_chain(&chain, now_ms / 1000).map_err(|_| ReceiptError::InvalidChain)?;
    let payload = signed
        .encap_content_info
        .content
        .as_ref()
        .ok_or(ReceiptError::Malformed)?;
    let signed_bytes = if let Some(attributes) = &signer.signed_attrs {
        if attributes.len() > 32 {
            return Err(ReceiptError::Malformed);
        }
        let mut seen = BTreeSet::new();
        let mut content_type = false;
        let mut content_digest = false;
        for attribute in attributes.to_vec() {
            if !seen.insert(attribute.r#type.clone()) || attribute.values.len() != 1 {
                return Err(ReceiptError::Malformed);
            }
            let value = attribute.values.to_vec()[0];
            if attribute.r#type == rasn_cms::CONTENT_TYPE {
                let oid: ObjectIdentifier = ber(value.as_bytes())?;
                if oid != rasn_cms::CONTENT_DATA {
                    return Err(ReceiptError::InvalidBinding);
                }
                content_type = true;
            } else if attribute.r#type == rasn_cms::MESSAGE_DIGEST {
                let hash: OctetString = ber(value.as_bytes())?;
                if hash.as_ref() != digest(payload.as_ref(), sha384) {
                    return Err(ReceiptError::InvalidBinding);
                }
                content_digest = true;
            }
        }
        if !content_type || !content_digest {
            return Err(ReceiptError::Malformed);
        }
        rasn::der::encode(attributes).map_err(|_| ReceiptError::Malformed)?
    } else {
        payload.to_vec()
    };
    let key = VerifyingKey::from_sec1_bytes(&signer_key).map_err(|_| ReceiptError::InvalidChain)?;
    let signature =
        Signature::from_der(signer.signature.as_ref()).map_err(|_| ReceiptError::Malformed)?;
    key.verify_prehash(&digest(&signed_bytes, sha384), &signature)
        .map_err(|_| ReceiptError::InvalidSignature)?;
    validate_payload(payload.as_ref(), app_id, public_key, client_hash, now_ms)
}
fn validate_payload(
    bytes: &[u8],
    app_id: &str,
    public_key: &[u8],
    client_hash: &[u8; 32],
    now_ms: u64,
) -> Result<VerifiedReceipt, ReceiptError> {
    let attributes: SetOf<Attribute> = ber(bytes)?;
    if attributes.len() > 32 {
        return Err(ReceiptError::Malformed);
    }
    let mut fields = BTreeMap::new();
    for field in attributes.into_vec() {
        if field.version != 1 || fields.insert(field.kind, field.value).is_some() {
            return Err(ReceiptError::Malformed);
        }
    }
    let field = |kind| {
        fields
            .get(&kind)
            .map(AsRef::<[u8]>::as_ref)
            .ok_or(ReceiptError::Malformed)
    };
    if field(2)? != app_id.as_bytes() || field(6)? != b"ATTEST" || field(4)? != client_hash {
        return Err(ReceiptError::InvalidBinding);
    }
    if field(5)?.is_empty() {
        return Err(ReceiptError::Malformed);
    }
    let attested_key =
        crate::certificate::extract_p256_key(field(3)?).map_err(|_| ReceiptError::Malformed)?;
    if attested_key != public_key {
        return Err(ReceiptError::InvalidBinding);
    }
    let instant = |kind| -> Result<u64, ReceiptError> {
        let string = std::str::from_utf8(field(kind)?).map_err(|_| ReceiptError::Malformed)?;
        if string.len() > 64 {
            return Err(ReceiptError::Malformed);
        }
        let timestamp = chrono::DateTime::parse_from_rfc3339(string)
            .map_err(|_| ReceiptError::Malformed)?
            .timestamp_millis();
        timestamp.try_into().map_err(|_| ReceiptError::Malformed)
    };
    let created = instant(12)?;
    let expires = instant(21)?;
    if created > now_ms || now_ms - created > 300000 || expires <= now_ms || expires <= created {
        return Err(ReceiptError::Expired);
    }
    Ok(VerifiedReceipt {
        created_at_ms: created,
        expires_at_ms: expires,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{Engine, engine::general_purpose::STANDARD};
    #[test]
    fn real_historical_apple_receipt_verifies_and_rejects_binding_or_time_changes() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../tests/fixtures/apple-ios14/vector.json"
        ))
        .unwrap();
        let encoded = include_bytes!("../../../tests/fixtures/apple-ios14/receipt.der");
        let key = STANDARD
            .decode(fixture["public_key_sec1"].as_str().unwrap())
            .unwrap();
        let hash: [u8; 32] = STANDARD
            .decode(fixture["client_hash"].as_str().unwrap())
            .unwrap()
            .try_into()
            .unwrap();
        let now = fixture["verification_time_ms"].as_u64().unwrap();
        let app = fixture["app_id"].as_str().unwrap();
        assert!(verify_receipt(encoded, app, &key, &hash, now).is_ok());
        assert_eq!(
            verify_receipt(encoded, "OTHER.app", &key, &hash, now),
            Err(ReceiptError::InvalidBinding)
        );
        assert_eq!(
            verify_receipt(encoded, app, &key, &[0; 32], now),
            Err(ReceiptError::InvalidBinding)
        );
        assert_eq!(
            verify_receipt(encoded, app, &key, &hash, now + 300000),
            Err(ReceiptError::Expired)
        );
        let mut trailing = encoded.to_vec();
        trailing.push(0);
        assert_eq!(
            verify_receipt(&trailing, app, &key, &hash, now),
            Err(ReceiptError::Malformed)
        );
        let mut tampered = encoded.to_vec();
        let position = tampered
            .windows(app.len())
            .position(|part| part == app.as_bytes())
            .unwrap();
        tampered[position] ^= 1;
        assert!(verify_receipt(&tampered, app, &key, &hash, now).is_err());
    }
}

#[cfg(test)]
pub(crate) fn test_receipt_root(
    encoded: &[u8],
    app: &str,
    key: &[u8],
    hash: &[u8; 32],
    now: u64,
    root: &[u8],
) -> Result<VerifiedReceipt, ReceiptError> {
    verify_receipt_using(encoded, app, key, hash, now, |chain, time| {
        crate::certificate::test_receipt_root(chain, time, root)
    })
}
#[cfg(test)]
mod synthetic_tests {
    use super::*;
    use base64::{Engine, engine::general_purpose::STANDARD};
    #[test]
    fn independent_openssl_signed_attributes_and_ber_receipts() {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../../tests/fixtures/enrollment.json")).unwrap();
        let bytes = |name: &str| STANDARD.decode(fixture[name].as_str().unwrap()).unwrap();
        let root = bytes("receipt_root");
        let key = bytes("public_key_sec1");
        let hash: [u8; 32] = bytes("client_hash").try_into().unwrap();
        let now = fixture["verification_time_ms"].as_u64().unwrap();
        let app = fixture["app_id"].as_str().unwrap();
        for name in ["receipt", "receipt_no_attributes_ber"] {
            assert!(
                test_receipt_root(&bytes(name), app, &key, &hash, now, &root).is_ok(),
                "{name}"
            );
        }
        for (name, encoded) in fixture["bad_receipts"].as_object().unwrap() {
            let encoded = STANDARD.decode(encoded.as_str().unwrap()).unwrap();
            assert!(
                test_receipt_root(&encoded, app, &key, &hash, now, &root).is_err(),
                "{name}"
            );
        }
        assert_eq!(
            verify_receipt(&bytes("receipt"), app, &key, &hash, now),
            Err(ReceiptError::InvalidChain)
        );
    }
}
