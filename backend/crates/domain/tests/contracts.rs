use folding_domain::{DomainError, competition::*, reducer::reduce, wire::*};
use serde_json::{Value, json};

fn fixtures(name: &str) -> Value {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../contracts/fixtures")
        .join(name);
    serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
}
#[test]
fn canonical_reducer_fixtures_in_both_arrival_orders() {
    for case in fixtures("reducer.json")["cases"].as_array().unwrap() {
        let events: Vec<Event> =
            serde_json::from_value(case["events_in_arrival_order"].clone()).unwrap();
        let interruptions: Vec<Interruption> =
            serde_json::from_value(case.get("interruptions").cloned().unwrap_or(json!([])))
                .unwrap();
        let generation: Generation = case
            .get("generation")
            .map(|g| serde_json::from_value(g.clone()).unwrap())
            .unwrap_or_else(Generation::initial);
        let result = reduce(&events, &interruptions, &generation).unwrap();
        let expected = &case["expected"];
        assert_eq!(
            result.folds(),
            expected["folds"].as_u64().unwrap(),
            "{}",
            case["name"]
        );
        assert_eq!(result.opens, expected["opens"].as_u64().unwrap());
        assert_eq!(result.closes, expected["closes"].as_u64().unwrap());
        assert_eq!(result.cycles, expected["cycles"].as_u64().unwrap());
        assert_eq!(
            result.complete_duration_ms,
            expected["complete_duration_ms"].as_u64().unwrap()
        );
        assert_eq!(
            result.incomplete_sessions() as u64,
            expected["incomplete_sessions"].as_u64().unwrap()
        );
        let reversed: Vec<_> = events.into_iter().rev().collect();
        assert_eq!(
            result,
            reduce(&reversed, &interruptions, &generation).unwrap()
        );
    }
}
#[test]
fn strict_envelope_validation_and_retry_conflicts() {
    let fixture = fixtures("event-batch.json");
    let valid = fixture.get("valid").unwrap_or(&fixture);
    let batch: EventBatch = serde_json::from_value(valid.clone()).unwrap();
    batch.validate().unwrap();
    let event = batch.events[0].clone();
    let mut malformed = serde_json::to_value(&event).unwrap();
    malformed
        .as_object_mut()
        .unwrap()
        .remove("competition_epoch_id");
    assert!(serde_json::from_value::<Event>(malformed).is_err());
    let mut malformed = serde_json::to_value(&event).unwrap();
    malformed["role"] = json!("admin");
    assert!(serde_json::from_value::<Event>(malformed).is_err());
    assert!(Id::parse("AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA").is_err());
    let mut invalid = event.clone();
    invalid.timezone_id = "Imaginary/Timezone".into();
    assert!(invalid.validate().is_err());
    invalid = event.clone();
    invalid.sequence = MAX_SAFE_INTEGER + 1;
    assert!(invalid.validate().is_err());
    invalid = event.clone();
    invalid.observed_at_ms += 1;
    assert_eq!(
        reduce(&[event.clone(), invalid], &[], &event.generation),
        Err(DomainError::IdentityConflict)
    );
    invalid = event.clone();
    invalid.event_id = Id::nil();
    assert_eq!(
        reduce(&[event.clone(), invalid], &[], &event.generation),
        Err(DomainError::SequenceConflict)
    );
    assert_eq!(
        reduce(&[event.clone(), event.clone()], &[], &event.generation)
            .unwrap()
            .folds(),
        1
    );
}
#[test]
fn ranking_and_cutoff_contracts() {
    for case in fixtures("competition.json")["cases"].as_array().unwrap() {
        if let Some(scores) = case["scores"].as_array() {
            let entries: Vec<_> = scores
                .iter()
                .enumerate()
                .map(|(i, score)| {
                    (
                        Id::parse(&format!("00000000-0000-0000-0000-{i:012x}")).unwrap(),
                        score.as_u64().unwrap(),
                    )
                })
                .collect();
            let results = rank_scores(&entries).unwrap();
            assert_eq!(
                json!(results.iter().map(|r| r.rank).collect::<Vec<_>>()),
                case["expected_ranks"]
            );
            assert_eq!(
                json!(results.iter().map(|r| r.percentile).collect::<Vec<_>>()),
                case["expected_percentiles"]
            );
            if case.get("expected_medals").is_some() {
                assert_eq!(
                    json!(results.iter().map(|r| r.medal).collect::<Vec<_>>()),
                    case["expected_medals"]
                );
            }
        }
        if let Some(times) = case["receipt_times_ms"].as_array() {
            let actual: Vec<_> = times
                .iter()
                .map(|time| {
                    eligible_by_receipt(
                        time.as_u64().unwrap(),
                        case["period_end_ms"].as_u64().unwrap(),
                    )
                    .unwrap()
                })
                .collect();
            assert_eq!(json!(actual), case["eligible_by_receipt"]);
        }
        if let Some(markers) = case["markers"].as_array() {
            let markers: Vec<Generation> = markers
                .iter()
                .map(|m| serde_json::from_value(m.clone()).unwrap())
                .collect();
            assert_eq!(
                markers.iter().max(),
                Some(&markers[case["winning_index"].as_u64().unwrap() as usize])
            );
        }
    }
}

