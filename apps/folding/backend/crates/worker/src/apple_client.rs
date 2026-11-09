//! Server-signed Apple client secret; private keys are supplied by Worker secret bindings.
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use p256::{
    ecdsa::{Signature, SigningKey, signature::Signer},
    pkcs8::DecodePrivateKey,
};
#[derive(Debug, PartialEq, Eq)]
pub enum ClientSecretError {
    Configuration,
    Encoding,
}
pub fn client_secret(
    private_pkcs8: &[u8],
    key_id: &str,
    team_id: &str,
    client_id: &str,
    now_seconds: u64,
) -> Result<String, ClientSecretError> {
    if private_pkcs8.len() > 4096
        || key_id.len() != 10
        || team_id.len() != 10
        || !key_id
            .bytes()
            .chain(team_id.bytes())
            .all(|b| b.is_ascii_alphanumeric())
        || client_id.is_empty()
        || client_id.len() > 255
        || !client_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
    {
        return Err(ClientSecretError::Configuration);
    }
    let key =
        SigningKey::from_pkcs8_der(private_pkcs8).map_err(|_| ClientSecretError::Configuration)?;
    let header = serde_json::json!({"alg":"ES256","kid":key_id,"typ":"JWT"});
    let claims = serde_json::json!({"iss":team_id,"iat":now_seconds,"exp":now_seconds.checked_add(300).ok_or(ClientSecretError::Configuration)?,"aud":"https://appleid.apple.com","sub":client_id});
    let message = format!(
        "{}.{}",
        URL_SAFE_NO_PAD
            .encode(serde_json::to_vec(&header).map_err(|_| ClientSecretError::Encoding)?),
        URL_SAFE_NO_PAD
            .encode(serde_json::to_vec(&claims).map_err(|_| ClientSecretError::Encoding)?)
    );
    let signature: Signature = key.sign(message.as_bytes());
    Ok(format!(
        "{}.{}",
        message,
        URL_SAFE_NO_PAD.encode(signature.to_bytes())
    ))
}
#[cfg(test)]
mod tests {
    use super::*;
    use p256::{ecdsa::signature::Verifier, pkcs8::EncodePrivateKey};
    #[test]
    fn signed_client_secret_uses_raw_es256_and_short_expiry() {
        let key = SigningKey::from_bytes((&[3; 32]).into()).unwrap();
        let encoded = key.to_pkcs8_der().unwrap();
        let token = client_secret(
            encoded.as_bytes(),
            "KEY1234567",
            "TEAM123456",
            "app.getfolding.Folding.Staging",
            100,
        )
        .unwrap();
        let parts: Vec<_> = token.split('.').collect();
        let signature = Signature::from_slice(&URL_SAFE_NO_PAD.decode(parts[2]).unwrap()).unwrap();
        key.verifying_key()
            .verify(format!("{}.{}", parts[0], parts[1]).as_bytes(), &signature)
            .unwrap();
        let claims: serde_json::Value =
            serde_json::from_slice(&URL_SAFE_NO_PAD.decode(parts[1]).unwrap()).unwrap();
        assert_eq!(claims["exp"], 400);
        assert_eq!(claims["aud"], "https://appleid.apple.com");
        assert!(client_secret(b"not a key", "KEY1234567", "TEAM123456", "app", 100).is_err());
    }
}
