//! Existing HTTP catalog requests. Unknown fields and missing nullable fields fail closed.
use base64::{Engine, engine::general_purpose::STANDARD};
use folding_domain::wire::Id;
use serde::Deserialize;
#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AuthPurpose {
    SignIn,
    Reauthenticate,
    RecoverDeletion,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthChallengeRequest {
    pub purpose: AuthPurpose,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AppleExchangeRequest {
    pub operation_id: Id,
    pub purpose: AuthPurpose,
    pub challenge_id: Id,
    pub identity_token: String,
    pub authorization_code: String,
    pub device_id: Id,
    #[serde(deserialize_with = "required_nullable")]
    pub deletion_operation_id: Option<Id>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RefreshRequest {
    pub operation_id: Id,
    pub refresh_token: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LogoutRequest {
    pub operation_id: Id,
}
#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AttestationPurpose {
    EnrollKey,
    Join,
    Transfer,
    SubmitEvents,
    Reset,
    AvatarUpload,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AttestationChallengeRequest {
    pub purpose: AttestationPurpose,
    pub device_id: Id,
    pub key_id: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EnrollKeyRequest {
    pub operation_id: Id,
    pub device_id: Id,
    pub key_id: String,
    pub challenge_id: Id,
    pub attestation_base64: String,
}
fn required_nullable<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> Result<Option<T>, D::Error> {
    Option::deserialize(d)
}
impl AppleExchangeRequest {
    pub fn validate(&self) -> bool {
        !self.identity_token.is_empty()
            && self.identity_token.len() <= 16384
            && !self.authorization_code.is_empty()
            && self.authorization_code.len() <= 16384
            && (self.purpose == AuthPurpose::RecoverDeletion)
                == self.deletion_operation_id.is_some()
    }
}

impl AttestationChallengeRequest {
    pub fn validate(&self) -> bool {
        valid_key_id(&self.key_id)
    }
}
impl AttestationPurpose {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::EnrollKey => "enroll_key",
            Self::Join => "join",
            Self::Transfer => "transfer",
            Self::SubmitEvents => "submit_events",
            Self::Reset => "reset",
            Self::AvatarUpload => "avatar_upload",
        }
    }
}
fn valid_key_id(value: &str) -> bool {
    value.len() == 44 && STANDARD.decode(value).is_ok_and(|bytes| bytes.len() == 32)
}
impl EnrollKeyRequest {
    pub fn validate(&self) -> bool {
        valid_key_id(&self.key_id)
            && !self.attestation_base64.is_empty()
            && self.attestation_base64.len() <= 87384
            && STANDARD
                .decode(&self.attestation_base64)
                .is_ok_and(|bytes| bytes.len() <= 65536)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn valid(schema: &str, body: &serde_json::Value) -> bool {
        match schema {
            "auth-challenge-request" => {
                serde_json::from_value::<AuthChallengeRequest>(body.clone()).is_ok()
            }
            "apple-exchange-request" => {
                serde_json::from_value::<AppleExchangeRequest>(body.clone())
                    .is_ok_and(|r| r.validate())
            }
            "auth-refresh-request" => serde_json::from_value::<RefreshRequest>(body.clone())
                .is_ok_and(|r| crate::session::token_hash(&r.refresh_token).is_some()),
            "auth-logout-request" => serde_json::from_value::<LogoutRequest>(body.clone()).is_ok(),
            "attestation-challenge-request" => {
                serde_json::from_value::<AttestationChallengeRequest>(body.clone())
                    .is_ok_and(|r| r.validate())
            }
            "attestation-key-request" => {
                serde_json::from_value::<EnrollKeyRequest>(body.clone()).is_ok_and(|r| r.validate())
            }
            _ => false,
        }
    }
    #[test]
    fn shared_auth_shapes_reject_unknown_and_missing_nullable_fields() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../contracts/fixtures/auth-requests.json"
        ))
        .unwrap();
        for (name, expected) in [("valid", true), ("invalid", false)] {
            for case in fixture[name].as_array().unwrap() {
                assert_eq!(
                    valid(case["schema"].as_str().unwrap(), &case["body"]),
                    expected,
                    "{case}"
                );
            }
        }
    }
}
