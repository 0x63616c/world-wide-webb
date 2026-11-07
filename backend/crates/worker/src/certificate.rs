//! Certificate path verification delegates DER/path/constraints to RustCrypto X.509 and WebPKI.
//! The small provider adapter selects pure-Rust ECDSA primitives that compile to Workers Wasm.
use der::{Decode, Sequence, asn1::OctetString};
use p256::ecdsa::signature::hazmat::PrehashVerifier;
use rustls_pki_types::{
    AlgorithmIdentifier, CertificateDer, InvalidSignature, SignatureVerificationAlgorithm,
    UnixTime, alg_id,
};
use sha2::{Digest, Sha256, Sha384};
use std::time::Duration;
use x509_cert::Certificate;

pub const APPLE_ROOT: &[u8] = include_bytes!("../roots/apple-app-attestation.der");
#[derive(Debug, PartialEq, Eq)]
pub enum CertificateError {
    Malformed,
    InvalidChain,
    MissingNonce,
    InvalidNonce,
    InvalidKey,
}
#[derive(Debug)]
struct EcdsaAlgorithm {
    p384: bool,
    sha384: bool,
}
impl SignatureVerificationAlgorithm for EcdsaAlgorithm {
    fn public_key_alg_id(&self) -> AlgorithmIdentifier {
        if self.p384 {
            alg_id::ECDSA_P384
        } else {
            alg_id::ECDSA_P256
        }
    }
    fn signature_alg_id(&self) -> AlgorithmIdentifier {
        if self.sha384 {
            alg_id::ECDSA_SHA384
        } else {
            alg_id::ECDSA_SHA256
        }
    }
    fn verify_signature(
        &self,
        key: &[u8],
        message: &[u8],
        signature: &[u8],
    ) -> Result<(), InvalidSignature> {
        let digest = if self.sha384 {
            Sha384::digest(message).to_vec()
        } else {
            Sha256::digest(message).to_vec()
        };
        if self.p384 {
            let key =
                p384::ecdsa::VerifyingKey::from_sec1_bytes(key).map_err(|_| InvalidSignature)?;
            let sig = p384::ecdsa::Signature::from_der(signature).map_err(|_| InvalidSignature)?;
            key.verify_prehash(&digest, &sig)
                .map_err(|_| InvalidSignature)
        } else {
            let key =
                p256::ecdsa::VerifyingKey::from_sec1_bytes(key).map_err(|_| InvalidSignature)?;
            let sig = p256::ecdsa::Signature::from_der(signature).map_err(|_| InvalidSignature)?;
            key.verify_prehash(&digest, &sig)
                .map_err(|_| InvalidSignature)
        }
    }
}
static ALGORITHMS: &[&dyn SignatureVerificationAlgorithm] = &[
    &EcdsaAlgorithm {
        p384: false,
        sha384: false,
    },
    &EcdsaAlgorithm {
        p384: false,
        sha384: true,
    },
    &EcdsaAlgorithm {
        p384: true,
        sha384: false,
    },
    &EcdsaAlgorithm {
        p384: true,
        sha384: true,
    },
];
#[derive(Sequence)]
struct AppleNonce {
    #[asn1(context_specific = "1", tag_mode = "EXPLICIT")]
    nonce: OctetString,
}

