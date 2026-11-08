//! Provisional ingestion decisions. Runtime must load participant-owned immutable records and
//! commit this plan with both authenticated session and competition/attestation CAS guards.
use folding_domain::{
    DomainError,
    competition::{Eligibility, Enrollment, eligibility},
    reducer,
    wire::{Disposition, Event, EventBatch, EventDecision, EventReceipt, Id},
};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone)]
pub struct StoredObservation {
    pub event: Event,
    pub disposition: Disposition,
}
pub struct NewObservation {
    pub event: Event,
    pub disposition: Disposition,
    pub reason_code: Option<String>,
}
pub struct IngestionPlan {
    pub normalized_hash: [u8; 32],
    pub receipt: EventReceipt,
    pub new_observations: Vec<NewObservation>,
    pub all_time_folds: u64,
    pub counted_timestamps: Vec<u64>,
}
/// A stable hash of typed business fields, independent of JSON whitespace/object-key order.
/// Tokens, assertions and request IDs are deliberately excluded.
pub fn normalized_batch_hash(batch: &EventBatch) -> Result<[u8; 32], DomainError> {
    batch.validate()?;
    Ok(Sha256::digest(serde_json::to_vec(batch).map_err(|_| DomainError::InvalidEnvelope)?).into())
}
pub fn plan_batch(
    batch: &EventBatch,
    previous: &[StoredObservation],
    enrollment: &Enrollment<'_>,
    received_at_ms: u64,
    request_id: Id,
) -> Result<IngestionPlan, DomainError> {
    plan_batch_with_deletions(
        batch,
        previous,
        enrollment,
        received_at_ms,
        request_id,
        &BTreeSet::new(),
    )
}
pub fn plan_batch_with_deletions(
    batch: &EventBatch,
    previous: &[StoredObservation],
    enrollment: &Enrollment<'_>,
    received_at_ms: u64,
    request_id: Id,
    deleted: &BTreeSet<Id>,
) -> Result<IngestionPlan, DomainError> {
    let hash = normalized_batch_hash(batch)?;
    // Identity uniqueness is participant-wide, including quarantined/rejected events/generations.
    let mut by_id = BTreeMap::new();
    let mut sequences = BTreeMap::new();
    for old in previous {
        old.event.validate()?;
        if by_id
            .insert(old.event.event_id.clone(), &old.event)
            .is_some()
            || sequences
                .insert(
                    (old.event.device_id.clone(), old.event.sequence),
                    old.event.event_id.clone(),
                )
                .is_some()
        {
            return Err(DomainError::IdentityConflict);
        }
    }
    for event in &batch.events {
        if let Some(old) = by_id.get(&event.event_id) {
            if **old != *event {
                return Err(DomainError::IdentityConflict);
            }
        } else {
            if let Some(existing) = sequences.insert(
                (event.device_id.clone(), event.sequence),
                event.event_id.clone(),
            ) && existing != event.event_id
            {
                return Err(DomainError::SequenceConflict);
            }
            by_id.insert(event.event_id.clone(), event);
        }
    }
    let mut accepted: Vec<Event> = previous
        .iter()
        .filter(|old| old.disposition == Disposition::Accepted)
        .map(|old| old.event.clone())
        .collect();
    let mut seen: BTreeSet<Id> = previous
        .iter()
        .map(|old| old.event.event_id.clone())
        .collect();
    let mut sorted: Vec<_> = batch.events.iter().collect();
    sorted.sort_by_key(|event| (event.device_id.clone(), event.sequence));
    let mut new_observations = Vec::new();
    for event in sorted {
        if !seen.insert(event.event_id.clone()) {
            continue;
        }
        let (disposition, reason) = match eligibility(event, enrollment, received_at_ms)? {
            Eligibility::Rejected(reason) => (Disposition::Rejected, Some(reason)),
            Eligibility::Quarantined(reason) => (Disposition::Quarantined, Some(reason)),
            Eligibility::Eligible => {
                let clock_reversal = accepted
                    .iter()
                    .filter(|old| {
                        old.device_id == event.device_id && old.generation == event.generation
                    })
                    .any(|old| {
                        (old.sequence < event.sequence && old.observed_at_ms > event.observed_at_ms)
                            || (old.sequence > event.sequence
                                && old.observed_at_ms < event.observed_at_ms)
                    });
                if clock_reversal {
                    (Disposition::Quarantined, Some("clock_reversal"))
                } else {
                    (Disposition::Accepted, None)
                }
            }
        };
        if disposition == Disposition::Accepted {
            accepted.push(event.clone());
        }
        new_observations.push(NewObservation {
            event: event.clone(),
            disposition,
            reason_code: reason.map(str::to_owned),
        });
    }
    let summary = reducer::reduce_with_deletions(&accepted, &[], enrollment.generation, deleted)?;
    let all_time_folds = summary.folds();
    let times: BTreeMap<_, _> = accepted
        .iter()
        .map(|event| (&event.event_id, event.observed_at_ms))
        .collect();
    let counted_timestamps = summary.counted_events.iter().map(|id| times[id]).collect();
    let mut reported: BTreeSet<Id> = previous
        .iter()
        .map(|old| old.event.event_id.clone())
        .collect();
    let events = batch
        .events
        .iter()
        .map(|event| {
            if !reported.insert(event.event_id.clone()) {
                EventDecision {
                    event_id: event.event_id.clone(),
                    disposition: Disposition::Duplicate,
                    reason_code: None,
                }
            } else {
                let decision = new_observations
                    .iter()
                    .find(|new| new.event.event_id == event.event_id)
                    .expect("new event has a provisional decision");
                EventDecision {
                    event_id: event.event_id.clone(),
                    disposition: decision.disposition,
                    reason_code: decision.reason_code.clone(),
                }
            }
        })
        .collect();
    Ok(IngestionPlan {
        normalized_hash: hash,
        receipt: EventReceipt {
            schema_version: 1,
            operation_id: batch.operation_id.clone(),
            request_id,
            received_at_ms,
            events,
        },
        new_observations,
        all_time_folds,
        counted_timestamps,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    use folding_domain::wire::{Generation, Transition};
    fn id(n: u32) -> Id {
        Id::parse(&format!("00000000-0000-0000-0000-{n:012}")).unwrap()
    }
    fn event(n: u32, time: u64) -> Event {
        Event {
            schema_version: 1,
            event_id: id(n),
            device_id: id(100),
            sequence: n as u64,
            generation: Generation::initial(),
            observed_at_ms: time,
            timezone_id: "UTC".into(),
            transition: if n % 2 == 1 {
                Transition::Open
            } else {
                Transition::Close
            },
            is_test: false,
            competition_epoch_id: Some(id(200)),
        }
    }
    #[test]
    fn immutable_identity_duplicates_and_clock_quarantine_preserve_receipt_order() {
        let generation = Generation::initial();
        let device = id(100);
        let epoch = id(200);
        let enrollment = Enrollment {
            device_id: &device,
            epoch_id: &epoch,
            generation: &generation,
            issued_at_ms: 0,
        };
        let first = event(1, 100);
        let previous = vec![StoredObservation {
            event: first.clone(),
            disposition: Disposition::Accepted,
        }];
        let mut batch = EventBatch {
            schema_version: 1,
            operation_id: id(300),
            epoch_id: epoch.clone(),
            events: vec![event(3, 110), event(2, 90), first.clone()],
        };
        let plan = plan_batch(&batch, &previous, &enrollment, 200, id(400)).unwrap();
        assert_eq!(
            plan.receipt
                .events
                .iter()
                .map(|e| e.disposition)
                .collect::<Vec<_>>(),
            vec![
                Disposition::Accepted,
                Disposition::Quarantined,
                Disposition::Duplicate
            ]
        );
        assert_eq!(plan.all_time_folds, 1); // repeated open remains an observation, not another fold
        batch.events[2].observed_at_ms += 1;
        assert!(matches!(
            plan_batch(&batch, &previous, &enrollment, 200, id(400)),
            Err(DomainError::IdentityConflict)
        ));
        batch.events = vec![first.clone(), first];
        let plan = plan_batch(&batch, &[], &enrollment, 200, id(400)).unwrap();
        assert_eq!(plan.new_observations.len(), 1);
        assert_eq!(plan.receipt.events[1].disposition, Disposition::Duplicate);
    }
}
