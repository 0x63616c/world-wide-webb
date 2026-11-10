//! Bounded versioned AES-256-GCM envelope. Callers supply a fresh cryptographic 96-bit nonce.
//! Context binds ciphertext to its purpose, deployment and owning record; never reuse nonces.
use aes_gcm::{
    Aes256Gcm, KeyInit,
    aead::{Aead, Payload},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use std::collections::BTreeMap;

pub struct KeyRing {
    current: String,
    keys: BTreeMap<String, [u8; 32]>,
}
#[derive(Debug, PartialEq, Eq)]
pub enum SecretError {
    InvalidConfiguration,
    InvalidEnvelope,
}
impl KeyRing {
    pub fn from_secret_json(current: &str, encoded: &str) -> Result<Self, SecretError> {
        if encoded.len() > 8192 || current.is_empty() || current.len() > 32 {
            return Err(SecretError::InvalidConfiguration);
        }
        let parsed: BTreeMap<String, String> =
            serde_json::from_str(encoded).map_err(|_| SecretError::InvalidConfiguration)?;
        if parsed.is_empty() || parsed.len() > 8 {
            return Err(SecretError::InvalidConfiguration);
        }
        let mut keys = BTreeMap::new();
        for (version, value) in parsed {
            if version.is_empty()
                || version.len() > 32
                || !version
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'-')
            {
                return Err(SecretError::InvalidConfiguration);
            }
            let key: [u8; 32] = URL_SAFE_NO_PAD
                .decode(value)
                .map_err(|_| SecretError::InvalidConfiguration)?
                .try_into()
                .map_err(|_| SecretError::InvalidConfiguration)?;
            keys.insert(version, key);
        }
        if !keys.contains_key(current) {
            return Err(SecretError::InvalidConfiguration);
        }
        Ok(Self {
            current: current.into(),
            keys,
        })
    }
    pub fn keyed_digests(&self, purpose: &str, value: &str) -> Vec<(String, [u8; 32])> {
        self.keys
            .iter()
            .map(|(version, key)| (version.clone(), keyed_digest(key, purpose, value)))
            .collect()
    }
    pub fn version(&self) -> &str {
        &self.current
    }
    pub fn seal(
        &self,
        nonce: [u8; 12],
        context: &str,
        plaintext: &[u8],
    ) -> Result<Vec<u8>, SecretError> {
        if plaintext.len() > 65536 || context.len() > 1024 {
            return Err(SecretError::InvalidEnvelope);
        }
        let key = self
            .keys
            .get(&self.current)
            .ok_or(SecretError::InvalidConfiguration)?;
        let cipher = Aes256Gcm::new(key.into());
        let ciphertext = cipher
            .encrypt(
                (&nonce).into(),
                Payload {
                    msg: plaintext,
                    aad: context.as_bytes(),
                },
            )
            .map_err(|_| SecretError::InvalidEnvelope)?;
        let mut envelope = nonce.to_vec();
        envelope.extend(ciphertext);
        Ok(envelope)
    }
    pub fn open(
        &self,
        version: &str,
        context: &str,
        envelope: &[u8],
    ) -> Result<Vec<u8>, SecretError> {
        if !(28..=65564).contains(&envelope.len()) || context.len() > 1024 {
            return Err(SecretError::InvalidEnvelope);
        }
        let key = self.keys.get(version).ok_or(SecretError::InvalidEnvelope)?;
        let nonce: &[u8; 12] = envelope[..12]
            .try_into()
            .map_err(|_| SecretError::InvalidEnvelope)?;
        Aes256Gcm::new(key.into())
            .decrypt(
                nonce.into(),
                Payload {
                    msg: &envelope[12..],
                    aad: context.as_bytes(),
                },
            )
            .map_err(|_| SecretError::InvalidEnvelope)
    }
}
pub fn keyed_digest(key: &[u8; 32], purpose: &str, value: &str) -> [u8; 32] {
    let mut mac =
        <Hmac<Sha256> as hmac::KeyInit>::new_from_slice(key).expect("HMAC accepts a 32-byte key");
    mac.update(purpose.as_bytes());
    mac.update(&[0]);
    mac.update(value.as_bytes());
    mac.finalize().into_bytes().into()
}
pub fn verify_keyed_digest(key: &[u8; 32], purpose: &str, value: &str, signature: &[u8]) -> bool {
    let mut mac =
        <Hmac<Sha256> as hmac::KeyInit>::new_from_slice(key).expect("HMAC accepts 32-byte keys");
    mac.update(purpose.as_bytes());
    mac.update(&[0]);
    mac.update(value.as_bytes());
    mac.verify_slice(signature).is_ok()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ciphertext_is_bound_to_owner_purpose_key_and_nonce() {
        let keys = KeyRing::from_secret_json(
            "v1",
            &format!(r#"{{"v1":"{}"}}"#, URL_SAFE_NO_PAD.encode([7; 32])),
        )
        .unwrap();
        let ciphertext = keys
            .seal(
                [1; 12],
                "production/refresh/session/operation",
                b"secret pair",
            )
            .unwrap();
        assert_eq!(
            keys.open("v1", "production/refresh/session/operation", &ciphertext)
                .unwrap(),
            b"secret pair"
        );
        for context in [
            "other/refresh/session/operation",
            "production/refresh/other/operation",
            "production/apple/session/operation",
        ] {
            assert!(keys.open("v1", context, &ciphertext).is_err());
        }
        let mut corrupt = ciphertext;
        corrupt[0] ^= 1;
        assert!(
            keys.open("v1", "production/refresh/session/operation", &corrupt)
                .is_err()
        );
        assert!(keys.open("missing", "context", &[]).is_err());
        assert_ne!(
            keyed_digest(&[0; 32], "subject", "same"),
            keyed_digest(&[0; 32], "network", "same")
        );
    }
}
