use folding_domain::wire::{Event, Generation};
use serde::Deserialize;
#[derive(Deserialize)]
pub(crate) struct Epoch {
    pub(crate) device_id: String,
    pub(crate) issued_at_ms: u64,
    pub(crate) closed_at_ms: Option<u64>,
}
pub(crate) fn approval_eligible(
    event: &Event,
    generation: &Generation,
    received_at_ms: u64,
    epoch: &Epoch,
    now_ms: u64,
) -> bool {
    event.validate().is_ok()
        && event.generation == *generation
        && !event.is_test
        && event.observed_at_ms <= now_ms
        && event.observed_at_ms >= epoch.issued_at_ms
        && epoch.device_id == event.device_id.as_str()
        && epoch
            .closed_at_ms
            .is_none_or(|closed| received_at_ms < closed)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn approval_never_bypasses_generation_device_test_or_time_fences() {
        let mut event: Event = serde_json::from_value(serde_json::json!({
            "schema_version": 1, "event_id": "00000000-0000-4000-8000-000000000001",
            "device_id": "00000000-0000-4000-8000-000000000002", "sequence": 1,
            "generation": {"revision":0,"reset_id":"00000000-0000-0000-0000-000000000000"},
            "observed_at_ms": 1000, "timezone_id": "UTC", "transition": "open", "is_test": false,
            "competition_epoch_id": "00000000-0000-4000-8000-000000000003"
        }))
        .unwrap();
        let generation = Generation::initial();
        let mut epoch = Epoch {
            device_id: event.device_id.as_str().to_owned(),
            issued_at_ms: 500,
            closed_at_ms: Some(2000),
        };
        assert!(approval_eligible(&event, &generation, 1500, &epoch, 3000));
        assert!(!approval_eligible(&event, &generation, 2000, &epoch, 3000));
        assert!(!approval_eligible(&event, &generation, 1500, &epoch, 999));
        event.is_test = true;
        assert!(!approval_eligible(&event, &generation, 1500, &epoch, 3000));
        event.is_test = false;
        epoch.issued_at_ms = 1001;
        assert!(!approval_eligible(&event, &generation, 1500, &epoch, 3000));
        epoch.issued_at_ms = 500;
        epoch.device_id = "another-device".into();
        assert!(!approval_eligible(&event, &generation, 1500, &epoch, 3000));
        epoch.device_id = event.device_id.as_str().to_owned();
        let newer = Generation {
            revision: 1,
            reset_id: event.event_id.clone(),
        };
        assert!(!approval_eligible(&event, &newer, 1500, &epoch, 3000));
    }
}