/// Returns the leaf SEC1 public key only after Apple-rooted path and nonce checks. A receipt and
/// authenticator-data validation are still mandatory before this key may be persisted/enrolled.
pub fn verify_apple_credential(
    chain: &[Vec<u8>],
    nonce: &[u8; 32],
    now_seconds: u64,
) -> Result<Vec<u8>, CertificateError> {
    verify_credential_with_root(chain, nonce, now_seconds, APPLE_ROOT)
}
fn verify_credential_with_root(
    chain: &[Vec<u8>],
    nonce: &[u8; 32],
    now_seconds: u64,
    root: &[u8],
) -> Result<Vec<u8>, CertificateError> {
    if chain.is_empty() || chain.len() > 4 || chain.iter().any(|c| c.len() > 16384) {
        return Err(CertificateError::Malformed);
    }
    const PURPOSE: der::asn1::ObjectIdentifier =
        der::asn1::ObjectIdentifier::new_unwrap("1.2.840.113635.100.4.24");
    verify_path(
        chain,
        root,
        now_seconds,
        webpki::KeyUsage::required_if_present(PURPOSE.as_bytes()),
    )?;
    let certificate = Certificate::from_der(&chain[0]).map_err(|_| CertificateError::Malformed)?;
    let tbs = certificate.tbs_certificate();
    let oid = der::asn1::ObjectIdentifier::new_unwrap("1.2.840.113635.100.8.2");
    let extensions: Vec<_> = tbs
        .extensions()
        .into_iter()
        .flatten()
        .filter(|e| e.extn_id == oid)
        .collect();
    if extensions.len() != 1 {
        return Err(CertificateError::MissingNonce);
    }
    let parsed = AppleNonce::from_der(extensions[0].extn_value.as_bytes())
        .map_err(|_| CertificateError::Malformed)?;
    if parsed.nonce.as_bytes() != nonce {
        return Err(CertificateError::InvalidNonce);
    }
    let algorithm = &tbs.subject_public_key_info().algorithm;
    if algorithm.oid != der::asn1::ObjectIdentifier::new_unwrap("1.2.840.10045.2.1")
        || algorithm
            .parameters
            .as_ref()
            .and_then(|value| value.decode_as::<der::asn1::ObjectIdentifier>().ok())
            != Some(der::asn1::ObjectIdentifier::new_unwrap(
                "1.2.840.10045.3.1.7",
            ))
    {
        return Err(CertificateError::InvalidKey);
    }
    let public = tbs
        .subject_public_key_info()
        .subject_public_key
        .as_bytes()
        .ok_or(CertificateError::InvalidKey)?;
    if public.len() != 65 || public[0] != 4 {
        return Err(CertificateError::InvalidKey);
    }
    p256::ecdsa::VerifyingKey::from_sec1_bytes(public).map_err(|_| CertificateError::InvalidKey)?;
    Ok(public.to_vec())
}

