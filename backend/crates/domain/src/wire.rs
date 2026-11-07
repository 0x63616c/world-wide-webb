use crate::DomainError;
use serde::{Deserialize, Deserializer, Serialize, de};

pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
pub const MAX_BATCH_EVENTS: usize = 256;
pub const MAX_JSON_BYTES: usize = 256 * 1024;

/// Canonical wire UUID. UUID version/variant are deliberately unconstrained by the v1 schema.
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize)]
#[serde(transparent)]
pub struct Id(String);
impl Id {
    pub fn parse(value: &str) -> Result<Self, DomainError> {
        if value.len() != 36
            || !value.bytes().enumerate().all(|(i, b)| {
                if [8, 13, 18, 23].contains(&i) {
                    b == b'-'
                } else {
                    b.is_ascii_digit() || (b'a'..=b'f').contains(&b)
                }
            })
        {
            return Err(DomainError::InvalidEnvelope);
        }
        Ok(Self(value.to_owned()))
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
    pub fn nil() -> Self {
        Self("00000000-0000-0000-0000-000000000000".into())
    }
}
impl<'de> Deserialize<'de> for Id {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Self::parse(&String::deserialize(deserializer)?)
            .map_err(|_| de::Error::custom("invalid canonical UUID"))
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, Hash, PartialOrd, Ord)]
#[serde(deny_unknown_fields)]
pub struct Generation {
    pub revision: u64,
    pub reset_id: Id,
}
impl Generation {
    pub fn initial() -> Self {
        Self {
            revision: 0,
            reset_id: Id::nil(),
        }
    }
    pub fn validate(&self) -> Result<(), DomainError> {
        if self.revision > MAX_SAFE_INTEGER || (self.revision == 0) != (self.reset_id == Id::nil())
        {
            Err(DomainError::InvalidEnvelope)
        } else {
            Ok(())
        }
    }
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Transition {
    Open,
    Close,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Event {
    pub schema_version: u32,
    pub event_id: Id,
    pub device_id: Id,
    pub sequence: u64,
    pub generation: Generation,
    pub observed_at_ms: u64,
    pub timezone_id: String,
    pub transition: Transition,
    pub is_test: bool,
    #[serde(deserialize_with = "required_nullable")]
    pub competition_epoch_id: Option<Id>,
}
fn required_nullable<'de, D: Deserializer<'de>, T: Deserialize<'de>>(
    deserializer: D,
) -> Result<Option<T>, D::Error> {
    Option::<T>::deserialize(deserializer)
}
impl Event {
    pub fn validate(&self) -> Result<(), DomainError> {
        self.generation.validate()?;
        if self.schema_version != 1
            || !(1..=MAX_SAFE_INTEGER).contains(&self.sequence)
            || self.observed_at_ms > MAX_SAFE_INTEGER
            || self.timezone_id.chars().count() > 100
            || self.timezone_id.parse::<chrono_tz::Tz>().is_err()
        {
            return Err(DomainError::InvalidEnvelope);
        }
        Ok(())
    }
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InterruptionReason {
    DeviceRestart,
    TrackingInterruption,
    TransferAway,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Interruption {
    pub interruption_id: Id,
    pub device_id: Id,
    pub generation: Generation,
    pub after_sequence: u64,
    pub reason: InterruptionReason,
    pub observed_at_ms: u64,
}
impl Interruption {
    pub fn validate(&self) -> Result<(), DomainError> {
        self.generation.validate()?;
        if self.after_sequence > MAX_SAFE_INTEGER || self.observed_at_ms > MAX_SAFE_INTEGER {
            return Err(DomainError::InvalidEnvelope);
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct EventBatch {
    pub schema_version: u32,
    pub operation_id: Id,
    pub epoch_id: Id,
    pub events: Vec<Event>,
}
impl EventBatch {
    pub fn decode(bytes: &[u8]) -> Result<Self, DomainError> {
        if bytes.len() > MAX_JSON_BYTES {
            return Err(DomainError::InvalidEnvelope);
        }
        let batch: Self =
            serde_json::from_slice(bytes).map_err(|_| DomainError::InvalidEnvelope)?;
        batch.validate()?;
        Ok(batch)
    }
    pub fn validate(&self) -> Result<(), DomainError> {
        if self.schema_version != 1 || !(1..=MAX_BATCH_EVENTS).contains(&self.events.len()) {
            return Err(DomainError::InvalidEnvelope);
        }
        for event in &self.events {
            event.validate()?;
            if event.competition_epoch_id.as_ref() != Some(&self.epoch_id) {
                return Err(DomainError::InvalidEnvelope);
            }
        }
        // Validate all identities before any operation can partially accept the batch.
        crate::reducer::reduce(&self.events, &[], &self.events[0].generation)?;
        Ok(())
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ResetRequest {
    pub schema_version: u32,
    pub operation_id: Id,
    pub epoch_id: Id,
    pub generation: Generation,
}
impl ResetRequest {
    pub fn validate(&self) -> Result<(), DomainError> {
        self.generation.validate()?;
        if self.schema_version != 1 {
            return Err(DomainError::InvalidEnvelope);
        }
        Ok(())
    }
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Disposition {
    Accepted,
    Duplicate,
    Quarantined,
    Rejected,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct EventDecision {
    pub event_id: Id,
    pub disposition: Disposition,
    #[serde(deserialize_with = "required_nullable")]
    pub reason_code: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct EventReceipt {
    pub schema_version: u32,
    pub operation_id: Id,
    pub request_id: Id,
    pub received_at_ms: u64,
    pub events: Vec<EventDecision>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct WireError {
    pub code: String,
    pub request_id: Id,
    pub retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_after_seconds: Option<u32>,
}