#[test]
fn eligibility_preserves_epoch_and_generation_boundaries_without_an_offline_age_limit() {
    let batch: EventBatch = serde_json::from_value(fixtures("event-batch.json")).unwrap();
    let original = &batch.events[0];
    let enrollment = Enrollment {
        device_id: &original.device_id,
        epoch_id: &batch.epoch_id,
        generation: &original.generation,
        issued_at_ms: 0,
    };
    assert_eq!(
        eligibility(original, &enrollment, 9_000_000_000).unwrap(),
        Eligibility::Eligible
    );
    let mut changed = original.clone();
    changed.is_test = true;
    assert_eq!(
        eligibility(&changed, &enrollment, original.observed_at_ms).unwrap(),
        Eligibility::Rejected("setup_test")
    );
    changed = original.clone();
    changed.competition_epoch_id = Some(Id::nil());
    assert_eq!(
        eligibility(&changed, &enrollment, original.observed_at_ms).unwrap(),
        Eligibility::Rejected("epoch_stale")
    );
    changed = original.clone();
    changed.generation = Generation {
        revision: 1,
        reset_id: original.event_id.clone(),
    };
    assert_eq!(
        eligibility(&changed, &enrollment, original.observed_at_ms).unwrap(),
        Eligibility::Rejected("generation_stale")
    );
    changed = original.clone();
    changed.observed_at_ms = original.observed_at_ms + 300_001;
    assert_eq!(
        eligibility(&changed, &enrollment, original.observed_at_ms).unwrap(),
        Eligibility::Quarantined("future_timestamp")
    );
    changed.observed_at_ms -= 1;
    assert_eq!(
        eligibility(&changed, &enrollment, original.observed_at_ms).unwrap(),
        Eligibility::Eligible
    );
}

#[test]
fn tied_comparison_population_ignores_zero_scores() {
    let scores: Vec<_> = (0..21)
        .map(|i| {
            (
                Id::parse(&format!("00000000-0000-0000-0000-{i:012x}")).unwrap(),
                if i == 20 { 0 } else { 10 },
            )
        })
        .collect();
    let results = rank_scores(&scores).unwrap();
    assert_eq!(results.len(), 20);
    assert!(results.iter().all(|entry| entry.rank == 1
        && entry.percentile == Some(0)
        && entry.medal == Some(Medal::Gold)));
}

#[test]
fn foundation_timezone_vectors() {
    let fixture: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../contracts/fixtures/timezones.json"
    ))
    .unwrap();
    for case in fixture["cases"].as_array().unwrap() {
        let name = case["timezone_id"].as_str().unwrap();
        assert_eq!(
            folding_domain::wire::valid_timezone(name),
            case["valid"].as_bool().unwrap(),
            "{name}"
        );
    }
}

#[test]
fn entry_deletion_never_creates_a_fold_from_a_later_repeated_state() {
    use std::collections::BTreeSet;
    let source = Id::parse("11111111-1111-1111-1111-111111111111").unwrap();
    let event = |sequence: u64, transition| Event {
        schema_version: 1,
        event_id: Id::parse(&format!("22222222-2222-2222-2222-{sequence:012}")).unwrap(),
        device_id: source.clone(),
        sequence,
        generation: Generation::initial(),
        observed_at_ms: sequence * 1000,
        timezone_id: "UTC".into(),
        transition,
        is_test: false,
        competition_epoch_id: None,
    };
    let events = vec![
        event(1, Transition::Open),
        event(2, Transition::Open),
        event(3, Transition::Close),
    ];
    let deleted = BTreeSet::from([events[0].event_id.clone()]);
    let summary = folding_domain::reducer::reduce_with_deletions(
        &events,
        &[],
        &Generation::initial(),
        &deleted,
    )
    .unwrap();
    assert_eq!(summary.opens, 0);
    assert_eq!(summary.closes, 1);
    assert_eq!(summary.counted_events, vec![events[2].event_id.clone()]);
    let reverse: Vec<_> = events.iter().rev().cloned().collect();
    assert_eq!(
        folding_domain::reducer::reduce_with_deletions(
            &reverse,
            &[],
            &Generation::initial(),
            &deleted
        )
        .unwrap(),
        summary
    );
    for count in 0..=events.len() {
        let deleted: BTreeSet<_> = events
            .iter()
            .take(count)
            .map(|e| e.event_id.clone())
            .collect();
        let result = folding_domain::reducer::reduce_with_deletions(
            &events,
            &[],
            &Generation::initial(),
            &deleted,
        )
        .unwrap();
        assert!(result.folds() <= 2);
    }
}