fn verify_path(
    chain: &[Vec<u8>],
    root: &[u8],
    now_seconds: u64,
    usage: webpki::KeyUsage,
) -> Result<(), CertificateError> {
    if chain.is_empty() || chain.len() > 5 || chain.iter().any(|c| c.len() > 16384) {
        return Err(CertificateError::Malformed);
    }
    let root = CertificateDer::from(root);
    let anchor =
        webpki::anchor_from_trusted_cert(&root).map_err(|_| CertificateError::Malformed)?;
    let leaf = CertificateDer::from(chain[0].as_slice());
    let end = webpki::EndEntityCert::try_from(&leaf).map_err(|_| CertificateError::Malformed)?;
    let intermediates: Vec<_> = chain[1..]
        .iter()
        .map(|c| CertificateDer::from(c.as_slice()))
        .collect();
    end.verify_for_usage(
        ALGORITHMS,
        &[anchor],
        &intermediates,
        UnixTime::since_unix_epoch(Duration::from_secs(now_seconds)),
        usage,
        None,
        None,
    )
    .map_err(|_| CertificateError::InvalidChain)?;
    Ok(())
}
pub(crate) fn verify_receipt_signer(
    chain: &[Vec<u8>],
    now_seconds: u64,
) -> Result<Vec<u8>, CertificateError> {
    verify_receipt_signer_with_root(
        chain,
        now_seconds,
        include_bytes!("../roots/apple-root-g3.der"),
    )
}
fn verify_receipt_signer_with_root(
    chain: &[Vec<u8>],
    now_seconds: u64,
    root: &[u8],
) -> Result<Vec<u8>, CertificateError> {
    const PURPOSE: der::asn1::ObjectIdentifier =
        der::asn1::ObjectIdentifier::new_unwrap("1.2.840.113635.100.12.15");
    verify_path(
        chain,
        root,
        now_seconds,
        webpki::KeyUsage::required_if_present(PURPOSE.as_bytes()),
    )?;
    let leaf = Certificate::from_der(&chain[0]).map_err(|_| CertificateError::Malformed)?;
    let markers: Vec<_> = leaf
        .tbs_certificate()
        .extensions()
        .into_iter()
        .flatten()
        .filter(|e| e.extn_id == PURPOSE)
        .collect();
    if markers.len() != 1 || markers[0].extn_value.as_bytes() != [5, 0] {
        return Err(CertificateError::InvalidKey);
    }
    extract_p256_key(&chain[0])
}
pub(crate) fn extract_p256_key(encoded: &[u8]) -> Result<Vec<u8>, CertificateError> {
    let certificate = Certificate::from_der(encoded).map_err(|_| CertificateError::Malformed)?;
    let spki = certificate.tbs_certificate().subject_public_key_info();
    if spki.algorithm.oid != der::asn1::ObjectIdentifier::new_unwrap("1.2.840.10045.2.1")
        || spki
            .algorithm
            .parameters
            .as_ref()
            .and_then(|v| v.decode_as::<der::asn1::ObjectIdentifier>().ok())
            != Some(der::asn1::ObjectIdentifier::new_unwrap(
                "1.2.840.10045.3.1.7",
            ))
    {
        return Err(CertificateError::InvalidKey);
    }
    let point = spki
        .subject_public_key
        .as_bytes()
        .ok_or(CertificateError::InvalidKey)?;
    if point.len() != 65 || point[0] != 4 {
        return Err(CertificateError::InvalidKey);
    }
    p256::ecdsa::VerifyingKey::from_sec1_bytes(point).map_err(|_| CertificateError::InvalidKey)?;
    Ok(point.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{Engine, engine::general_purpose::STANDARD};
    #[test]
    fn independent_chain_rejects_wrong_root_nonce_expiry_and_signature() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../tests/fixtures/certificate-chain.json"
        ))
        .unwrap();
        let root = STANDARD.decode(fixture["root"].as_str().unwrap()).unwrap();
        let leaf = STANDARD.decode(fixture["leaf"].as_str().unwrap()).unwrap();
        let now = fixture["verified_at_seconds"].as_u64().unwrap();
        let chain = vec![leaf.clone()];
        assert_eq!(
            verify_credential_with_root(&chain, &[3; 32], now, &root)
                .unwrap()
                .len(),
            65
        );
        assert_eq!(
            verify_credential_with_root(&chain, &[4; 32], now, &root),
            Err(CertificateError::InvalidNonce)
        );
        assert_eq!(
            verify_apple_credential(&chain, &[3; 32], now),
            Err(CertificateError::InvalidChain)
        );
        assert_eq!(
            verify_credential_with_root(&chain, &[3; 32], now + 400 * 86400, &root),
            Err(CertificateError::InvalidChain)
        );
        let mut changed = leaf;
        let end = changed.len() - 1;
        changed[end] ^= 1;
        assert_eq!(
            verify_credential_with_root(&[changed], &[3; 32], now, &root),
            Err(CertificateError::InvalidChain)
        );
    }
}

#[cfg(test)]
pub(crate) fn test_credential_root(
    chain: &[Vec<u8>],
    nonce: &[u8; 32],
    now: u64,
    root: &[u8],
) -> Result<Vec<u8>, CertificateError> {
    verify_credential_with_root(chain, nonce, now, root)
}
#[cfg(test)]
pub(crate) fn test_receipt_root(
    chain: &[Vec<u8>],
    now: u64,
    root: &[u8],
) -> Result<Vec<u8>, CertificateError> {
    verify_receipt_signer_with_root(chain, now, root)
}
